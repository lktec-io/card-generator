const pool = require('../config/db');
const { verificationScopeSQL } = require('../middleware/authMiddleware');
const { hasVerifierColumn, authenticatedUserId } = require('../utils/verificationLog');

// Field staff only ever see their own check-ins
const FIELD_ROLES = ['verifier', 'gate_staff'];

// GET /verification-logs
//   verifier / gate_staff → only the rows THEY performed. Identity comes from the JWT
//                           (req.user); any query parameter is ignored for these roles.
//   admin / manager / super_admin → existing event scope, optionally narrowed to one
//                           user with ?verifier_id= (a filter inside their scope, not identity).
async function getVerificationHistory(req, res) {
  const isFieldUser = FIELD_ROLES.includes(req.user?.role);
  const trackable   = await hasVerifierColumn();

  const select = `
    SELECT
      vl.id,
      vl.verification_method,
      vl.verified_at,
      vl.verified_by,
      ${trackable ? 'vl.verified_by_user_id, u.name AS verifier_name,' : 'NULL AS verified_by_user_id, NULL AS verifier_name,'}
      i.code        AS invitation_code,
      i.guest_name,
      e.event_name
    FROM verification_logs vl
    JOIN  invitations i ON i.id = vl.invitation_id
    LEFT JOIN events  e ON e.id = vl.event_id
    ${trackable ? 'LEFT JOIN users u ON u.id = vl.verified_by_user_id' : ''}`;

  let where  = '';
  let params = [];

  if (isFieldUser) {
    const me = authenticatedUserId(req.user);
    if (!trackable || !me) {
      // Ownership can't be proven (migration not run / token without id): show nothing
      return res.json({ success: true, scope: 'mine', trackable, logs: [] });
    }
    where  = 'WHERE vl.verified_by_user_id = ?';
    params = [me];
  } else {
    const scope = verificationScopeSQL(req.user);
    where  = `WHERE 1=1 ${scope.where}`;
    params = [...scope.params];

    const filterId = Number(req.query.verifier_id);
    if (trackable && Number.isInteger(filterId) && filterId > 0) {
      where += ' AND vl.verified_by_user_id = ?';
      params.push(filterId);
    }
  }

  try {
    const [logs] = await pool.execute(
      `${select}
       ${where}
       ORDER BY vl.verified_at DESC
       LIMIT 200`,
      params
    );
    res.json({ success: true, scope: isFieldUser ? 'mine' : 'all', trackable, logs });
  } catch (err) {
    console.error('[getVerificationHistory]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch verification history.' });
  }
}

module.exports = { getVerificationHistory };
