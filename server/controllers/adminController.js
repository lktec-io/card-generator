const pool = require('../config/db');
const { invitationScopeSQL } = require('../middleware/authMiddleware');

async function getDashboard(req, res) {
  const scope = invitationScopeSQL(req.user);
  const connection = await pool.getConnection();

  try {
    const [[counts]] = await connection.execute(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(status='used'),  0) AS used,
         COALESCE(SUM(status='unused'),0) AS unused
       FROM invitations i
       WHERE 1=1 ${scope.where}`,
      scope.params
    );

    const [[rsvpStats]] = await connection.execute(
      `SELECT
         COALESCE(SUM(response = 'attending'), 0) AS rsvp_attending,
         COALESCE(SUM(response = 'declined'),  0) AS rsvp_declined
       FROM rsvp_responses r
       JOIN invitations i ON i.id = r.invitation_id
       WHERE 1=1 ${scope.where}`,
      scope.params
    );

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
         r.response          AS rsvp_response,
         r.voice_message_url AS rsvp_voice_url
       FROM invitations i
       LEFT JOIN events          e ON e.id = i.event_id
       LEFT JOIN rsvp_responses  r ON r.invitation_id = i.id
       WHERE 1=1 ${scope.where}
       ORDER BY i.created_at DESC
       LIMIT 50`,
      scope.params
    );

    const total = Number(counts.total);

    res.json({
      success: true,
      stats: {
        total,
        used:           Number(counts.used),
        unused:         Number(counts.unused),
        rsvp_attending: Number(rsvpStats.rsvp_attending),
        rsvp_declined:  Number(rsvpStats.rsvp_declined),
        rsvp_pending:   total - Number(rsvpStats.rsvp_attending) - Number(rsvpStats.rsvp_declined),
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
