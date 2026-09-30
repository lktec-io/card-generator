'use strict';

const pool       = require('../config/db');
const SmsService = require('../services/sms/SmsService');
const { eventScopeSQL } = require('../middleware/authMiddleware');
// Same Single/Double wording that is printed on the card itself
const { typeLabel } = require('../utils/imageProcessor');

// ── Default SMS template ──────────────────────────────────────────────────────
const DEFAULT_TEMPLATE =
`Habari {guest_name},
Tunapenda kuchukua nafasi hii kukualika katika {event_name} itakayofanyika {venue}, siku ya tarehe {event_date} kuanzia saa {event_time}.

Mualiko namba #{invitation_code}
Aina: {card_type}
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
let _kindColumn   = null;
let _kindCheckedAt = 0;

// A missing column is re-checked instead of being remembered forever: running the
// migration must take effect without restarting the Node process.
const COLUMN_RECHECK_MS = 15_000;

async function columnExists(table, column) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.n) > 0;
}

async function hasKindColumn({ force = false } = {}) {
  if (_kindColumn === true) return true;
  if (!force && _kindColumn === false && Date.now() - _kindCheckedAt < COLUMN_RECHECK_MS) return false;
  try {
    _kindColumn = await columnExists('sms_logs', 'sms_kind');
  } catch {
    _kindColumn = false;
  }
  _kindCheckedAt = Date.now();
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

// invitations.card_type ('single' | 'double') is set when the card is generated and is
// added by migration_card_type.sql. Guarded like the other optional columns so a database
// without it can never break invitation SMS — the Type line is simply left out.
let _cardTypeColumn    = null;
let _cardTypeCheckedAt = 0;

async function hasCardTypeColumn() {
  if (_cardTypeColumn === true) return true;
  if (_cardTypeColumn === false && Date.now() - _cardTypeCheckedAt < COLUMN_RECHECK_MS) return false;
  try {
    _cardTypeColumn = await columnExists('invitations', 'card_type');
  } catch {
    _cardTypeColumn = false;
  }
  _cardTypeCheckedAt = Date.now();
  return _cardTypeColumn;
}

// A custom per-event template is used exactly as the admin wrote it. The built-in default
// carries the Type line, and drops it when the type is not known for that guest.
const invitationTemplate = (event, label) =>
  event.sms_template || (label ? DEFAULT_TEMPLATE : DEFAULT_TEMPLATE.replace('Type: {card_type}\n', ''));

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
    const typeCol = (await hasCardTypeColumn()) ? ', card_type' : '';
    const [[inv]] = await pool.execute(
      `SELECT id, guest_name, phone_number, code, event_id${typeCol}
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

    const cardTypeLabel = inv.card_type ? typeLabel(inv.card_type) : '';
    const message  = buildMessage(invitationTemplate(event, cardTypeLabel), {
      guest_name:      inv.guest_name,
      event_name:      event.event_name,
      venue:           event.venue    || '',
      event_date:      formatEventDate(event.event_date),
      event_time:      event.event_time || '',
      invitation_code: inv.code,
      card_type:       cardTypeLabel,
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

    const typeCol = (await hasCardTypeColumn()) ? ', card_type' : '';
    const [invitations] = await pool.execute(
      `SELECT id, guest_name, phone_number, code${typeCol}
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

        const cardTypeLabel = inv.card_type ? typeLabel(inv.card_type) : '';
        const message = buildMessage(invitationTemplate(event, cardTypeLabel), {
          guest_name:      inv.guest_name,
          event_name:      event.event_name,
          venue:           event.venue    || '',
          event_date:      formatEventDate(event.event_date),
          event_time:      event.event_time || '',
          invitation_code: inv.code,
          card_type:       cardTypeLabel,
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
    skipped_no_phone: job.skipped_no_phone || 0,
    skipped_already:  job.skipped_already  || 0,
    // Per-failure reasons as reported by the provider (thank-you jobs)
    failures: job.failures || [],
    started_at: job.startedAt,
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
const MAX_FAILURE_DETAILS = 200;        // cap the per-failure list kept in memory
const _thankYouRunning  = new Set();    // event ids with a bulk thank-you in flight

// events.thank_you_template is added by migration_thank_you_template.sql.
// Until it exists the saved message simply isn't available and the default is used.
let _templateColumn   = null;
let _templateCheckedAt = 0;

// Same rule as above: never remember "missing" permanently. Before this, a server that
// started BEFORE the migration cached false for the life of the process, so saving kept
// returning 400 even after the migration had been applied.
async function hasTemplateColumn({ force = false } = {}) {
  if (_templateColumn === true) return true;
  if (!force && _templateColumn === false && Date.now() - _templateCheckedAt < COLUMN_RECHECK_MS) return false;
  try {
    _templateColumn = await columnExists('events', 'thank_you_template');
  } catch (err) {
    console.error('[hasTemplateColumn] schema check failed:', err.message);
    _templateColumn = false;
  }
  _templateCheckedAt = Date.now();
  return _templateColumn;
}

// Which database the pool is actually connected to — used to make the failure message
// actionable when a migration was applied to a different schema.
async function currentDatabase() {
  try {
    const [[row]] = await pool.execute('SELECT DATABASE() AS db');
    return row?.db || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

// Same authorization the rest of the app uses: the event must be inside the
// logged-in user's scope (super_admin: all, admin: own, manager: own/assigned).
async function loadEventForUser(eventId, user) {
  const scope = eventScopeSQL(user);
  const saved = (await hasTemplateColumn()) ? ', e.thank_you_template' : '';
  const [[event]] = await pool.execute(
    `SELECT e.id, e.event_name, e.event_type, e.venue, e.event_date, e.event_time${saved}
       FROM events e
      WHERE e.id = ? ${scope.where}`,
    [eventId, ...scope.params]
  );
  return event || null;
}

// What actually gets sent: the event's saved message when it has one, else the default.
// A saved message is never replaced by the default.
const savedTemplate   = (event) => (typeof event?.thank_you_template === 'string' && event.thank_you_template.trim())
  ? event.thank_you_template.trim() : null;
const resolveTemplate = (event) => savedTemplate(event) || buildThankYouTemplate(event);

// Default Swahili thank-you — short, warm and direct. Event details are filled in when
// they exist; {guest_name} stays a placeholder so each guest is greeted by name at send
// time. Wording stays neutral ("tukio letu") so it suits weddings, send-offs,
// graduations, church and corporate events alike.
// This is only a fallback: an event with a saved message keeps its own wording.
function buildThankYouTemplate(event) {
  const date  = formatEventDate(event.event_date);
  const where = event.venue ? ` pale ${event.venue}` : '';
  const when  = date ? ` siku ya tarehe ${date}` : '';
  return `Habari {guest_name}, Familia inakushukuru kwa dhati kwa kuhudhuria ${event.event_name}${where}${when}. `
    + 'Uwepo wako ulifanya tukio letu kuwa la kipekee. Asante sana na Mungu akubariki.';
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
      template:         resolveTemplate(event),      // what will actually be sent
      saved_template:   savedTemplate(event),        // null until the admin saves one
      default_template: buildThankYouTemplate(event),
      can_save:         await hasTemplateColumn(),
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

// ── PUT /sms/thank-you/:event_id ─────────────────────────────────────────────
// Saves this event's thank-you wording. Touches events.thank_you_template only —
// no other event field is read or written here.
async function saveThankYouTemplate(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) {
    return res.status(400).json({ success: false, message: 'The message cannot be empty.' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(400).json({ success: false, message: `Message too long (${message.length} characters, max ${MAX_MESSAGE_CHARS}).` });
  }

  try {
    const event = await loadEventForUser(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    // force: a cached "missing" must never block a save after the migration has run
    if (!(await hasTemplateColumn({ force: true }))) {
      const db = await currentDatabase();
      console.error(`[saveThankYouTemplate] events.thank_you_template missing in database "${db}"`);
      return res.status(400).json({
        success: false,
        code: 'THANK_YOU_COLUMN_MISSING',
        database: db,
        message: `Saving is unavailable: database "${db}" has no column events.thank_you_template. `
          + 'Run server/database/migration_thank_you_template.sql against that database '
          + '(note: this is a different file from migration_thank_you_sms.sql).',
      });
    }

    try {
      await pool.execute('UPDATE events SET thank_you_template = ? WHERE id = ?', [message, eventId]);
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      // The column vanished since the last check — report it instead of a 500
      _templateColumn = false;
      _templateCheckedAt = Date.now();
      const db = await currentDatabase();
      return res.status(400).json({
        success: false,
        code: 'THANK_YOU_COLUMN_MISSING',
        database: db,
        message: `Saving is unavailable: database "${db}" has no column events.thank_you_template. `
          + 'Run server/database/migration_thank_you_template.sql against that database.',
      });
    }

    console.log(`[saveThankYouTemplate] event=${eventId} saved (${message.length} chars)`);
    res.json({ success: true, saved_template: message, message: 'Message saved successfully' });
  } catch (err) {
    console.error('[saveThankYouTemplate]', err);
    res.status(500).json({ success: false, message: 'Failed to save the message.' });
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

    const message  = buildMessage(custom || resolveTemplate(event), messageVars(event, inv));
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
        // same breakdown keys as a started job, so the UI can explain why nothing was queued
        skipped: skipped + already, skipped_no_phone: skipped, skipped_already: already, already,
      });
    }

    const template = custom || resolveTemplate(event);
    const jobId    = createJob(eventId, queue.length);
    const job      = _jobs.get(jobId);
    job.skipped           = skipped + already;     // intentional server-side skips, never failures
    job.skipped_no_phone  = skipped;
    job.skipped_already   = already;
    job.already           = already;
    job.failures          = [];                    // { phone, guest_name, reason } from the provider
    _thankYouRunning.add(eventId);

    res.json({
      success: true, job_id: jobId, total: queue.length, recipients: group,
      skipped: skipped + already, skipped_no_phone: skipped, skipped_already: already, already,
    });

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
            // The provider's own words — never a guessed reason
            const reason = (err?.message || '').trim() || 'SMS failed — provider did not provide a reason.';
            if (job.failures.length < MAX_FAILURE_DETAILS) {
              job.failures.push({ phone: inv.phone_number, guest_name: inv.guest_name, reason });
            }
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
  getThankYouInfo, saveThankYouTemplate, sendThankYouSingle, sendThankYouBulk,
};
