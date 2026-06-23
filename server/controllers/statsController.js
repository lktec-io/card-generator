const pool = require('../config/db');
const { invitationScopeSQL, eventScopeSQL } = require('../middleware/authMiddleware');

async function getGlobalStats(req, res) {
  const iScope = invitationScopeSQL(req.user);
  const eScope = eventScopeSQL(req.user);
  const isSuperAdmin = !req.user || req.user.role === 'super_admin';
  const isAdmin      = req.user?.role === 'admin' || req.user?.role === 'super_admin';

  try {
    const [[inv]] = await pool.execute(
      `SELECT
         COUNT(*)                         AS total_invitations,
         COALESCE(SUM(status='used'),  0) AS checked_in,
         COALESCE(SUM(status='unused'),0) AS pending
       FROM invitations i
       WHERE 1=1 ${iScope.where}`,
      iScope.params
    );

    const [[evCount]] = await pool.execute(
      `SELECT COUNT(*) AS total_events FROM events e WHERE 1=1 ${eScope.where}`,
      eScope.params
    );

    const [rsvpRows] = await pool.execute(
      `SELECT r.response, COUNT(*) AS count
         FROM rsvp_responses r
         JOIN invitations i ON i.id = r.invitation_id
        WHERE 1=1 ${iScope.where}
        GROUP BY r.response`,
      iScope.params
    );
    const rsvp = { attending: 0, declined: 0, pending: 0 };
    rsvpRows.forEach(r => { rsvp[r.response] = Number(r.count); });

    const checkedIn = Number(inv.checked_in);
    const total     = Number(inv.total_invitations);
    const attendanceRate = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

    const [recentCheckins] = await pool.execute(
      `SELECT i.code, i.guest_name, i.used_at, e.event_name
         FROM invitations i
         LEFT JOIN events e ON e.id = i.event_id
        WHERE i.status = 'used' ${iScope.where}
        ORDER BY i.used_at DESC
        LIMIT 5`,
      iScope.params
    );

    const [recentRSVP] = await pool.execute(
      `SELECT i.code, i.guest_name, r.response, r.created_at, e.event_name
         FROM rsvp_responses r
         JOIN  invitations i ON i.id = r.invitation_id
         LEFT JOIN events e ON e.id = r.event_id
        WHERE 1=1 ${iScope.where}
        ORDER BY r.created_at DESC
        LIMIT 5`,
      iScope.params
    );

    const stats = {
      total_events:      Number(evCount.total_events),
      total_invitations: total,
      checked_in:        checkedIn,
      pending:           Number(inv.pending),
      rsvp_attending:    rsvp.attending,
      rsvp_declined:     rsvp.declined,
      attendance_rate:   attendanceRate,
    };

    // Admin-level extras — scoped appropriately
    if (isAdmin) {
      const [[{ total_users }]] = await pool.execute('SELECT COUNT(*) AS total_users FROM users');
      const [[{ total_campaigns }]] = await pool.execute(
        `SELECT COUNT(*) AS total_campaigns FROM events e WHERE e.event_mode = 'contribution' ${eScope.where}`,
        eScope.params
      );
      stats.total_users     = Number(total_users);
      stats.total_campaigns = Number(total_campaigns);
    }

    res.json({
      success: true,
      stats,
      recent_checkins: recentCheckins,
      recent_rsvp:     recentRSVP,
    });
  } catch (err) {
    console.error('[getGlobalStats]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  }
}

module.exports = { getGlobalStats };
