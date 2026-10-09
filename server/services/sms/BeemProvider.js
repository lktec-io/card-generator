'use strict';

const https       = require('https');
const SmsProvider = require('./SmsProvider');

/**
 * Beem Africa SMS provider.
 * Docs: https://apisms.beem.africa
 * Auth: HTTP Basic — base64(BEEM_API_KEY:BEEM_SECRET_KEY)
 * Env:  BEEM_API_KEY, BEEM_SECRET_KEY, BEEM_SOURCE_ADDR
 */
class BeemProvider extends SmsProvider {
  constructor() {
    super();
    this.apiKey     = process.env.BEEM_API_KEY     || '';
    this.secretKey  = process.env.BEEM_SECRET_KEY  || '';
    this.sourceAddr = process.env.BEEM_SOURCE_ADDR || 'INFO';
  }

  /**
   * Normalise phone to international format without '+'.
   * Tanzania: 0754... → 255754..., +255754... → 255754...
   */
  _normalise(raw) {
    let p = String(raw).replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.startsWith('0'))  p = '255' + p.slice(1);
    return p;
  }

  async send(to, message) {
    if (!this.apiKey || !this.secretKey) {
      throw new Error('Beem credentials missing. Set BEEM_API_KEY and BEEM_SECRET_KEY in .env');
    }

    const dest = this._normalise(to);
    const body = JSON.stringify({
      source_addr: this.sourceAddr,
      encoding:    0,
      message,
      recipients:  [{ recipient_id: 1, dest_addr: dest }],
    });

    const auth = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');

    // Hard deadline for the whole call. Without it a stalled Beem connection
    // holds the HTTP request (and a bulk job's loop) open forever. Kept below
    // the frontend's 30 s timeout so the server always answers first.
    const timeoutMs = Number(process.env.BEEM_SMS_TIMEOUT_MS) || 20000;

    return new Promise((resolve, reject) => {
      let settled = false;
      let flushed = false;   // request body fully handed to the OS → Beem may have it
      const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
      const timer = setTimeout(() => {
        const err = new Error(flushed
          ? `Beem did not answer within ${Math.round(timeoutMs / 1000)}s — delivery is unconfirmed; check before resending.`
          : `Could not reach Beem within ${Math.round(timeoutMs / 1000)}s — the SMS was not sent.`);
        err.code = 'PROVIDER_TIMEOUT';
        if (flushed) err.unconfirmed = true;
        done(reject, err);
        req.destroy();
      }, timeoutMs);

      const req = https.request(
        {
          hostname: 'apisms.beem.africa',
          path:     '/v1/send',
          method:   'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization':  `Basic ${auth}`,
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            let json = {};
            try { json = JSON.parse(raw); } catch { /* non-JSON body */ }

            // Beem returns { successful: true, request_id: ..., code: 100 } on success
            const ok = res.statusCode >= 200 && res.statusCode < 300 && json.successful !== false;
            if (ok) {
              done(resolve, {
                success:             true,
                provider_message_id: json.request_id != null ? String(json.request_id) : null,
              });
            } else {
              done(reject, new Error(json.message || `Beem HTTP ${res.statusCode}`));
            }
          });
          res.on('error', (e) => done(reject, e));
        }
      );

      req.on('finish', () => { flushed = true; });
      req.on('error', (e) => done(reject, e));
      req.write(body);
      req.end();
    });
  }
}

module.exports = BeemProvider;
