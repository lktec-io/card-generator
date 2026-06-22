const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'wedding_secret_key';

function _verify(req) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// Any authenticated user
function verifyToken(req, res, next) {
  const user = _verify(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  req.user = user;
  next();
}

// super_admin OR admin
function requireAdmin(req, res, next) {
  const user = _verify(req);
  if (!user) return res.status(401).json({ success: false, message: 'Authentication required.' });
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }
  req.user = user;
  next();
}

// super_admin OR admin OR event_manager
function requireManager(req, res, next) {
  const user = _verify(req);
  if (!user) return res.status(401).json({ success: false, message: 'Authentication required.' });
  if (user.role !== 'super_admin' && user.role !== 'admin' && user.role !== 'event_manager') {
    return res.status(403).json({ success: false, message: 'Manager access required.' });
  }
  req.user = user;
  next();
}

// Any logged-in user (super_admin + admin + event_manager + verifier + legacy gate_staff)
function requireAuth(req, res, next) {
  const user = _verify(req);
  if (!user) return res.status(401).json({ success: false, message: 'Authentication required.' });
  req.user = user;
  next();
}

// Reads token silently — never returns 401. Used on public endpoints that benefit
// from optional scope narrowing (e.g. /verify, /verify/manual).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore bad token */ }
  }
  next();
}

// Returns SQL WHERE fragment + params to scope event queries by role.
// The alias for the events table must be 'e'.
function eventScopeSQL(user) {
  if (!user || user.role === 'super_admin') return { where: '', params: [] };
  if (user.role === 'admin') {
    // Guard: old JWT tokens may lack the id field — treat as no-access so user re-logs in.
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return { where: 'AND e.created_by = ?', params: [user.id] };
  }
  if (user.role === 'event_manager') {
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return {
      where:  'AND (e.created_by = ? OR e.assigned_to = ?)',
      params: [user.id, user.id],
    };
  }
  // verifier or legacy gate_staff — sees only explicitly assigned events
  if (!user.id) return { where: 'AND 1=0', params: [] };
  return { where: 'AND e.assigned_to = ?', params: [user.id] };
}

// Same scope but expressed as a subquery (for WHERE i.event_id IN (...)).
// Invitation alias must be 'i'.
function invitationScopeSQL(user) {
  if (!user || user.role === 'super_admin') return { where: '', params: [] };
  if (user.role === 'admin') {
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return {
      where:  'AND i.event_id IN (SELECT id FROM events WHERE created_by = ?)',
      params: [user.id],
    };
  }
  if (user.role === 'event_manager') {
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return {
      where:  'AND i.event_id IN (SELECT id FROM events WHERE created_by = ? OR assigned_to = ?)',
      params: [user.id, user.id],
    };
  }
  if (!user.id) return { where: 'AND 1=0', params: [] };
  return {
    where:  'AND i.event_id IN (SELECT id FROM events WHERE assigned_to = ?)',
    params: [user.id],
  };
}

// Scope for verification_logs — joins through events table.
// vl = verification_logs alias, e = events alias (joined in caller).
function verificationScopeSQL(user) {
  if (!user || user.role === 'super_admin') return { where: '', params: [] };
  if (user.role === 'admin') {
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return { where: 'AND e.created_by = ?', params: [user.id] };
  }
  if (user.role === 'event_manager') {
    if (!user.id) return { where: 'AND 1=0', params: [] };
    return { where: 'AND (e.created_by = ? OR e.assigned_to = ?)', params: [user.id, user.id] };
  }
  if (!user.id) return { where: 'AND 1=0', params: [] };
  return { where: 'AND e.assigned_to = ?', params: [user.id] };
}

module.exports                       = verifyToken;
module.exports.requireAdmin          = requireAdmin;
module.exports.requireManager        = requireManager;
module.exports.requireAuth           = requireAuth;
module.exports.optionalAuth          = optionalAuth;
module.exports.eventScopeSQL         = eventScopeSQL;
module.exports.invitationScopeSQL    = invitationScopeSQL;
module.exports.verificationScopeSQL  = verificationScopeSQL;
