const pool = require('../config/db');

const VALID_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

function sanitize(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; }

// GET /events
async function listEvents(req, res) {
  try {
    const [events] = await pool.execute(`
      SELECT
        e.*,
        COUNT(DISTINCT i.id)                       AS total_invitations,
        COALESCE(SUM(i.status = 'used'),        0) AS checked_in,
        COALESCE(SUM(r.response = 'attending'), 0) AS rsvp_attending,
        COALESCE(SUM(r.response = 'declined'),  0) AS rsvp_declined
      FROM events e
      LEFT JOIN invitations    i ON i.event_id = e.id
      LEFT JOIN rsvp_responses r ON r.event_id = e.id
      GROUP BY e.id
      ORDER BY e.created_at DESC
    `);
    res.json({ success: true, events });
  } catch (err) {
    console.error('[listEvents]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch events.' });
  }
}

// POST /events
async function createEvent(req, res) {
  const {
    event_name, event_type, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  const safeType = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';

  try {
    const [result] = await pool.execute(
      `INSERT INTO events
         (event_name, event_type, event_date, event_time, venue,
          dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
          maps_link, contact_name, contact_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitize(event_name), safeType,
        sanitize(event_date),  sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
      ]
    );
    const [[event]] = await pool.execute('SELECT * FROM events WHERE id = ?', [result.insertId]);
    console.log(`[createEvent] "${event.event_name}" id=${event.id}`);
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

    const [invitations] = await pool.execute(
      `SELECT i.id, i.code, i.invitation_uuid, i.guest_name, i.phone_number,
              i.status, i.image_url, i.created_at, i.used_at,
              r.response AS rsvp_response
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

    res.json({ success: true, event, invitations, stats, rsvp });
  } catch (err) {
    console.error('[getEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch event.' });
  }
}

// PUT /events/:id  — fixed: ENUM guard prevents 500 on undefined event_type
async function updateEvent(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  const {
    event_name, event_type, event_date, event_time, venue,
    dress_code_main, dress_code_secondary, dress_code_accent, dress_code_notes,
    maps_link, contact_name, contact_phone,
  } = req.body;

  if (!sanitize(event_name)) {
    return res.status(400).json({ success: false, message: 'Event name is required.' });
  }

  // Guard: never send undefined/null to a NOT NULL ENUM column
  const safeType = VALID_TYPES.includes(event_type) ? event_type : 'Wedding';

  try {
    await pool.execute(
      `UPDATE events SET
         event_name = ?, event_type = ?, event_date = ?, event_time = ?, venue = ?,
         dress_code_main = ?, dress_code_secondary = ?, dress_code_accent = ?,
         dress_code_notes = ?, maps_link = ?, contact_name = ?, contact_phone = ?
       WHERE id = ?`,
      [
        sanitize(event_name), safeType,
        sanitize(event_date),  sanitize(event_time), sanitize(venue),
        sanitize(dress_code_main), sanitize(dress_code_secondary),
        sanitize(dress_code_accent), sanitize(dress_code_notes),
        sanitize(maps_link), sanitize(contact_name), sanitize(contact_phone),
        id,
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
    res.json({ success: true, message: 'Event deleted.' });
  } catch (err) {
    console.error('[deleteEvent]', err);
    res.status(500).json({ success: false, message: 'Failed to delete event.' });
  }
}

module.exports = { listEvents, createEvent, getEvent, updateEvent, deleteEvent };
