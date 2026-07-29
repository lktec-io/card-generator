'use strict';

const pool       = require('../config/db');
const SmsService = require('../services/sms/SmsService');

// ── Default SMS template ──────────────────────────────────────────────────────
const DEFAULT_TEMPLATE =
`Habari {guest_name},

Tunapenda kuchukua nafasi hii kukualika katika {event_name} itakayofanyika {venue}, siku ya {event_date} kuanzia saa {event_time}.

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

async function writeLog({ event_id, invitation_id, phone_number, provider, message, status, provider_message_id, error_message }) {
  try {
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

module.exports = { sendSingle, sendBulk, getBulkProgress, getSmsLogs, retrySms };
