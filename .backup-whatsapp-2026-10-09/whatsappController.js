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
 * Send one invitation and record it. Shared by every flow, so single, bulk and
 * retry behave identically.
 * @returns {Promise<{ ok:boolean, log_id:number|null, reason?:string, code?:string }>}
 */
async function sendOne({ invitation, event, baseUrl, force = false }) {
  if (!force && await alreadySent(invitation.id)) {
    return { ok: false, skipped: true, code: 'ALREADY_SENT', log_id: null,
             reason: `${invitation.guest_name || 'This guest'} already has a successful WhatsApp invitation.` };
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
    await markFailed(logId, err.message);
    return { ok: false, log_id: logId, code: err.code || 'SEND_FAILED', reason: err.message };
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
        const out = await sendOne({ invitation: inv, event, baseUrl, force });
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

    // Guests whose latest attempt failed and who have never succeeded since.
    const [rows] = await pool.execute(
      `SELECT DISTINCT i.id, i.code, i.guest_name, i.phone_number, i.event_id, i.image_url, i.invitation_uuid
         FROM whatsapp_logs w
         JOIN invitations i ON i.id = w.invitation_id
        WHERE w.event_id = ? AND w.status = 'failed'
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_logs ok
             WHERE ok.invitation_id = w.invitation_id
               AND ok.status IN ('accepted','sent','delivered','read'))`,
      [eventId]
    );
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing failed for this event.' });
    }

    const job = createJob(eventId, rows.length, req.user?.id ?? null);
    _running.add(eventId);
    res.status(202).json({ success: true, job_id: job.id, total: rows.length, retrying: rows.length });

    const baseUrl = siteBaseUrl(req);
    // force: these rows have no successful send, so the duplicate guard would
    // not block them anyway — being explicit keeps the intent obvious.
    setImmediate(() => runCampaign(job, rows, event, baseUrl, { force: true }));
  } catch (err) {
    console.error('[whatsapp:retryFailed]', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to start the retry.' });
  }
}

// ── GET /whatsapp/summary/:event_id ─────────────────────────────────────────
// Real counts, straight from the table, for this event only.
async function getSummary(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const [rows] = await pool.execute(
      `SELECT status, COUNT(*) AS n FROM whatsapp_logs WHERE event_id = ? GROUP BY status`,
      [eventId]
    );
    const counts = { pending: 0, sending: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
    let total = 0;
    for (const r of rows) {
      counts[r.status] = Number(r.n) || 0;
      total += Number(r.n) || 0;
    }

    const [[eligible]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM invitations
        WHERE event_id = ? AND phone_number IS NOT NULL AND phone_number <> ''`,
      [eventId]
    );

    res.json({
      success: true, event_id: eventId, total, counts,
      eligible_guests: Number(eligible.n) || 0,
      running: _running.has(eventId),
      whatsapp: WhatsAppService.publicStatus(),
    });
  } catch (err) {
    console.error('[whatsapp:getSummary]', err);
    res.status(500).json({ success: false, message: 'Failed to load the WhatsApp summary.' });
  }
}

// ── GET /whatsapp/logs/:event_id ────────────────────────────────────────────
// Server-side search + pagination. Hundreds of thousands of rows must never be
// shipped to the browser to be filtered there.
async function getLogs(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

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

    const [[{ n: total }]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM whatsapp_logs w
         LEFT JOIN invitations i ON i.id = w.invitation_id
        WHERE ${whereSql}`,
      params
    );

    const [logs] = await pool.execute(
      `SELECT w.id, w.event_id, w.invitation_id, w.guest_name, w.phone_number,
              w.template_id, w.template_language, w.beem_job_id, w.provider_message_id,
              w.message_reference, w.status, w.provider_status, w.error_message, w.media_url,
              w.sent_at, w.accepted_at, w.delivered_at, w.read_at, w.failed_at, w.created_at,
              i.code AS invitation_code
         FROM whatsapp_logs w
         LEFT JOIN invitations i ON i.id = w.invitation_id
        WHERE ${whereSql}
        ORDER BY w.created_at DESC, w.id DESC
        LIMIT ${size} OFFSET ${(page - 1) * size}`,
      params
    );

    res.json({
      success: true, logs,
      page, page_size: size, total: Number(total) || 0,
      pages: Math.max(1, Math.ceil((Number(total) || 0) / size)),
      event: { id: event.id, event_name: event.event_name },
    });
  } catch (err) {
    console.error('[whatsapp:getLogs]', err);
    res.status(500).json({ success: false, message: 'Failed to load the WhatsApp logs.' });
  }
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
    const presented = req.get('x-beem-signature') || req.get('x-webhook-secret') || req.query?.secret || '';
    const a = Buffer.from(String(presented));
    const b = Buffer.from(cfg.callbackSecret);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      console.warn('[whatsapp:webhook] rejected a callback with a bad secret');
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
