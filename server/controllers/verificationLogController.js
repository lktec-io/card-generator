const pool = require('../config/db');
const { verificationScopeSQL } = require('../middleware/authMiddleware');

async function getVerificationHistory(req, res) {
  const scope = verificationScopeSQL(req.user);

  try {
    const [logs] = await pool.execute(
      `SELECT
         vl.id,
         vl.verification_method,
         vl.verified_at,
         vl.verified_by,
         i.code        AS invitation_code,
         i.guest_name,
         e.event_name
       FROM verification_logs vl
       JOIN  invitations i ON i.id = vl.invitation_id
       LEFT JOIN events  e ON e.id = vl.event_id
       WHERE 1=1 ${scope.where}
       ORDER BY vl.verified_at DESC
       LIMIT 200`,
      scope.params
    );
    res.json({ success: true, logs });
  } catch (err) {
    console.error('[getVerificationHistory]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch verification history.' });
  }
}

module.exports = { getVerificationHistory };
