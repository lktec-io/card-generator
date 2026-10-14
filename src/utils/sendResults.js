/**
 * Pure helpers for showing WhatsApp / SMS send results (used by BulkSendModal).
 * Kept apart from the component so they can be unit-tested without a browser.
 */

/* ── friendly failure reasons ────────────────────────────────────────────── */

const LONG_TOKEN = /[A-Za-z0-9+/=_-]{32,}/g;   // anything that could be a key or token
const LONG_DIGITS = /\d{9,}/g;                  // full phone numbers inside a message

/** The provider/backend reason, cleaned for display: no tokens, no full numbers. */
export function safeDetail(reason) {
  return String(reason || '')
    .replace(/^\[unconfirmed\]\s*/i, '')
    .replace(LONG_TOKEN, '…')
    .replace(LONG_DIGITS, (d) => `${d.slice(0, 3)}***${d.slice(-3)}`)
    .slice(0, 180);
}

/**
 * Translate a result into words staff can act on. Only claims what the
 * provider actually said: "not on WhatsApp" only when the provider's own
 * reason says so; a lost answer is "could not be confirmed", never "failed".
 */
export function friendlyReason(r, channel) {
  const reason = String(r?.reason || '');
  const code = String(r?.code || '');
  if (r?.outcome === 'unconfirmed' || (code === 'UNCONFIRMED' && r?.outcome !== 'skipped')) {
    return 'Connection timed out; delivery could not be confirmed';
  }
  if (r?.outcome === 'skipped') {
    if (code === 'ALREADY_SENT') return 'Already sent earlier — not sent again';
    if (code === 'UNCONFIRMED')  return 'An earlier attempt was not confirmed — not resent automatically';
    return 'Skipped';
  }
  if (r?.outcome === 'accepted') return channel === 'whatsapp' ? 'Accepted by WhatsApp provider' : 'Accepted by SMS provider';
  if (code === 'INVALID_PHONE' || /invalid (phone|number|destination|msisdn)|invalid destination_addr/i.test(reason)) return 'Invalid phone number';
  if (channel === 'whatsapp' && /not (a )?(valid )?whatsapp (user|number|account)|not on whatsapp|not registered on whatsapp|no whatsapp account/i.test(reason)) {
    return 'This number is not available on WhatsApp';
  }
  if (/invalid authentication|unauthori[sz]ed|authenticat|no authorization|HTTP 401|HTTP 403/i.test(reason)) return 'Sending service authentication failed';
  if (/rate.?limit|too many requests|HTTP 429|throttl/i.test(reason)) return 'Sending limit reached; try again later';
  if (/template/i.test(reason)) return 'Required message template is unavailable';
  if (code === 'WHATSAPP_NOT_CONFIGURED' || code === 'NO_FROM_ADDR' || /not configured|credentials missing/i.test(reason)) return 'Sending service is not configured';
  if (/could not reach|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up/i.test(reason)) return 'Could not reach the sending service; the message was not sent';
  if (code === 'PROVIDER_REJECTED' || /rejected|HTTP 4\d\d/i.test(reason)) return 'Message rejected by the sending service';
  return 'Sending failed for an unknown reason';
}

/** One shape for both channels' progress objects. */
export function normaliseJob(job) {
  if (!job) return null;
  const total       = Math.max(0, Number(job.total) || 0);
  const sent        = Number(job.sent) || 0;
  const failedAll   = Number(job.failed) || 0;           // includes unconfirmed
  const unconfirmed = Math.min(failedAll, Number(job.unconfirmed) || 0);
  const skipped     = Number(job.skipped) || 0;
  const completed   = Number.isFinite(Number(job.completed)) ? Number(job.completed) : sent + failedAll + skipped;
  const finished    = Boolean(job.finished ?? job.done);
  const notProcessed = finished ? Math.max(0, Number(job.not_processed) || 0) : 0;
  return {
    total, sent, unconfirmed, skipped, completed, finished, notProcessed,
    failed: failedAll - unconfirmed,                       // definite failures only
    pending: finished ? 0 : Math.max(0, total - completed),
    cancelled: Boolean(job.cancelled),
    cancelRequested: Boolean(job.cancel_requested),
    current: job.current_guest || null,
    results: Array.isArray(job.results) ? job.results : null,
  };
}
