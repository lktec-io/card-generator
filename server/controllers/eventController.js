const pool = require('../config/db');
const { eventScopeSQL } = require('../middleware/authMiddleware');
const { deleteEventCardImages } = require('../services/cardStorage');

const VALID_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

function sanitize(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; }

function parseLayoutConfig(v) {
  if (!v) return null;
  try {
    const obj = typeof v === 'string' ? JSON.parse(v) : v;
    if (typeof obj !== 'object' || Array.isArray(obj)) return null;
    return JSON.stringify(obj);
  } catch { return null; }
}

// Accepts any date format (ISO datetime, YYYY-MM-DD, etc.) and returns YYYY-MM-DD or null.
function formatMySQLDate(v) {
  if (!v) return null;
  try {
    return new Date(v).toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Visibility check — mirrors eventScopeSQL logic for individual row access.
function canSeeEvent(event, user) {
  if (!user || user.role === 'super_admin') return true;
  if (user.role === 'admin') return event.created_by === user.id;
  if (user.role === 'event_manager') {
    return event.created_by === user.id || event.assigned_to === user.id;
  }
  return event.assigned_to === user.id;
}

function canAssign(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

// GET /events
async function listEvents(req, res) {
  const scope = eventScopeSQL(req.user);
  try {
    // Each table is aggregated ONCE, then joined one row per event.
    //
    // The previous form joined invitations and rsvp_responses to events side by
    // side, both on event_id only — so every event produced invitations × RSVPs
    // rows before GROUP BY. Two consequences, both measured on a production-scale
    // copy (45 events, 8,743 guests):
    //   - cost: 1.3–2.0 s per call, growing as guests RSVP; under 12 concurrent
    //     page loads it held all 10 pool connections, and SMS sends, dashboard
    //     stats and WhatsApp logs queued behind it for 8–18 s
    //   - wrong totals: each checked-in guest counted once per RSVP, each RSVP
    //     once per guest (event 45: 104,512 "checked in" against 184 real)
    // The columns returned are unchanged.
    const [events] = await pool.execute(
      `SELECT
         e.*,
         (SELECT u.name FROM users u WHERE u.id = e.assigned_to) AS assigned_to_name,
         (SELECT u.role FROM users u WHERE u.id = e.assigned_to) AS assigned_to_role,
         COALESCE(ic.total_invitations, 0) AS total_invitations,
         COALESCE(ic.checked_in,        0) AS checked_in,
         COALESCE(rc.rsvp_attending,    0) AS rsvp_attending,
         COALESCE(rc.rsvp_declined,     0) AS rsvp_declined
       FROM events e
       LEFT JOIN (
         SELECT event_id, COUNT(*) AS total_invitations, SUM(status = 'used') AS checked_in
           FROM invitations GROUP BY event_id
       ) ic ON ic.event_id = e.id
       LEFT JOIN (
         SELECT event_id,
                SUM(response = 'attending') AS rsvp_attending,
                SUM(response = 'declined')  AS rsvp_declined
           FROM rsvp_responses GROUP BY event_id
       ) rc ON rc.event_id = e.id
       WHERE 1=1 ${scope.where}
       ORDER BY e.created_at DESC`,
      scope.params
    );
    res.json({ success: true, events });
  } catch (err) {
    console.error('[listEvents]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch events.' });
  }
}

// POST /events
async function createEvent(req, res) {
  if (req.user?.role === 'super_admin') {
    return res.status(403).json({ success: false, message: 'Platform administrators cannot create events.' });
  }

  const {
    event_name, event_type, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone, template_id, assigned_to,
    name_color, cn_color, layout_config, sms_template,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  const safeType   = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';
  const createdBy  = req.user?.id || null;
  const assignedTo = (canAssign(req.user) && assigned_to)
    ? (parseInt(assigned_to, 10) || null)
    : null;

  const safeNameColor    = /^#[0-9a-fA-F]{6}$/.test(name_color) ? name_color : '#111111';
  const safeCnColor      = /^#[0-9a-fA-F]{6}$/.test(cn_color)   ? cn_color   : '#222222';
  const safeLayoutConfig = parseLayoutConfig(layout_config);
  const safeSmsTpl       = (typeof sms_template === 'string' && sms_template.trim()) ? sms_template.trim() : null;

  try {
    const safeTemplateId = template_id ? parseInt(template_id, 10) || null : null;

    const [result] = await pool.execute(
      `INSERT INTO events
         (event_name, event_type, event_mode, event_date, event_time, venue,
          dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
          maps_link, contact_name, contact_phone, template_id,
          name_color, cn_color, created_by, assigned_to, layout_config, sms_template)
       VALUES (?, ?, 'invitation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitize(event_name), safeType,
        formatMySQLDate(event_date), sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
        safeTemplateId,
        safeNameColor, safeCnColor,
        createdBy, assignedTo,
        safeLayoutConfig, safeSmsTpl,
      ]
    );
    const [[event]] = await pool.execute('SELECT * FROM events WHERE id = ?', [result.insertId]);
    console.log(`[createEvent] "${event.event_name}" id=${event.id} by=${createdBy}`);
    res.status(201).json({ success: true, event });
  } catch (err) {
    console.error('[createEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to create event.' });
  }
}

// GET /events/:id
async function getEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    // assigned_to_name / assigned_to_role: display only — access checks still read e.assigned_to
    const [[event]] = await pool.execute(
      `SELECT e.*, u.name AS assigned_to_name, u.role AS assigned_to_role
         FROM events e
         LEFT JOIN users u ON u.id = e.assigned_to
        WHERE e.id = ?`,
      [id]
    );
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    if (!canSeeEvent(event, req.user)) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const [invitations] = await pool.execute(
      `SELECT i.id, i.code, i.invitation_uuid, i.guest_name, i.phone_number,
              i.status, i.image_url, i.created_at, i.used_at,
              r.response          AS rsvp_response,
              r.voice_message_url AS rsvp_voice_url
         FROM invitations i
         LEFT JOIN rsvp_responses r ON r.invitation_id = i.id
        WHERE i.event_id = ?
        ORDER BY i.created_at DESC`,
      [id]
    );

    const [[stats]] = await pool.execute(
      `SELECT
         COUNT(*)                         AS total,
         COALESCE(SUM(status='used'),  0) AS checked_in,
         COALESCE(SUM(status='unused'),0) AS pending
       FROM invitations WHERE event_id = ?`,
      [id]
    );

    const [rsvpRows] = await pool.execute(
      `SELECT response, COUNT(*) AS count FROM rsvp_responses WHERE event_id = ? GROUP BY response`,
      [id]
    );
    const rsvp = { attending: 0, declined: 0, pending: 0 };
    rsvpRows.forEach(r => { rsvp[r.response] = Number(r.count); });

    // Single / Double analytics from the existing invitations.card_type, this event only.
    // Own query + own catch: if card_type is missing (migration not yet run) or the query
    // fails, the event page still loads — it just hides the Single/Double breakdown.
    let analytics = { card_type_available: false, total: Number(stats.total) || 0 };
    try {
      const [[a]] = await pool.execute(
        `SELECT
           COUNT(*)                                                  AS total,
           COALESCE(SUM(card_type = 'single'), 0)                    AS single_count,
           COALESCE(SUM(card_type = 'double'), 0)                    AS double_count,
           COALESCE(SUM(status = 'used'), 0)                         AS checked_in_total,
           COALESCE(SUM(status = 'used' AND card_type = 'single'), 0) AS checked_in_single,
           COALESCE(SUM(status = 'used' AND card_type = 'double'), 0) AS checked_in_double
         FROM invitations WHERE event_id = ?`,
        [id]
      );
      const n = (v) => Number(v) || 0;
      analytics = {
        card_type_available: true,
        single:   n(a.single_count),
        double:   n(a.double_count),
        total:    n(a.total),
        expected_guests: n(a.single_count) + n(a.double_count) * 2,   // single + (double × 2)
        checked_in_single: n(a.checked_in_single),
        checked_in_double: n(a.checked_in_double),
        checked_in_total:  n(a.checked_in_total),
        checked_in_guests: n(a.checked_in_single) + n(a.checked_in_double) * 2,
      };
    } catch (err) {
      console.error('[getEvent] card_type analytics unavailable:', err.message);
    }

    res.json({ success: true, event, invitations, stats, rsvp, analytics });
  } catch (err) {
    console.error('[getEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch event.' });
  }
}

// PUT /events/:id
async function updateEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  const {
    event_name, event_type, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone, template_id, assigned_to,
    name_color, cn_color, layout_config, sms_template,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  const safeType = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';

  try {
    const [[existing]] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Event not found.' });

    if (!canSeeEvent(existing, req.user)) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const safeTemplateId = template_id ? parseInt(template_id, 10) || null : null;
    const newAssignedTo  = (canAssign(req.user) && assigned_to !== undefined)
      ? (parseInt(assigned_to, 10) || null)
      : existing.assigned_to;

    // A newly chosen assignee must be a real, active user (clearing to null is always allowed)
    if (newAssignedTo !== null && newAssignedTo !== existing.assigned_to) {
      const [[assignee]] = await pool.execute(
        "SELECT id FROM users WHERE id = ? AND status = 'active' LIMIT 1",
        [newAssignedTo]
      );
      if (!assignee) {
        return res.status(400).json({ success: false, message: 'Selected verifier was not found or is inactive.' });
      }
    }

    const safeNameColor    = /^#[0-9a-fA-F]{6}$/.test(name_color) ? name_color : (existing.name_color || '#111111');
    const safeCnColor      = /^#[0-9a-fA-F]{6}$/.test(cn_color)   ? cn_color   : (existing.cn_color   || '#222222');
    const safeLayoutConfig = layout_config !== undefined
      ? parseLayoutConfig(layout_config)
      : (existing.layout_config ? JSON.stringify(existing.layout_config) : null);
    const safeSmsTpl = sms_template !== undefined
      ? ((typeof sms_template === 'string' && sms_template.trim()) ? sms_template.trim() : null)
      : (existing.sms_template || null);

    await pool.execute(
      `UPDATE events SET
         event_name = ?, event_type = ?, event_date = ?, event_time = ?, venue = ?,
         dress_code_main = ?, dress_code_secondary = ?, dress_code_accent = ?,
         dress_code_notes = ?, maps_link = ?, contact_name = ?, contact_phone = ?,
         template_id = ?, name_color = ?, cn_color = ?,
         assigned_to = ?, layout_config = ?, sms_template = ?
       WHERE id = ?`,
      [
        sanitize(event_name), safeType,
        formatMySQLDate(event_date), sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
        safeTemplateId, safeNameColor, safeCnColor,
        newAssignedTo, safeLayoutConfig, safeSmsTpl, id,
      ]
    );
    const [[event]] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    res.json({ success: true, event });
  } catch (err) {
    console.error('[updateEvent]', err.message);
    res.status(500).json({ success: false, message: 'Failed to update event.' });
  }
}

// DELETE /events/:id
async function deleteEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  try {
    const [result] = await pool.execute('DELETE FROM events WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    // Remove this event's stored card images. The directory is built from the trusted
    // numeric event id only, and a failure here never fails the delete.
    deleteEventCardImages(id);
    res.json({ success: true, message: 'Event deleted.' });
  } catch (err) {
    console.error('[deleteEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
}

module.exports = { listEvents, createEvent, getEvent, updateEvent, deleteEvent };
