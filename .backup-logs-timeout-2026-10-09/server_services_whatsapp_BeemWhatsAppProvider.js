'use strict';

/**
 * Beem WhatsApp provider.
 *
 * Every assumption about Beem's wire format lives in this one file: the
 * endpoint, the auth header, the request body and the shape of the delivery
 * callback. Nothing above this layer knows or cares. When the live account
 * details are confirmed, this is the only file that can need adjusting — and
 * most of it is already driven by environment variables.
 *
 * Docs: https://docs.beem.africa/
 *
 * Beem requires an APPROVED TEMPLATE to open a WhatsApp conversation, so this
 * provider only ever sends templated messages. It deliberately offers no
 * free-form send: that would be rejected by WhatsApp and would get the sender
 * number flagged.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const { getConfig } = require('../../config/whatsapp');
const { validatePhone } = require('../../utils/phone');

/**
 * Beem's documented WhatsApp statuses, mapped onto the ones we store.
 * Anything unrecognised is kept verbatim by the caller and logged, never
 * silently coerced into a success.
 */
const STATUS_MAP = {
  accepted:   'accepted',
  queued:     'accepted',
  submitted:  'accepted',
  sent:       'sent',
  delivered:  'delivered',
  read:       'read',
  failed:     'failed',
  undelivered:'failed',
  rejected:   'failed',
  expired:    'failed',
  error:      'failed',
};

const TERMINAL = new Set(['delivered', 'read', 'failed']);

/** Ordering, so a late "accepted" callback cannot undo a "read". */
const RANK = { pending: 0, sending: 1, accepted: 2, sent: 3, delivered: 4, read: 5, failed: 6 };

class BeemWhatsAppProvider {
  constructor(config = null) {
    this.config = config || getConfig();
  }

  name() { return 'beem_whatsapp'; }

  isConfigured() { return this.config.configured; }

  /** Why it cannot send, in words a person can act on. */
  configurationError() {
    if (this.config.configured) return null;
    return `WhatsApp is not configured yet. Missing: ${this.config.missing.join(', ')}. ` +
      'Add these to the server .env and restart the API.';
  }

  _authHeader() {
    const { apiKey, apiSecret, authMode } = this.config;
    if (authMode === 'bearer') return `Bearer ${apiKey}`;
    return `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
  }

  /**
   * Build the send payload for one recipient — Beem BROADCAST API format.
   *
   *   POST https://apibroadcast.beem.africa/v1/broadcast/template/api-send
   *   {
   *     "from_addr": "255706422927",
   *     "destination_addr": [{ "phoneNumber": "2557…", "params": [6 values] }],
   *     "channel": "whatsapp",
   *     "content": { "mediaUrl": "https://…/card.png" },
   *     "messageTemplateData": { "id": 1850 }
   *   }
   *
   * This shape is the one verified working against the live account. An earlier
   * version of this file built a Meta Cloud API payload instead (`from`, `to`,
   * `template.components`), which has no `from_addr` at all — that is what
   * produced "from_addr Cannot be null/undefined".
   *
   * `params` is a positional array: the approved template 1850 declares
   * {{0}}..{{5}}, so order and count are part of the contract, not a detail.
   *
   * Exposed separately from the HTTP call so the exact request can be inspected
   * in tests without credentials or network access.
   *
   * @param {{ phone:string, params:string[]|Record<string,string>, mediaUrl?:string, reference?:string }} msg
   */
  buildPayload(msg) {
    const c = this.config;

    const fromAddr = String(c.from || '').trim();
    if (!fromAddr) {
      // Never let an absent sender reach Beem as null/undefined — that is the
      // exact failure this guard exists to prevent.
      const e = new Error('WhatsApp sender is not configured: set BEEM_WHATSAPP_FROM (the Beem sender number, e.g. 255706422927) in the server environment.');
      e.code = 'NO_FROM_ADDR';
      throw e;
    }

    // Accept either a positional array or the legacy object, but always send an
    // array — Beem matches by position.
    const params = (Array.isArray(msg.params) ? msg.params : Object.values(msg.params || {}))
      .map((v) => (v == null ? '' : String(v)));

    const payload = {
      from_addr: fromAddr,
      destination_addr: [
        { phoneNumber: String(msg.phone), params },
      ],
      channel: 'whatsapp',
      messageTemplateData: { id: templateIdValue(c.templateId) },
    };

    // The card image header. Only included when this guest actually has a
    // public HTTPS card, so a guest without one still gets the text template.
    if (msg.mediaUrl) payload.content = { mediaUrl: msg.mediaUrl };

    return payload;
  }

  /**
   * Send one templated WhatsApp message.
   * @returns {Promise<{ success:true, job_id:string|null, provider_message_id:string|null, status:string, raw:object }>}
   */
  async send(msg) {
    const err = this.configurationError();
    if (err) {
      const e = new Error(err);
      e.code = 'WHATSAPP_NOT_CONFIGURED';
      throw e;
    }

    const check = validatePhone(msg.phone);
    if (!check.ok) {
      const e = new Error(check.reason);
      e.code = 'INVALID_PHONE';
      throw e;
    }

    const payload = this.buildPayload({ ...msg, phone: check.phone });
    const res = await this._post(this.config.apiUrl, payload);

    const body  = res.json || {};
    // Beem nests the useful part under data/result/response depending on the
    // product, so look one level down as well as at the top.
    const inner = (body.data && typeof body.data === 'object') ? body.data
      : (body.result && typeof body.result === 'object') ? body.result
      : (body.response && typeof body.response === 'object') ? body.response
      : {};

    // A rejection can arrive with HTTP 200 and an error code in the body — that
    // is how "from_addr Cannot be null/undefined" came back. Treat any of these
    // as a failure rather than recording a message that was never accepted.
    const code = body.code ?? inner.code;
    const codeRejected = code !== undefined && code !== null
      && !['100', '0', '200', 'success'].includes(String(code).toLowerCase());
    const explicitFailure = body.successful === false || body.success === false
      || inner.successful === false || inner.success === false
      || /^(failed|rejected|error|invalid)$/i.test(String(body.status || inner.status || ''))
      || codeRejected;

    if (res.statusCode < 200 || res.statusCode >= 300 || explicitFailure) {
      const reason = pick(body, ['message', 'error', 'detail', 'error_message'])
        || pick(inner, ['message', 'error', 'detail', 'error_message'])
        || (res.raw ? String(res.raw).slice(0, 200) : '')
        || `Beem WhatsApp HTTP ${res.statusCode}`;
      const e = new Error(String(reason));
      e.code = 'PROVIDER_REJECTED';
      e.http_status = res.statusCode;
      e.provider_code = code != null ? String(code) : null;
      e.raw = body;
      throw e;
    }

    return {
      success: true,
      job_id: pick(body, ['job_id', 'jobId', 'request_id', 'requestId'])
        || pick(inner, ['job_id', 'jobId', 'request_id', 'requestId', 'id']),
      provider_message_id: pick(body, ['message_id', 'messageId', 'wamid'])
        || pick(inner, ['message_id', 'messageId', 'wamid']),
      // Beem accepts the job here; delivery and read arrive later by callback.
      // Never claim more than "accepted" from a send response.
      status: STATUS_MAP[String(body.status || inner.status || '').toLowerCase()] || 'accepted',
      http_status: res.statusCode,
      provider_code: code != null ? String(code) : null,
      raw: body,
    };
  }

  /**
   * Turn a delivery callback into the fields we store.
   *
   * Written defensively on purpose: Beem's callback field names are the part
   * least pinned down today, so every value is looked for under each name it
   * plausibly arrives as, and an unrecognised payload returns `matched: false`
   * instead of throwing or guessing.
   *
   * @returns {{ matched:boolean, job_id:string|null, provider_message_id:string|null,
   *             reference:string|null, status:string|null, raw_status:string|null,
   *             error:string|null, recipient:string|null }}
   */
  parseCallback(payload) {
    const p = (payload && typeof payload === 'object') ? payload : {};
    // Some providers wrap the event; look one level down too.
    const d = (p.data && typeof p.data === 'object') ? p.data
      : (Array.isArray(p.results) && p.results[0]) ? p.results[0]
      : (Array.isArray(p.statuses) && p.statuses[0]) ? p.statuses[0]
      : p;

    const rawStatus = String(
      pick(d, ['status', 'message_status', 'delivery_status', 'state', 'event']) || ''
    ).toLowerCase();

    const jobId = pick(d, ['job_id', 'jobId', 'request_id', 'requestId']);
    const msgId = pick(d, ['message_id', 'messageId', 'wamid', 'id']);
    const ref   = pick(d, ['message_reference', 'reference', 'client_reference', 'correlation_id']);

    return {
      matched: Boolean(jobId || msgId || ref),
      job_id: jobId,
      provider_message_id: msgId,
      reference: ref,
      status: STATUS_MAP[rawStatus] || null,
      raw_status: rawStatus || null,
      error: pick(d, ['error', 'error_message', 'reason', 'failure_reason', 'description']),
      recipient: pick(d, ['to', 'recipient', 'dest_addr', 'msisdn', 'phone']),
    };
  }

  /** Minimal JSON POST with a hard timeout. No dependencies. */
  _post(urlString, body) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(urlString); }
      catch { return reject(new Error(`Invalid BEEM_WHATSAPP_API_URL: ${urlString}`)); }

      const data = JSON.stringify(body);
      const lib  = url.protocol === 'http:' ? http : https;
      const req  = lib.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'http:' ? 80 : 443),
        path:     url.pathname + url.search,
        method:   'POST',
        timeout:  this.config.timeoutMs,
        headers: {
          'Content-Type':   'application/json',
          'Accept':         'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Authorization':  this._authHeader(),
        },
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* provider returned non-JSON */ }
          resolve({ statusCode: res.statusCode, json, raw: raw.slice(0, 500) });
        });
      });

      req.on('timeout', () => req.destroy(new Error(`Beem WhatsApp timed out after ${this.config.timeoutMs}ms`)));
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

/**
 * Beem identifies the approved template by numeric id (1850), so send a number
 * when the configured value is numeric and the raw string otherwise — a quoted
 * "1850" is rejected by the Broadcast API.
 */
function templateIdValue(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

/** First present, non-empty value among several possible field names. */
function pick(obj, names) {
  for (const n of names) {
    const v = obj?.[n];
    if (v !== undefined && v !== null && String(v) !== '') return String(v);
  }
  return null;
}

module.exports = BeemWhatsAppProvider;
module.exports.STATUS_MAP = STATUS_MAP;
module.exports.TERMINAL = TERMINAL;
module.exports.RANK = RANK;
