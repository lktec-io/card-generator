const pool = require('../config/db');

async function getDashboard(req, res) {
  const connection = await pool.getConnection();

  try {
    const [[{ total }]]  = await connection.execute('SELECT COUNT(*) AS total FROM invitations');
    const [[{ used }]]   = await connection.execute("SELECT COUNT(*) AS used   FROM invitations WHERE status = 'used'");
    const [[{ unused }]] = await connection.execute("SELECT COUNT(*) AS unused FROM invitations WHERE status = 'unused'");

    // RSVP stats
    const [[rsvpStats]] = await connection.execute(`
      SELECT
        COALESCE(SUM(response = 'attending'), 0) AS rsvp_attending,
        COALESCE(SUM(response = 'declined'),  0) AS rsvp_declined
      FROM rsvp_responses
    `);

    const [recent] = await connection.execute(
      `SELECT
         i.id,
         i.code,
         i.invitation_uuid,
         i.guest_name,
         i.phone_number,
         i.status,
         i.image_url,
         i.created_at,
         i.used_at,
         e.event_name,
         r.response AS rsvp_response
       FROM invitations i
       LEFT JOIN events          e ON e.id = i.event_id
       LEFT JOIN rsvp_responses  r ON r.invitation_id = i.id
       ORDER BY i.created_at DESC
       LIMIT 50`
    );

    res.json({
      success: true,
      stats: {
        total:          Number(total),
        used:           Number(used),
        unused:         Number(unused),
        rsvp_attending: Number(rsvpStats.rsvp_attending),
        rsvp_declined:  Number(rsvpStats.rsvp_declined),
        rsvp_pending:   Number(total) - Number(rsvpStats.rsvp_attending) - Number(rsvpStats.rsvp_declined),
      },
      recent,
    });

  } catch (err) {
    console.error('[getDashboard]', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
  } finally {
    connection.release();
  }
}

module.exports = { getDashboard };
