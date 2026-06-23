const pool = require('../config/db');
const { eventScopeSQL } = require('../middleware/authMiddleware');

const VALID_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

const VALID_MODES = ['invitation', 'contribution'];

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
// MySQL DATE columns reject ISO timestamps like "2026-06-17T22:00:00.000Z".
function formatMySQLDate(v) {
  if (!v) return null;
  try {
    return new Date(v).toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Visibility check — mirrors eventScopeSQL logic for individual row access.
// Used in getEvent and updateEvent to avoid leaking other managers' events.
function canSeeEvent(event, user) {
  if (!user || user.role === 'super_admin') return true;
  if (user.role === 'admin') return event.created_by === user.id;
  if (user.role === 'event_manager') {
    return event.created_by === user.id || event.assigned_to === user.id;
  }
  // verifier / gate_staff
  return event.assigned_to === user.id;
}

// Returns whether the current user can assign events (admin-level operation).
function canAssign(user) {
  return user?.role === 'admin' || user?.role === 'super_admin';
}

// GET /events
async function listEvents(req, res) {
  const scope = eventScopeSQL(req.user);
  // Filter events by the user's access_type (from JWT — set at login)
  const at = req.user?.access_type;
  const accessFilter = at === 'invitation'   ? "AND e.event_mode = 'invitation'"
                     : at === 'contribution' ? "AND e.event_mode = 'contribution'"
                     : '';
  try {
    const [events] = await pool.execute(
      `SELECT
         e.*,
         COUNT(DISTINCT i.id)                       AS total_invitations,
         COALESCE(SUM(i.status = 'used'),        0) AS checked_in,
         COALESCE(SUM(r.response = 'attending'), 0) AS rsvp_attending,
         COALESCE(SUM(r.response = 'declined'),  0) AS rsvp_declined
       FROM events e
       LEFT JOIN invitations    i ON i.event_id = e.id
       LEFT JOIN rsvp_responses r ON r.event_id = e.id
       WHERE 1=1 ${scope.where} ${accessFilter}
       GROUP BY e.id
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
  const {
    event_name, event_type, event_mode, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone, template_id, assigned_to,
    name_color, cn_color, amount_color, description, layout_config,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  const safeType   = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';
  const safeMode   = VALID_MODES.includes(event_mode) ? event_mode : 'invitation';
  const createdBy  = req.user?.id || null;
  const assignedTo = (canAssign(req.user) && assigned_to)
    ? (parseInt(assigned_to, 10) || null)
    : null;

  const safeNameColor   = /^#[0-9a-fA-F]{6}$/.test(name_color)   ? name_color   : '#111111';
  const safeCnColor     = /^#[0-9a-fA-F]{6}$/.test(cn_color)     ? cn_color     : '#222222';
  const safeAmountColor = /^#[0-9a-fA-F]{6}$/.test(amount_color) ? amount_color : '#222222';
  const safeDescription = sanitize(description);
  const safeLayoutConfig = parseLayoutConfig(layout_config);

  try {
    const safeTemplateId = template_id ? parseInt(template_id, 10) || null : null;

    const [result] = await pool.execute(
      `INSERT INTO events
         (event_name, event_type, event_mode, event_date, event_time, venue,
          dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
          maps_link, contact_name, contact_phone, template_id,
          name_color, cn_color, amount_color, created_by, assigned_to,
          description, layout_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitize(event_name), safeType, safeMode,
        formatMySQLDate(event_date), sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
        safeTemplateId,
        safeNameColor, safeCnColor, safeAmountColor,
        createdBy, assignedTo,
        safeDescription, safeLayoutConfig,
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
    const [[event]] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found.' });

    if (!canSeeEvent(event, req.user)) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const [invitations] = await pool.execute(
      `SELECT i.id, i.code, i.invitation_uuid, i.guest_name, i.phone_number,
              i.requested_amount, i.shared_at,
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

    const [[contribution]] = await pool.execute(
      `SELECT
         COUNT(*)                        AS total_records,
         COALESCE(SUM(requested_amount), 0) AS total_requested_amount,
         COALESCE(AVG(requested_amount), 0) AS avg_contribution,
         COUNT(shared_at)                AS total_shared
       FROM invitations WHERE event_id = ?`,
      [id]
    );

    res.json({ success: true, event, invitations, stats, rsvp, contribution });
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
    event_name, event_type, event_mode, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone, template_id, assigned_to,
    name_color, cn_color, amount_color, description, layout_config,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  const safeType = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';
  const safeMode = VALID_MODES.includes(event_mode) ? event_mode : 'invitation';

  try {
    const [[existing]] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ success: false, message: 'Event not found.' });

    if (!canSeeEvent(existing, req.user)) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    const safeTemplateId  = template_id ? parseInt(template_id, 10) || null : null;
    const newAssignedTo   = (canAssign(req.user) && assigned_to !== undefined)
      ? (parseInt(assigned_to, 10) || null)
      : existing.assigned_to;

    const safeNameColor   = /^#[0-9a-fA-F]{6}$/.test(name_color)   ? name_color   : (existing.name_color   || '#111111');
    const safeCnColor     = /^#[0-9a-fA-F]{6}$/.test(cn_color)     ? cn_color     : (existing.cn_color     || '#222222');
    const safeAmountColor = /^#[0-9a-fA-F]{6}$/.test(amount_color) ? amount_color : (existing.amount_color || '#222222');
    const safeDescription  = description !== undefined ? sanitize(description) : existing.description;
    const safeLayoutConfig = layout_config !== undefined
      ? parseLayoutConfig(layout_config)
      : (existing.layout_config ? JSON.stringify(existing.layout_config) : null);

    await pool.execute(
      `UPDATE events SET
         event_name = ?, event_type = ?, event_mode = ?, event_date = ?, event_time = ?, venue = ?,
         dress_code_main = ?, dress_code_secondary = ?, dress_code_accent = ?,
         dress_code_notes = ?, maps_link = ?, contact_name = ?, contact_phone = ?,
         template_id = ?, name_color = ?, cn_color = ?, amount_color = ?,
         assigned_to = ?, description = ?, layout_config = ?
       WHERE id = ?`,
      [
        sanitize(event_name), safeType, safeMode,
        formatMySQLDate(event_date), sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
        safeTemplateId, safeNameColor, safeCnColor, safeAmountColor,
        newAssignedTo, safeDescription, safeLayoutConfig, id,
      ]
    );
    const [[event]] = await pool.execute('SELECT * FROM events WHERE id = ?', [id]);
    res.json({ success: true, event });
  } catch (err) {
    console.error('[updateEvent]', err.message);
    res.status(500).json({ success: false, message: 'Failed to update event.' });
  }
}

// DELETE /events/:id  — admin-only at route level; no scope check needed
async function deleteEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  try {
    const [result] = await pool.execute('DELETE FROM events WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }
    res.json({ success: true, message: 'Event deleted.' });
  } catch (err) {
    console.error('[deleteEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
}

module.exports = { listEvents, createEvent, getEvent, updateEvent, deleteEvent };
