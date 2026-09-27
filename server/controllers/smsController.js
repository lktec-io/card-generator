'use strict';

const pool       = require('../config/db');
const SmsService = require('../services/sms/SmsService');
const { eventScopeSQL } = require('../middleware/authMiddleware');

// ── Default SMS template ──────────────────────────────────────────────────────
const DEFAULT_TEMPLATE =
`Habari {guest_name},
Tunapenda kuchukua nafasi hii kukualika katika {event_name} itakayofanyika {venue}, siku ya tarehe {event_date} kuanzia saa {event_time}.

Mualiko namba #{invitation_code}
Tafadhali fika na meseji hii.

Karibu sana.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMessage(template, vars) {
  let msg = (template && template.trim()) ? template.trim() : DEFAULT_TEMPLATE;
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), v != null ? String(v) : '');
  }
  return msg;
}

function formatEventDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(raw).split('T')[0];
  }
}

// sms_kind ('invitation' | 'thank_you') is added by migration_thank_you_sms.sql.
// null = not checked yet. When the column is missing we fall back to the original INSERT,
// so sending keeps working before the migration is run.
let _kindColumn = null;

async function hasKindColumn() {
  if (_kindColumn !== null) return _kindColumn;
  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_logs' AND COLUMN_NAME = 'sms_kind'`
    );
    _kindColumn = Number(row.n) > 0;
  } catch {
    _kindColumn = false;
  }
  return _kindColumn;
}

async function writeLog({ event_id, invitation_id, phone_number, provider, message, status, provider_message_id, error_message, kind }) {
  try {
    // Thank-you sends record the kind; invitation SMS keeps the original INSERT untouched.
    if (kind && _kindColumn !== false) {
      try {
        await pool.execute(
          `INSERT INTO sms_logs
             (event_id, invitation_id, phone_number, provider, message, status, provider_message_id, error_message, sms_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            event_id            || null,
            invitation_id       || null,
            phone_number,
            provider,
            message,
            status,
            provider_message_id || null,
            error_message       || null,
            kind,
          ]
        );
        _kindColumn = true;
        return;
      } catch (err) {
        if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
        _kindColumn = false;   // migration not run yet — fall through to the original INSERT
      }
    }

    await pool.execute(
      `INSERT INTO sms_logs
         (event_id, invitation_id, phone_number, provider, message, status, provider_message_id, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event_id             || null,
        invitation_id        || null,
        phone_number,
        provider,
        message,
        status,
        provider_message_id  || null,
        error_message        || null,
      ]
    );
  } catch (err) {
    console.error('[smsController] writeLog failed:', err.message);
  }
}

// ── In-memory bulk job tracker ────────────────────────────────────────────────
// Simple polling model — no SSE or WebSockets needed for this scale.
const _jobs   = new Map();
const JOB_TTL = 30 * 60 * 1000; // 30 minutes

function createJob(eventId, total) {
  const jobId = `${eventId}_${Date.now()}`;
  _jobs.set(jobId, {
    total,
    sent:      0,
    failed:    0,
    done:      false,
    eventId,
    startedAt: Date.now(),
  });
  // Prune stale entries
  for (const [k, v] of _jobs) {
    if (Date.now() - v.startedAt > JOB_TTL) _jobs.delete(k);
  }
  return jobId;
}

// ── POST /sms/send/:invitation_id ────────────────────────────────────────────
async function sendSingle(req, res) {
  const invId = parseInt(req.params.invitation_id, 10);
  if (!invId) return res.status(400).json({ success: false, message: 'Invalid invitation ID.' });

  try {
    const [[inv]] = await pool.execute(
      `SELECT id, guest_name, phone_number, code, event_id
         FROM invitations WHERE id = ?`,
      [invId]
    );
    if (!inv)              return res.status(404).json({ success: false, message: 'Invitation not found.' });
    if (!inv.phone_number) return res.status(400).json({ success: false, message: `${inv.guest_name} has no phone number.` });

    const [[event]] = await pool.execute(
      'SELECT id, event_name, venue, event_date, event_time, sms_template FROM events WHERE id = ?',
      [inv.event_id]
    );
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const message  = buildMessage(event.sms_template, {
      guest_name:      inv.guest_name,
      event_name:      event.event_name,
      venue:           event.venue    || '',
      event_date:      formatEventDate(event.event_date),
      event_time:      event.event_time || '',
      invitation_code: inv.code,
    });

    const provider = SmsService.providerName();

    let result;
    try {
      result = await SmsService.send(inv.phone_number, message);
    } catch (err) {
      await writeLog({ event_id: inv.event_id, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'failed', error_message: err.message });
      return res.status(502).json({ success: false, message: `SMS failed: ${err.message}` });
    }

    await writeLog({ event_id: inv.event_id, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'sent', provider_message_id: result.provider_message_id });
    console.log(`[sendSingle] sent to ${inv.guest_name} (${inv.phone_number}) event=${inv.event_id}`);
    res.json({ success: true, message: `SMS sent to ${inv.guest_name}.` });

  } catch (err) {
    console.error('[sendSingle]', err);
    res.status(500).json({ success: false, message: 'Failed to send SMS.' });
  }
}

// ── POST /sms/bulk/:event_id ──────────────────────────────────────────────────
// Returns immediately with a job_id; background task processes the queue.
async function sendBulk(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const [[event]] = await pool.execute(
      'SELECT id, event_name, venue, event_date, event_time, sms_template FROM events WHERE id = ?',
      [eventId]
    );
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const [invitations] = await pool.execute(
      `SELECT id, guest_name, phone_number, code
         FROM invitations
        WHERE event_id = ? AND phone_number IS NOT NULL AND phone_number != ''`,
      [eventId]
    );

    if (invitations.length === 0) {
      return res.status(400).json({ success: false, message: 'No guests with phone numbers for this event.' });
    }

    const jobId = createJob(eventId, invitations.length);

    // Respond immediately — do not await the sending loop
    res.json({ success: true, job_id: jobId, total: invitations.length });

    // Background processing — does not block the Express event loop
    setImmediate(async () => {
      const job      = _jobs.get(jobId);
      const provider = SmsService.providerName();

      for (const inv of invitations) {
        if (!job) break;

        const message = buildMessage(event.sms_template, {
          guest_name:      inv.guest_name,
          event_name:      event.event_name,
          venue:           event.venue    || '',
          event_date:      formatEventDate(event.event_date),
          event_time:      event.event_time || '',
          invitation_code: inv.code,
        });

        try {
          const result = await SmsService.send(inv.phone_number, message);
          await writeLog({ event_id: eventId, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'sent', provider_message_id: result.provider_message_id });
          job.sent++;
        } catch (err) {
          await writeLog({ event_id: eventId, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'failed', error_message: err.message });
          job.failed++;
        }

        // Brief pause between messages — avoids saturating the Beem rate limit
        await new Promise(r => setTimeout(r, 200));
      }

      if (job) job.done = true;
      console.log(`[sendBulk] event=${eventId} job=${jobId} sent=${job?.sent} failed=${job?.failed}`);
    });

  } catch (err) {
    console.error('[sendBulk]', err);
    res.status(500).json({ success: false, message: 'Failed to start bulk SMS job.' });
  }
}

// ── GET /sms/bulk/progress/:job_id ───────────────────────────────────────────
function getBulkProgress(req, res) {
  const { job_id } = req.params;
  const job = _jobs.get(job_id);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Job not found or expired (30 min TTL).' });
  }
  res.json({
    success: true,
    job_id,
    total:   job.total,
    sent:    job.sent,
    failed:  job.failed,
    done:    job.done,
    skipped: job.skipped || 0,           // thank-you jobs only; 0 for invitation blasts
    already: job.already || 0,
  });
}

// ── GET /sms/logs/:event_id ───────────────────────────────────────────────────
async function getSmsLogs(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const [logs] = await pool.execute(
      `SELECT sl.id, sl.invitation_id, sl.phone_number, sl.provider,
              sl.status, sl.provider_message_id, sl.error_message, sl.sent_at,
              i.guest_name
         FROM sms_logs sl
         LEFT JOIN invitations i ON i.id = sl.invitation_id
        WHERE sl.event_id = ?
        ORDER BY sl.sent_at DESC
        LIMIT 300`,
      [eventId]
    );
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[getSmsLogs]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch SMS logs.' });
  }
}

// ── POST /sms/retry/:log_id ───────────────────────────────────────────────────
async function retrySms(req, res) {
  const logId = parseInt(req.params.log_id, 10);
  if (!logId) return res.status(400).json({ success: false, message: 'Invalid log ID.' });

  try {
    const [[log]] = await pool.execute('SELECT * FROM sms_logs WHERE id = ?', [logId]);
    if (!log)               return res.status(404).json({ success: false, message: 'Log entry not found.' });
    if (log.status !== 'failed') {
      return res.status(400).json({ success: false, message: 'Only failed messages can be retried.' });
    }

    const provider = SmsService.providerName();
    try {
      const result = await SmsService.send(log.phone_number, log.message);
      await writeLog({ event_id: log.event_id, invitation_id: log.invitation_id, phone_number: log.phone_number, provider, message: log.message, status: 'sent', provider_message_id: result.provider_message_id });
      res.json({ success: true, message: 'SMS re-sent successfully.' });
    } catch (err) {
      await writeLog({ event_id: log.event_id, invitation_id: log.invitation_id, phone_number: log.phone_number, provider, message: log.message, status: 'failed', error_message: err.message });
      res.status(502).json({ success: false, message: `Retry failed: ${err.message}` });
    }

  } catch (err) {
    console.error('[retrySms]', err);
    res.status(500).json({ success: false, message: 'Failed to retry SMS.' });
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   POST-EVENT THANK YOU SMS
   Reuses SmsService (Beem), the sms_logs table, the job tracker above and the
   existing event-scope authorization. No new provider, no new attendance data.
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_MESSAGE_CHARS = 800;          // refuse silently-huge sends (~5 SMS segments)
const _thankYouRunning  = new Set();    // event ids with a bulk thank-you in flight

// Same authorization the rest of the app uses: the event must be inside the
// logged-in user's scope (super_admin: all, admin: own, manager: own/assigned).
async function loadEventForUser(eventId, user) {
  const scope = eventScopeSQL(user);
  const [[event]] = await pool.execute(
    `SELECT e.id, e.event_name, e.event_type, e.venue, e.event_date, e.event_time
       FROM events e
      WHERE e.id = ? ${scope.where}`,
    [eventId, ...scope.params]
  );
  return event || null;
}

// Default Swahili thank-you. Event details are filled in when they exist; {guest_name}
// stays as a placeholder so each guest is greeted by name at send time.
// Wording stays neutral ("tukio letu") so it suits weddings, send-offs, graduations etc.
function buildThankYouTemplate(event) {
  const date = formatEventDate(event.event_date);
  const where = event.venue ? ` kule ${event.venue}` : '';
  const when  = date ? ` siku ya ${date}` : '';
  return [
    'Habari {guest_name},',
    '',
    `Tunakushukuru kwa moyo wa dhati kwa mchango wako na kwa kuhudhuria ${event.event_name}${where}${when}. `
      + 'Uwepo wako ulifanya tukio letu kuwa la kipekee na lenye furaha zaidi. '
      + 'Tunathamini sana kuwa nawe katika kumbukumbu hii muhimu.',
    '',
    'Asante sana, Mungu akubariki na karibu tena tuendelee kuwa pamoja.',
  ].join('\n');
}

const hasPhone = (inv) => !!(inv.phone_number && String(inv.phone_number).trim());

// Invitation ids that already received a thank-you for this event
async function thankYouSentIds(eventId) {
  if (!(await hasKindColumn())) return null;          // can't tell yet — migration not run
  const [rows] = await pool.execute(
    `SELECT DISTINCT invitation_id FROM sms_logs
      WHERE event_id = ? AND sms_kind = 'thank_you' AND status = 'sent' AND invitation_id IS NOT NULL`,
    [eventId]
  );
  return rows.map((r) => r.invitation_id);
}

// Recipients are always resolved on the server from event_id — a client can only
// choose WHICH group ('checked_in' | 'all'), never which guests.
async function loadRecipients(eventId, group) {
  const [rows] = await pool.execute(
    `SELECT id, guest_name, phone_number, code, status
       FROM invitations
      WHERE event_id = ?${group === 'checked_in' ? " AND status = 'used'" : ''}
      ORDER BY guest_name ASC`,
    [eventId]
  );
  return rows;
}

function messageVars(event, inv) {
  return {
    guest_name:      inv.guest_name,
    event_name:      event.event_name,
    venue:           event.venue      || '',
    event_date:      formatEventDate(event.event_date),
    event_time:      event.event_time || '',
    invitation_code: inv.code,
  };
}

// ── GET /sms/thank-you/:event_id ─────────────────────────────────────────────
// Default message + recipient counts for the UI. Sends nothing.
async function getThankYouInfo(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const event = await loadEventForUser(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const [all]  = await pool.execute(
      `SELECT id, phone_number, status FROM invitations WHERE event_id = ?`, [eventId]
    );
    const sentIds   = await thankYouSentIds(eventId);
    const checkedIn = all.filter((i) => i.status === 'used');
    const count = (rows) => ({ total: rows.length, with_phone: rows.filter(hasPhone).length });

    res.json({
      success: true,
      template: buildThankYouTemplate(event),
      counts: { checked_in: count(checkedIn), all: count(all) },
      tracking_available: sentIds !== null,
      already_sent_ids:   sentIds || [],
      max_chars: MAX_MESSAGE_CHARS,
    });
  } catch (err) {
    console.error('[getThankYouInfo]', err);
    res.status(500).json({ success: false, message: 'Failed to load thank-you details.' });
  }
}

// ── POST /sms/thank-you/send/:invitation_id ──────────────────────────────────
async function sendThankYouSingle(req, res) {
  const invId = parseInt(req.params.invitation_id, 10);
  if (!invId) return res.status(400).json({ success: false, message: 'Invalid invitation ID.' });

  const custom = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (custom.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ success: false, message: `Message too long (${custom.length} characters, max ${MAX_MESSAGE_CHARS}).` });
  }

  try {
    const [[inv]] = await pool.execute(
      'SELECT id, guest_name, phone_number, code, event_id FROM invitations WHERE id = ?', [invId]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found.' });

    const event = await loadEventForUser(inv.event_id, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });
    if (!hasPhone(inv)) {
      return res.status(400).json({ success: false, message: `${inv.guest_name} has no phone number.` });
    }

    const message  = buildMessage(custom || buildThankYouTemplate(event), messageVars(event, inv));
    const provider = SmsService.providerName();

    try {
      const result = await SmsService.send(inv.phone_number, message);
      await writeLog({ event_id: inv.event_id, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'sent', provider_message_id: result.provider_message_id, kind: 'thank_you' });
      console.log(`[thankYouSingle] sent to ${inv.guest_name} event=${inv.event_id}`);
      res.json({ success: true, message: `Thank-you SMS sent to ${inv.guest_name}.` });
    } catch (err) {
      await writeLog({ event_id: inv.event_id, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'failed', error_message: err.message, kind: 'thank_you' });
      res.status(502).json({ success: false, message: `SMS failed: ${err.message}` });
    }
  } catch (err) {
    console.error('[sendThankYouSingle]', err);
    res.status(500).json({ success: false, message: 'Failed to send thank-you SMS.' });
  }
}

// ── POST /sms/thank-you/bulk/:event_id ───────────────────────────────────────
async function sendThankYouBulk(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  const group  = req.body?.recipients === 'all' ? 'all' : 'checked_in';   // default: guests who attended
  const resend = req.body?.resend === true;
  const custom = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (custom.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ success: false, message: `Message too long (${custom.length} characters, max ${MAX_MESSAGE_CHARS}).` });
  }

  // A second click while the first blast is running must not double-send
  if (_thankYouRunning.has(eventId)) {
    return res.status(409).json({ success: false, message: 'A thank-you send is already running for this event.' });
  }

  try {
    const event = await loadEventForUser(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    const recipients = await loadRecipients(eventId, group);
    const sentIds    = resend ? [] : (await thankYouSentIds(eventId)) || [];
    const alreadySet = new Set(sentIds);

    const skipped  = recipients.filter((i) => !hasPhone(i)).length;
    const already  = recipients.filter((i) => hasPhone(i) && alreadySet.has(i.id)).length;
    const queue    = recipients.filter((i) => hasPhone(i) && !alreadySet.has(i.id));

    if (queue.length === 0) {
      return res.status(400).json({
        success: false,
        message: already > 0
          ? 'Every guest in this group has already received a thank-you SMS.'
          : 'No guests with phone numbers in this group.',
        skipped, already,
      });
    }

    const template = custom || buildThankYouTemplate(event);
    const jobId    = createJob(eventId, queue.length);
    const job      = _jobs.get(jobId);
    job.skipped = skipped;
    job.already = already;
    _thankYouRunning.add(eventId);

    res.json({ success: true, job_id: jobId, total: queue.length, skipped, already, recipients: group });

    setImmediate(async () => {
      const provider = SmsService.providerName();
      try {
        for (const inv of queue) {
          const message = buildMessage(template, messageVars(event, inv));
          try {
            const result = await SmsService.send(inv.phone_number, message);
            await writeLog({ event_id: eventId, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'sent', provider_message_id: result.provider_message_id, kind: 'thank_you' });
            job.sent++;
          } catch (err) {
            await writeLog({ event_id: eventId, invitation_id: inv.id, phone_number: inv.phone_number, provider, message, status: 'failed', error_message: err.message, kind: 'thank_you' });
            job.failed++;
          }
          await new Promise((r) => setTimeout(r, 200));   // same pacing as the invitation blast
        }
      } finally {
        job.done = true;
        _thankYouRunning.delete(eventId);
      }
      console.log(`[thankYouBulk] event=${eventId} job=${jobId} sent=${job.sent} failed=${job.failed} skipped=${skipped} already=${already}`);
    });
  } catch (err) {
    _thankYouRunning.delete(eventId);
    console.error('[sendThankYouBulk]', err);
    res.status(500).json({ success: false, message: 'Failed to start thank-you SMS job.' });
  }
}

module.exports = {
  sendSingle, sendBulk, getBulkProgress, getSmsLogs, retrySms,
  getThankYouInfo, sendThankYouSingle, sendThankYouBulk,
};
