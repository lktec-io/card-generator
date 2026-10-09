'use strict';

/**
 * WhatsApp sending, campaigns, logs and delivery callbacks.
 *
 * Kept entirely separate from smsController: different provider, different
 * table, different rules. Nothing here reads or writes sms_logs.
 *
 * Event isolation is the rule that matters most: every query is constrained by
 * event_id AND by the caller's event scope, and a delivery callback can only
 * ever update the single log row it correlates to.
 */

const crypto = require('crypto');

const pool = require('../config/db');
const { withConnection, poolStats } = require('../config/db');
const WhatsAppService = require('../services/whatsapp/WhatsAppService');
const { getConfig } = require('../config/whatsapp');
const { validatePhone } = require('../utils/phone');
const { eventScopeSQL } = require('../middleware/authMiddleware');
const { RANK } = require('../services/whatsapp/BeemWhatsAppProvider');

// Statuses that mean "this guest already got it" — never re-sent automatically.
const SUCCESSFUL = ['accepted', 'sent', 'delivered', 'read'];
const PAGE_SIZE_MAX = 100;

// ── helpers ─────────────────────────────────────────────────────────────────

/** The event, only if this user may manage it. */
async function loadScopedEvent(eventId, user) {
  const scope = eventScopeSQL(user);
  const [[event]] = await pool.execute(
    `SELECT e.id, e.event_name, e.event_date, e.event_time, e.venue, e.event_mode
       FROM events e
      WHERE e.id = ? ${scope.where || ''}`,
    [eventId, ...(scope.params || [])]
  );
  return event || null;
}

/** Public origin for invitation links and card media. */
function siteBaseUrl(req) {
  const configured = String(process.env.PUBLIC_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `${proto}://${host}` : '';
}

const newReference = () => `wa_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;

/**
 * Insert a log row before the provider is called, so a send that never returns
 * still leaves a trace. Returns the new row's id.
 */
async function openLog({ event_id, invitation, phone, reference, message, media_url }) {
  const cfg = getConfig();
  const [res] = await pool.execute(
    `INSERT INTO whatsapp_logs
       (event_id, invitation_id, guest_name, phone_number, template_id, template_name,
        template_language, message_reference, provider, message, media_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending')`,
    [
      event_id || null,
      invitation?.id || null,
      invitation?.guest_name || null,
      phone,
      cfg.templateId || null,
      cfg.templateId || null,
      cfg.language || null,
      reference,
      WhatsAppService.providerName(),
      message || null,
      media_url || null,
    ]
  );
  return res.insertId;
}

async function markSent(logId, result) {
  await pool.execute(
    `UPDATE whatsapp_logs
        SET status = ?, beem_job_id = ?, provider_message_id = ?, provider_status = ?,
            sent_at = NOW(), accepted_at = CASE WHEN ? = 'accepted' THEN NOW() ELSE accepted_at END,
            error_message = NULL
      WHERE id = ?`,
    [result.status || 'accepted', result.job_id || null, result.provider_message_id || null,
     result.status || 'accepted', result.status || 'accepted', logId]
  );
}

async function markFailed(logId, message) {
  await pool.execute(
    `UPDATE whatsapp_logs
        SET status = 'failed', failed_at = NOW(), error_message = ?
      WHERE id = ?`,
    [String(message || 'send failed').slice(0, 1000), logId]
  );
}

/** Has this invitation already been delivered to successfully? */
async function alreadySent(invitationId) {
  if (!invitationId) return false;
  const [[row]] = await pool.execute(
    `SELECT id FROM whatsapp_logs
      WHERE invitation_id = ? AND status IN (${SUCCESSFUL.map(() => '?').join(',')})
      LIMIT 1`,
    [invitationId, ...SUCCESSFUL]
  );
  return Boolean(row);
}

/**
 * Marks a failure whose outcome is unknown: the request reached Beem but no
 * answer came back, so the message may well have been delivered. Stored on
 * error_message (no schema change) and recognised by the bulk paths below.
 */
const UNCONFIRMED_PREFIX = '[unconfirmed] ';

/** Was the last attempt for this invitation one whose outcome is unknown? */
async function hasUnconfirmed(invitationId) {
  if (!invitationId) return false;
  const [[row]] = await pool.execute(
    `SELECT id FROM whatsapp_logs
      WHERE invitation_id = ? AND status = 'failed' AND error_message LIKE ?
      LIMIT 1`,
    // MySQL LIKE treats only % and _ as wildcards, so the brackets match literally
    [invitationId, `${UNCONFIRMED_PREFIX}%`]
  );
  return Boolean(row);
}

/**
 * Send one invitation and record it. Shared by every flow, so single, bulk and
 * retry behave identically.
 *
 * `holdUnconfirmed`: bulk flows pass true, so a guest whose earlier send may
 * already have been delivered is not messaged a second time automatically. A
 * single, deliberate per-guest send leaves it false — that is a person choosing
 * to resend.
 * @returns {Promise<{ ok:boolean, log_id:number|null, reason?:string, code?:string }>}
 */
async function sendOne({ invitation, event, baseUrl, force = false, holdUnconfirmed = false }) {
  if (!force && await alreadySent(invitation.id)) {
    return { ok: false, skipped: true, code: 'ALREADY_SENT', log_id: null,
             reason: `${invitation.guest_name || 'This guest'} already has a successful WhatsApp invitation.` };
  }
  if (holdUnconfirmed && await hasUnconfirmed(invitation.id)) {
    return { ok: false, skipped: true, code: 'UNCONFIRMED', log_id: null,
             reason: `${invitation.guest_name || 'This guest'} may already have received it — Beem did not confirm the earlier send. Resend to this guest individually if needed.` };
  }

  const check = validatePhone(invitation.phone_number);
  const reference = newReference();

  // An unusable number is still logged as a failure — it is a real outcome the
  // campaign summary must show, not something to drop quietly.
  if (!check.ok) {
    const logId = await openLog({
      event_id: event.id, invitation, phone: String(invitation.phone_number || '').slice(0, 32) || '-',
      reference, message: null, media_url: null,
    });
    await markFailed(logId, check.reason);
    return { ok: false, log_id: logId, code: 'INVALID_PHONE', reason: check.reason };
  }

  const params = WhatsAppService.templateParams({
    invitation, event,
    inviteUrl: invitation.invitation_uuid && baseUrl ? `${baseUrl}/invite/${invitation.invitation_uuid}` : '',
  });
  const mediaUrl = WhatsAppService.absoluteHttpsUrl(invitation.image_url, baseUrl);

  const logId = await openLog({
    event_id: event.id, invitation, phone: check.phone, reference,
    message: JSON.stringify(params), media_url: mediaUrl,
  });

  try {
    const result = await WhatsAppService.sendWhatsAppInvitation({
      invitation, event, baseUrl, reference,
    });
    await markSent(logId, result);
    return { ok: true, log_id: logId, job_id: result.job_id };
  } catch (err) {
    // An answer that never came is not the same as a refusal: say so, and keep
    // it out of automatic resends.
    const reason = err.unconfirmed
      ? `${UNCONFIRMED_PREFIX}${err.message} — the message may have been delivered; check before resending.`
      : err.message;
    await markFailed(logId, reason);
    return { ok: false, log_id: logId, code: err.unconfirmed ? 'UNCONFIRMED' : (err.code || 'SEND_FAILED'), reason };
  }
}

// ── GET /whatsapp/status ────────────────────────────────────────────────────
// Lets the UI say exactly what is missing, without ever seeing a credential.
function getStatus(req, res) {
  res.json({ success: true, whatsapp: WhatsAppService.publicStatus() });
}

// ── POST /whatsapp/send/:invitation_id ──────────────────────────────────────
async function sendSingle(req, res) {
  const invId = parseInt(req.params.invitation_id, 10);
  if (!invId) return res.status(400).json({ success: false, message: 'Invalid invitation ID.' });

  try {
    const [[inv]] = await pool.execute(
      `SELECT id, code, guest_name, phone_number, event_id, image_url, invitation_uuid
         FROM invitations WHERE id = ?`,
      [invId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found.' });

    const event = await loadScopedEvent(inv.event_id, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const cfgError = WhatsAppService.configurationError();
    if (cfgError) return res.status(503).json({ success: false, message: cfgError, code: 'WHATSAPP_NOT_CONFIGURED' });

    const force = req.body?.force === true || req.body?.force === 'true';
    const out = await sendOne({ invitation: inv, event, baseUrl: siteBaseUrl(req), force });

    if (out.skipped) return res.status(409).json({ success: false, message: out.reason, code: out.code });
    if (!out.ok)     return res.status(502).json({ success: false, message: out.reason, code: out.code, log_id: out.log_id });

    res.json({ success: true, message: `WhatsApp invitation sent to ${inv.guest_name}.`, log_id: out.log_id, job_id: out.job_id });
  } catch (err) {
    console.error('[whatsapp:sendSingle]', err);
    res.status(500).json({ success: false, message: 'Failed to send the WhatsApp invitation.' });
  }
}

// ── campaigns ───────────────────────────────────────────────────────────────
// Same in-memory polling model as the SMS and bulk-generation jobs.
const _jobs = new Map();
const JOB_TTL = 60 * 60 * 1000;
const _running = new Set();          // event ids with a campaign in flight

function createJob(eventId, total, userId) {
  for (const [k, v] of _jobs) if (Date.now() - v.startedAt > JOB_TTL) _jobs.delete(k);
  const id = `wa_${eventId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  _jobs.set(id, {
    id, eventId, userId, total, sent: 0, failed: 0, skipped: 0, completed: 0,
    current: null, finished: false, startedAt: Date.now(), finishedAt: null, failures: [],
  });
  return _jobs.get(id);
}

/**
 * POST /whatsapp/bulk/:event_id
 * Body: { invitation_ids?: number[] }  — omitted means every eligible guest.
 * Returns a job id immediately; the sending happens in the background.
 */
async function sendBulk(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const cfgError = WhatsAppService.configurationError();
    if (cfgError) return res.status(503).json({ success: false, message: cfgError, code: 'WHATSAPP_NOT_CONFIGURED' });

    if (_running.has(eventId)) {
      return res.status(409).json({ success: false, message: 'A WhatsApp campaign is already running for this event.' });
    }

    const ids = Array.isArray(req.body?.invitation_ids)
      ? req.body.invitation_ids.map((n) => parseInt(n, 10)).filter(Boolean)
      : null;
    if (ids && ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No guests selected.' });
    }

    // Scoped to this event in the query itself: a selected id belonging to
    // another event simply does not come back.
    const [rows] = ids
      ? await pool.query(
          `SELECT id, code, guest_name, phone_number, event_id, image_url, invitation_uuid
             FROM invitations
            WHERE event_id = ? AND id IN (?) AND phone_number IS NOT NULL AND phone_number <> ''`,
          [eventId, ids])
      : await pool.execute(
          `SELECT id, code, guest_name, phone_number, event_id, image_url, invitation_uuid
             FROM invitations
            WHERE event_id = ? AND phone_number IS NOT NULL AND phone_number <> ''`,
          [eventId]);

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No guests with phone numbers for this selection.' });
    }

    const job = createJob(eventId, rows.length, req.user?.id ?? null);
    _running.add(eventId);
    res.status(202).json({ success: true, job_id: job.id, total: rows.length, event_id: eventId });

    const baseUrl = siteBaseUrl(req);
    setImmediate(() => runCampaign(job, rows, event, baseUrl));
  } catch (err) {
    console.error('[whatsapp:sendBulk]', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to start the WhatsApp campaign.' });
  }
}

/** The campaign loop. One guest failing never stops the rest. */
async function runCampaign(job, rows, event, baseUrl, { force = false } = {}) {
  const gap = Math.max(0, Math.round(1000 / Math.max(1, getConfig().ratePerSecond)));
  try {
    for (const inv of rows) {
      job.current = inv.guest_name;
      try {
        // campaigns never automatically resend an unconfirmed earlier attempt
        const out = await sendOne({ invitation: inv, event, baseUrl, force, holdUnconfirmed: true });
        if (out.ok)           job.sent++;
        else if (out.skipped) job.skipped++;
        else {
          job.failed++;
          if (job.failures.length < 200) {
            job.failures.push({
              invitation_id: inv.id, log_id: out.log_id, code: inv.code,
              guest_name: inv.guest_name, phone_number: inv.phone_number, reason: out.reason,
            });
          }
        }
      } catch (err) {
        job.failed++;
        console.error(`[whatsapp:campaign] ${inv.code} unexpected: ${err.message}`);
      } finally {
        job.completed++;
      }
      if (gap) await new Promise((r) => setTimeout(r, gap));   // provider rate limit
    }
  } finally {
    job.current = null;
    job.finished = true;
    job.finishedAt = Date.now();
    _running.delete(job.eventId);
    console.log(`[whatsapp] job=${job.id} event=${job.eventId} sent=${job.sent} failed=${job.failed} skipped=${job.skipped}`);
  }
}

// ── GET /whatsapp/bulk/progress/:job_id ─────────────────────────────────────
function getProgress(req, res) {
  const job = _jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ success: false, message: 'That campaign has expired. Open the WhatsApp logs to see what was sent.' });
  if (job.userId && req.user?.id !== job.userId && req.user?.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'That campaign belongs to another user.' });
  }
  res.json({
    success: true, job_id: job.id, event_id: job.eventId,
    total: job.total, completed: job.completed, sent: job.sent,
    failed: job.failed, skipped: job.skipped,
    percent: job.total ? Math.floor((job.completed / job.total) * 100) : 100,
    current_guest: job.current, finished: job.finished,
    started_at: job.startedAt, finished_at: job.finishedAt,
    failures: job.failures,
  });
}

// ── POST /whatsapp/retry/:event_id ──────────────────────────────────────────
// Only failed rows, and only this event's.
async function retryFailed(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const cfgError = WhatsAppService.configurationError();
    if (cfgError) return res.status(503).json({ success: false, message: cfgError, code: 'WHATSAPP_NOT_CONFIGURED' });
    if (_running.has(eventId)) {
      return res.status(409).json({ success: false, message: 'A WhatsApp campaign is already running for this event.' });
    }

    // Guests whose attempts failed and who have never succeeded since —
    // EXCLUDING any guest with an unconfirmed attempt. Those may already have
    // the message (Beem received the request; only its answer was lost), so a
    // blanket retry would risk sending them a duplicate.
    const [rows] = await pool.execute(
      `SELECT DISTINCT i.id, i.code, i.guest_name, i.phone_number, i.event_id, i.image_url, i.invitation_uuid
         FROM whatsapp_logs w
         JOIN invitations i ON i.id = w.invitation_id
        WHERE w.event_id = ? AND w.status = 'failed'
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_logs ok
             WHERE ok.invitation_id = w.invitation_id
               AND ok.status IN ('accepted','sent','delivered','read'))
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_logs u
             WHERE u.invitation_id = w.invitation_id
               AND u.status = 'failed' AND u.error_message LIKE ?)`,
      [eventId, `${UNCONFIRMED_PREFIX}%`]
    );

    // How many were held back, so the UI can say so rather than hide them.
    const [[held]] = await pool.execute(
      `SELECT COUNT(DISTINCT w.invitation_id) AS n
         FROM whatsapp_logs w
        WHERE w.event_id = ? AND w.status = 'failed' AND w.error_message LIKE ?
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_logs ok
             WHERE ok.invitation_id = w.invitation_id
               AND ok.status IN ('accepted','sent','delivered','read'))`,
      [eventId, `${UNCONFIRMED_PREFIX}%`]
    );
    const heldBack = Number(held?.n) || 0;

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        held_back: heldBack,
        message: heldBack
          ? `Nothing to retry automatically. ${heldBack} guest${heldBack > 1 ? 's' : ''} may already have the message (Beem did not confirm) — resend to them individually only after checking.`
          : 'Nothing failed for this event.',
      });
    }

    const job = createJob(eventId, rows.length, req.user?.id ?? null);
    _running.add(eventId);
    res.status(202).json({ success: true, job_id: job.id, total: rows.length, retrying: rows.length, held_back: heldBack });

    const baseUrl = siteBaseUrl(req);
    // force: these rows have no successful send, so the duplicate guard would
    // not block them anyway — being explicit keeps the intent obvious.
    setImmediate(() => runCampaign(job, rows, event, baseUrl, { force: true }));
  } catch (err) {
    console.error('[whatsapp:retryFailed]', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to start the retry.' });
  }
}

// ── read endpoints: bounded, single-connection ──────────────────────────────
//
// Measured on a production-sized copy (1,434 logs, a 641-guest event) the logs
// request costs 2–8 ms of SQL, and stays under 400 ms even at 100,000 rows. The
// 30 s timeout seen in production was therefore never the query: it was the
// request waiting for a pool connection that was busy elsewhere (the pool queues
// without limit). Reproduced locally — with all ten connections busy, the request
// sat queued until the browser gave up, and was still queued afterwards.
//
// So these endpoints:
//   - take ONE connection for all their statements, with a bounded wait;
//   - answer 503 "busy" within seconds instead of hanging;
//   - skip the work entirely if the browser has already gone away.

const READ_ACQUIRE_TIMEOUT_MS = 8000;   // well inside the browser's 30 s
const READ_QUERY_TIMEOUT_MS   = 10000;  // a runaway statement cannot hold a connection

/**
 * Track whether the client really went away, from the RESPONSE side.
 *
 * An earlier version read `req.destroyed`. Node marks a request "destroyed" as
 * soon as its body has been fully read — so any request whose body was parsed
 * (express.json() reads even a GET's body) looked "gone", and the handler
 * returned without ever answering. Reproduced: an idle-server GET with a JSON
 * body hung for the full 30 s. The response's 'close' firing before the
 * response finished is the one signal that means the client actually left.
 */
function trackClient(res) {
  const state = { gone: false };
  // Called before the handler's try: it must never throw (Express 4 would
  // leave the request unanswered), so tolerate a response without .on().
  if (typeof res.on === 'function') {
    res.on('close', () => { if (!res.writableEnded) state.gone = true; });
  }
  return state;
}

/** loadScopedEvent, on a connection the caller already holds. */
async function scopedEventOn(conn, eventId, user) {
  const scope = eventScopeSQL(user);
  const [[event]] = await conn.execute(
    { sql: `SELECT e.id, e.event_name, e.event_date, e.event_time, e.venue, e.event_mode
              FROM events e WHERE e.id = ? ${scope.where || ''}`, timeout: READ_QUERY_TIMEOUT_MS },
    [eventId, ...(scope.params || [])]
  );
  return event || null;
}

/** Map a failure to a response the UI can act on, without database detail. */
function sendReadError(res, err, label, fallback) {
  if (res.headersSent) return;
  if (err && err.code === 'DB_BUSY') {
    const stats = poolStats();
    console.warn(`[whatsapp:${label}] no DB connection within ${err.waitedMs} ms — pool open=${stats.open}/${stats.limit} free=${stats.free} queued=${stats.queued}`);
    res.set('Retry-After', '3');
    return res.status(503).json({ success: false, code: 'DB_BUSY', message: err.message });
  }
  if (err && err.code === 'PROTOCOL_SEQUENCE_TIMEOUT') {
    console.warn(`[whatsapp:${label}] query exceeded ${READ_QUERY_TIMEOUT_MS} ms`);
    return res.status(504).json({ success: false, code: 'DB_TIMEOUT', message: 'The database took too long to answer. Please try again.' });
  }
  console.error(`[whatsapp:${label}]`, err?.message || err);
  return res.status(500).json({ success: false, message: fallback });
}

// ── GET /whatsapp/summary/:event_id ─────────────────────────────────────────
// Real counts, straight from the table, for this event only.
async function getSummary(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  const client = trackClient(res);

  try {
    const result = await withConnection(async (conn) => {
      if (client.gone) return null;
      const event = await scopedEventOn(conn, eventId, req.user);
      if (!event) return { notFound: true };

      const [rows] = await conn.execute(
        { sql: 'SELECT status, COUNT(*) AS n FROM whatsapp_logs WHERE event_id = ? GROUP BY status', timeout: READ_QUERY_TIMEOUT_MS },
        [eventId]
      );
      const [[eligible]] = await conn.execute(
        { sql: `SELECT COUNT(*) AS n FROM invitations
                 WHERE event_id = ? AND phone_number IS NOT NULL AND phone_number <> ''`, timeout: READ_QUERY_TIMEOUT_MS },
        [eventId]
      );
      return { rows, eligible };
    }, { acquireTimeoutMs: READ_ACQUIRE_TIMEOUT_MS });

    if (result === null) { if (!res.headersSent) res.status(499).end(); return; }  // client gone — nothing to send, never leave it open
    if (result.notFound) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const counts = { pending: 0, sending: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    let total = 0;
    for (const r of result.rows) {
      counts[r.status] = Number(r.n) || 0;
      total += Number(r.n) || 0;
    }

    res.json({
      success: true, event_id: eventId, total, counts,
      eligible_guests: Number(result.eligible.n) || 0,
      running: _running.has(eventId),
      whatsapp: WhatsAppService.publicStatus(),
    });
  } catch (err) {
    sendReadError(res, err, 'getSummary', 'Failed to load the WhatsApp summary.');
  }
}

// ── GET /whatsapp/logs/:event_id ────────────────────────────────────────────
// Server-side search + pagination. Hundreds of thousands of rows must never be
// shipped to the browser to be filtered there.
async function getLogs(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  const client = trackClient(res);

  const q      = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const size   = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(req.query.page_size, 10) || 25));

  // event_id first and always: this is the event-isolation guarantee.
  const where = ['w.event_id = ?'];
  const params = [eventId];

  if (status && status !== 'all') {
    where.push('w.status = ?');
    params.push(status);
  }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(w.guest_name LIKE ? OR w.phone_number LIKE ? OR i.code LIKE ?
                 OR w.beem_job_id LIKE ? OR w.provider_message_id LIKE ? OR w.message_reference LIKE ?)`);
    params.push(like, like, like, like, like, like);
  }
  const whereSql = where.join(' AND ');

  // The invitations join exists only so a search can match the CN code. Without
  // a search term it cannot change the count — invitations.id is the primary
  // key, so the LEFT JOIN never adds rows — but it forced a lookup per log row.
  // Measured: 122 ms of a 124 ms first page at 100k rows. Joined only when needed.
  const countSql = q
    ? `SELECT COUNT(*) AS n FROM whatsapp_logs w LEFT JOIN invitations i ON i.id = w.invitation_id WHERE ${whereSql}`
    : `SELECT COUNT(*) AS n FROM whatsapp_logs w WHERE ${whereSql}`;

  try {
    const result = await withConnection(async (conn) => {
      if (client.gone) return null;
      const event = await scopedEventOn(conn, eventId, req.user);
      if (!event) return { notFound: true };

      const [[{ n: total }]] = await conn.execute({ sql: countSql, timeout: READ_QUERY_TIMEOUT_MS }, params);
      if (client.gone) return null;

      const [logs] = await conn.execute(
        { sql: `SELECT w.id, w.event_id, w.invitation_id, w.guest_name, w.phone_number,
                       w.template_id, w.template_language, w.beem_job_id, w.provider_message_id,
                       w.message_reference, w.status, w.provider_status, w.error_message, w.media_url,
                       w.sent_at, w.accepted_at, w.delivered_at, w.read_at, w.failed_at, w.created_at,
                       i.code AS invitation_code
                  FROM whatsapp_logs w
                  LEFT JOIN invitations i ON i.id = w.invitation_id
                 WHERE ${whereSql}
                 ORDER BY w.created_at DESC, w.id DESC
                 LIMIT ${size} OFFSET ${(page - 1) * size}`, timeout: READ_QUERY_TIMEOUT_MS },
        params
      );
      return { event, total, logs };
    }, { acquireTimeoutMs: READ_ACQUIRE_TIMEOUT_MS });

    if (result === null) { if (!res.headersSent) res.status(499).end(); return; }  // client gone — nothing to send, never leave it open
    if (result.notFound) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const total = Number(result.total) || 0;
    res.json({
      success: true, logs: result.logs,
      page, page_size: size, total,
      pages: Math.max(1, Math.ceil(total / size)),
      event: { id: result.event.id, event_name: result.event.event_name },
    });
  } catch (err) {
    sendReadError(res, err, 'getLogs', 'Failed to load the WhatsApp logs.');
  }
}

// ── callback authentication ─────────────────────────────────────────────────

/** Constant-time string equality that never throws on a length mismatch. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Top-level field names of a callback body — names only, never values. */
function bodyKeys(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).slice(0, 20) : [];
}

/**
 * Decide whether a callback carries the shared secret.
 *
 * Every place the secret can travel is collected, and the callback is accepted
 * if ANY of them matches exactly. The previous version took only the FIRST
 * non-empty source, so a header Beem sends for its own purposes (its own
 * Authorization or signature header) would shadow a perfectly correct
 * ?secret= and fail every callback. Requiring an exact match on each candidate
 * means this accepts nothing the old check would have rejected for a good reason.
 *
 * On rejection, says what kind of mismatch it was — without revealing either
 * value — because "bad secret" alone cannot tell a missing secret from one that
 * was mangled in the URL.
 *
 * @returns {{ ok: boolean, reason?: string, advice?: string, headers: string[] }}
 */
function checkCallbackSecret(req, secret) {
  const headers = ['x-beem-signature', 'x-webhook-secret', 'authorization'].filter((h) => req.get(h));
  const bearer  = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')?.[1];

  const candidates = [
    req.get('x-beem-signature'), req.get('x-webhook-secret'), bearer,
    // a repeated ?secret= arrives as an array
    ...[].concat(req.query?.secret ?? []),
    req.body && typeof req.body === 'object' ? req.body.secret : undefined,
  ].filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());

  if (candidates.some((c) => safeEqual(c, secret))) return { ok: true, headers };

  if (!candidates.length) {
    return { ok: false, headers, reason: 'no secret presented',
      advice: 'Nothing carried a secret. Beem sends no secret header of its own — register the callback URL as …/webhooks/beem/whatsapp?secret=<URL-encoded BEEM_WHATSAPP_CALLBACK_SECRET>, or leave the secret unset.' };
  }

  // Classify without exposing anything: these compare transformed copies only.
  if (candidates.some((c) => safeEqual(c.replace(/ /g, '+'), secret))) {
    return { ok: false, headers, reason: "secret arrived with '+' turned into spaces",
      advice: "The secret contains '+', which a URL query decodes as a space. URL-encode it in the callback URL ('+' → %2B), or replace it with a hex secret (e.g. openssl rand -hex 32)." };
  }
  if (candidates.some((c) => { try { return safeEqual(decodeURIComponent(c), secret); } catch { return false; } })) {
    return { ok: false, headers, reason: 'secret arrived still URL-encoded (double-encoded)',
      advice: 'The callback URL encodes the secret twice. Encode it once.' };
  }
  // constant-time prefix check, and only for candidates long enough not to be a guess
  if (candidates.some((c) => c.length >= 8 && c.length < secret.length && safeEqual(c, secret.slice(0, c.length)))) {
    return { ok: false, headers, reason: 'secret arrived truncated',
      advice: "The secret contains a character that ends the URL query ('&' or '#'). URL-encode it, or use a hex secret (openssl rand -hex 32)." };
  }
  return { ok: false, headers, reason: `secret did not match (${candidates.length} candidate${candidates.length > 1 ? 's' : ''} checked)`,
    advice: 'The value presented is not BEEM_WHATSAPP_CALLBACK_SECRET. Check the callback URL registered with Beem matches the server .env, and that the API was restarted after the .env changed.' };
}

// ── POST /webhooks/beem/whatsapp ────────────────────────────────────────────
/**
 * Beem delivery reports.
 *
 * Public and unauthenticated by necessity, so it is written to be boring: it
 * answers 200 quickly, never trusts the payload, correlates on ids we issued,
 * and updates exactly one row. An unrecognised callback is logged and
 * acknowledged — making Beem retry forever would help nobody.
 */
async function deliveryWebhook(req, res) {
  // Beem's callback verification handshake, when enabled.
  const challenge = req.query?.challenge || req.query?.hub_challenge || req.body?.challenge;
  if (challenge && req.method === 'GET') return res.status(200).send(String(challenge));

  const cfg = getConfig();
  if (cfg.callbackSecret) {
    const verdict = checkCallbackSecret(req, cfg.callbackSecret);
    if (!verdict.ok) {
      // Enough to diagnose from the log alone — never a secret value, never a
      // phone number or message body. Only names, counts and a classification.
      console.warn(`[whatsapp:webhook] rejected a callback (${verdict.reason}). ` +
        `path=${req.path} query_keys=[${Object.keys(req.query || {}).join(',') || 'none'}] ` +
        `headers=[${verdict.headers.join(',') || 'none'}] ` +
        `body_keys=[${bodyKeys(req.body).join(',') || 'none'}]. ${verdict.advice}`);
      return res.status(401).json({ success: false });
    }
  }

  // Acknowledge first: the provider should never wait on our database.
  res.status(200).json({ success: true });

  try {
    const parsed = WhatsAppService.parseCallback(req.body);
    if (!parsed.matched || !parsed.status) {
      console.warn('[whatsapp:webhook] unmatched callback:', JSON.stringify(req.body || {}).slice(0, 400));
      return;
    }

    // Correlate on the ids we control first, then on the provider's.
    const [[log]] = await pool.execute(
      `SELECT id, status FROM whatsapp_logs
        WHERE (? IS NOT NULL AND message_reference = ?)
           OR (? IS NOT NULL AND beem_job_id = ?)
           OR (? IS NOT NULL AND provider_message_id = ?)
        ORDER BY id DESC LIMIT 1`,
      [parsed.reference, parsed.reference, parsed.job_id, parsed.job_id,
       parsed.provider_message_id, parsed.provider_message_id]
    );

    if (!log) {
      console.warn(`[whatsapp:webhook] no log matches job=${parsed.job_id} ref=${parsed.reference} msg=${parsed.provider_message_id}`);
      return;
    }

    // A duplicate or out-of-order callback must not walk the status backwards:
    // "delivered" arriving after "read" is ignored.
    if ((RANK[parsed.status] ?? 0) <= (RANK[log.status] ?? 0) && parsed.status !== 'failed') {
      return;
    }

    const stampColumn = {
      accepted: 'accepted_at', sent: 'sent_at', delivered: 'delivered_at',
      read: 'read_at', failed: 'failed_at',
    }[parsed.status];

    await pool.execute(
      `UPDATE whatsapp_logs
          SET status = ?, provider_status = ?,
              ${stampColumn} = COALESCE(${stampColumn}, NOW()),
              error_message = ?,
              provider_message_id = COALESCE(provider_message_id, ?),
              beem_job_id = COALESCE(beem_job_id, ?)
        WHERE id = ?`,
      [parsed.status, parsed.raw_status, parsed.status === 'failed' ? (parsed.error || 'failed at provider') : null,
       parsed.provider_message_id, parsed.job_id, log.id]
    );
    console.log(`[whatsapp:webhook] log ${log.id}: ${log.status} → ${parsed.status}`);
  } catch (err) {
    console.error('[whatsapp:webhook]', err.message);
  }
}

module.exports = {
  getStatus, sendSingle, sendBulk, getProgress, retryFailed, getSummary, getLogs, deliveryWebhook,
  // exported for tests
  sendOne, alreadySent, SUCCESSFUL,
};
