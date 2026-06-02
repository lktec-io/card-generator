const pool = require('../config/db');

async function getGlobalStats(req, res) {
  try {
    const [[inv]] = await pool.execute(`
      SELECT
        COUNT(*)                         AS total_invitations,
        COALESCE(SUM(status='used'),  0) AS checked_in,
        COALESCE(SUM(status='unused'),0) AS pending
      FROM invitations
    `);

    const [[evCount]] = await pool.execute(
      'SELECT COUNT(*) AS total_events FROM events'
    );

    const [rsvpRows] = await pool.execute(
      `SELECT response, COUNT(*) AS count FROM rsvp_responses GROUP BY response`
    );
    const rsvp = { attending: 0, declined: 0, pending: 0 };
    rsvpRows.forEach(r => { rsvp[r.response] = Number(r.count); });

    const checkedIn = Number(inv.checked_in);
    const total     = Number(inv.total_invitations);
    const attendanceRate = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

    const [recentCheckins] = await pool.execute(`
      SELECT i.code, i.guest_name, i.used_at, e.event_name
        FROM invitations i
        LEFT JOIN events e ON e.id = i.event_id
       WHERE i.status = 'used'
       ORDER BY i.used_at DESC
       LIMIT 5
    `);

    const [recentRSVP] = await pool.execute(`
      SELECT i.code, i.guest_name, r.response, r.created_at, e.event_name
        FROM rsvp_responses r
        JOIN  invitations i ON i.id = r.invitation_id
        LEFT JOIN events e ON e.id = r.event_id
       ORDER BY r.created_at DESC
       LIMIT 5
    `);

    res.json({
      success: true,
      stats: {
        total_events:      Number(evCount.total_events),
        total_invitations: total,
        checked_in:        checkedIn,
        pending:           Number(inv.pending),
        rsvp_attending:    rsvp.attending,
        rsvp_declined:     rsvp.declined,
        attendance_rate:   attendanceRate,
      },
      recent_checkins: recentCheckins,
      recent_rsvp:     recentRSVP,
    });
  } catch (err) {
    console.error('[getGlobalStats]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
}

module.exports = { getGlobalStats };
