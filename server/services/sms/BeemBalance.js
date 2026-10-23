'use strict';

const https = require('https');
const http  = require('http');
const { URL } = require('url');

/**
 * Live Beem SMS credit balance.
 *
 * Endpoint and response are Beem's documented "Get vendor balance"
 * (docs.beem.africa → SMS):
 *   GET https://apisms.beem.africa/public/v1/vendors/balance
 *   200 → { "data": { "credit_balance": <number> } }   — SMS credits, not money
 *   401 → { "code": 120, "message": "Invalid Authentication Parameters" }
 * Auth: HTTP Basic with the SAME key/secret the SMS sender uses
 * (BEEM_API_KEY / BEEM_SECRET_KEY) — nothing new to configure.
 *
 * Env: BEEM_BALANCE_URL (defaults to the documented URL), BEEM_TIMEOUT_MS (default 15000).
 *
 * Guarantees: a failure is ALWAYS reported as a failure — never as 0 credits —
 * and nothing the provider sends back, nor any credential, is logged.
 */

const DEFAULT_URL = 'https://apisms.beem.africa/public/v1/vendors/balance';
const CACHE_MS     = 30_000;   // a plain look reuses an answer this fresh
const MIN_FRESH_MS = 5_000;    // "refresh now" never hits Beem more than once per 5 s

let last = null;               // { balance, checkedAt } — last VERIFIED answer
let inFlight = null;           // one Beem request at a time, shared by every caller

class BalanceError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.code = code;          // NOT_CONFIGURED | TIMEOUT | NETWORK | AUTH | PROVIDER | MALFORMED
    this.httpStatus = httpStatus ?? null;
  }
}

const timeoutMs = () => (Number(process.env.BEEM_TIMEOUT_MS) > 0 ? Number(process.env.BEEM_TIMEOUT_MS) : 15000);

/** A finite number of credits, or null. Accepts a numeric string defensively; nothing else. */
function parseCredits(json) {
  const v = json && typeof json === 'object' && json.data && typeof json.data === 'object'
    ? json.data.credit_balance : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

function requestBalance() {
  const key = process.env.BEEM_API_KEY || '';
  const secret = process.env.BEEM_SECRET_KEY || '';
  if (!key || !secret) {
    return Promise.reject(new BalanceError('NOT_CONFIGURED', 'SMS balance is not configured on the server.'));
  }
  let url;
  try { url = new URL(process.env.BEEM_BALANCE_URL || DEFAULT_URL); }
  catch { return Promise.reject(new BalanceError('NOT_CONFIGURED', 'SMS balance URL is not valid.')); }

  const lib = url.protocol === 'http:' ? http : https;
  const limit = timeoutMs();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); fn(v); };
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined,
      path: url.pathname + url.search, method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}` },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (raw.length < 65536) raw += c; });
      res.on('error', () => finish(reject, new BalanceError('NETWORK', 'The connection to Beem was interrupted.')));
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return finish(reject, new BalanceError('AUTH', 'Beem rejected the SMS account credentials.', res.statusCode));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return finish(reject, new BalanceError('PROVIDER', `Beem could not return the balance (HTTP ${res.statusCode}).`, res.statusCode));
        }
        let json = null;
        try { json = JSON.parse(raw); } catch { /* handled below */ }
        const credits = parseCredits(json);
        if (credits === null) {
          return finish(reject, new BalanceError('MALFORMED', 'Beem returned a response without a valid SMS balance.', res.statusCode));
        }
        finish(resolve, credits);
      });
    });
    const timer = setTimeout(() => {
      finish(reject, new BalanceError('TIMEOUT', `Beem did not answer within ${Math.round(limit / 1000)}s.`));
      req.destroy();
    }, limit);
    req.on('error', () => finish(reject, new BalanceError('NETWORK', 'Could not reach Beem.')));
    req.end();
  });
}

/**
 * @param {{ fresh?: boolean }} opts  fresh: ask Beem now (still de-duplicated and rate-limited)
 * @returns {Promise<{ balance:number, checkedAt:string, cached:boolean }>}
 */
async function getBalance({ fresh = false } = {}) {
  const age = last ? Date.now() - Date.parse(last.checkedAt) : Infinity;
  if (last && age < (fresh ? MIN_FRESH_MS : CACHE_MS)) return { ...last, cached: true };
  if (!inFlight) {
    inFlight = requestBalance()
      .then((balance) => { last = { balance, checkedAt: new Date().toISOString() }; return last; })
      .catch((err) => {
        // code + status only — never the provider body, never credentials
        console.warn(`[sms:balance] ${err.code || 'ERROR'}${err.httpStatus ? ` HTTP ${err.httpStatus}` : ''}`);
        throw err;
      })
      .finally(() => { inFlight = null; });
  }
  const v = await inFlight;
  return { ...v, cached: false };
}

/** The last verified answer, for showing as "last known" next to an error. */
const lastKnown = () => (last ? { ...last } : null);

/** Tests only. */
function __reset() { last = null; inFlight = null; }

module.exports = { getBalance, lastKnown, parseCredits, BalanceError, __reset, DEFAULT_URL };
