const pool   = require('../config/db');
const bcrypt = require('bcryptjs');
const { hasPermissionColumn } = require('../utils/smsBalanceAccess');

const VALID_ROLES        = ['admin', 'event_manager', 'verifier'];
const VALID_ACCESS_TYPES = ['invitation', 'contribution', 'both'];

const USER_SELECT = 'id, name, email, role, status, access_type, created_by, created_at';

// USER_SELECT plus the SMS-balance permission once that column exists
async function userSelect() {
  return (await hasPermissionColumn()) ? `${USER_SELECT}, can_view_sms_balance` : USER_SELECT;
}

// The "Can View SMS Balance" value to write, or null to leave it unchanged.
// Only super_admin may grant or revoke it, and only when the field is sent —
// so edits that do not include it (or come from an admin) keep the current value.
async function smsBalanceGrant(req) {
  if (req.user?.role !== 'super_admin') return null;
  if (!Object.prototype.hasOwnProperty.call(req.body, 'can_view_sms_balance')) return null;
  if (!(await hasPermissionColumn())) return null;
  const v = req.body.can_view_sms_balance;
  return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
}

// Returns { where, params } to scope users to the requester (admin sees only their sub-users)
function userScopeSQL(user) {
  if (!user || user.role === 'super_admin') return { where: '', params: [] };
  if (user.role === 'admin' && user.id) {
    return { where: 'WHERE created_by = ?', params: [user.id] };
  }
  return { where: 'WHERE 1=0', params: [] }; // non-admin roles can't list users
}

// GET /users
async function listUsers(req, res) {
  try {
    const scope = userScopeSQL(req.user);
    const [users] = await pool.execute(
      `SELECT ${await userSelect()} FROM users ${scope.where} ORDER BY created_at DESC`,
      scope.params
    );
    res.json({ success: true, users });
  } catch (err) {
    console.error('[listUsers]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// GET /users/dropdown — manager+ — lightweight list for assignment selects
async function listForDropdown(req, res) {
  try {
    const scope = userScopeSQL(req.user);
    const whereClause = scope.where
      ? `${scope.where} AND status = 'active'`
      : "WHERE status = 'active'";
    const [users] = await pool.execute(
      `SELECT id, name, role FROM users ${whereClause} ORDER BY name ASC`,
      scope.params
    );
    res.json({ success: true, users });
  } catch (err) {
    console.error('[listForDropdown]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// POST /users
async function createUser(req, res) {
  const { name = '', email = '', password = '', role = 'verifier', access_type = 'both' } = req.body;
  const cleanName  = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
  }

  const safeRole       = VALID_ROLES.includes(role)               ? role        : 'verifier';
  const safeAccessType = VALID_ACCESS_TYPES.includes(access_type) ? access_type : 'both';

  try {
    const createdBy = req.user?.id || null;
    const hash = await bcrypt.hash(password, 12);
    const grant = await smsBalanceGrant(req);
    const [result] = grant === null
      ? await pool.execute(
        'INSERT INTO users (name, email, password, role, access_type, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanName, cleanEmail, hash, safeRole, safeAccessType, createdBy]
      )
      : await pool.execute(
        'INSERT INTO users (name, email, password, role, access_type, created_by, can_view_sms_balance) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [cleanName, cleanEmail, hash, safeRole, safeAccessType, createdBy, grant]
      );
    const [[user]] = await pool.execute(
      `SELECT ${await userSelect()} FROM users WHERE id = ?`,
      [result.insertId]
    );
    console.log(`[createUser] "${user.name}" <${user.email}> role=${user.role} access=${user.access_type}`);
    res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error('[createUser]', err);
    res.status(500).json({ success: false, message: 'Failed to create user.' });
  }
}

// Returns extra WHERE clause to enforce that an admin can only access users they created
function ownedByClause(user) {
  if (!user || user.role === 'super_admin') return { clause: '', params: [] };
  if (user.role === 'admin' && user.id) return { clause: 'AND created_by = ?', params: [user.id] };
  return { clause: 'AND 1=0', params: [] };
}

// GET /users/:id
async function getUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  try {
    const owned = ownedByClause(req.user);
    const [[user]] = await pool.execute(
      `SELECT ${await userSelect()} FROM users WHERE id = ? ${owned.clause}`,
      [id, ...owned.params]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    console.error('[getUser]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch user.' });
  }
}

// PUT /users/:id
async function updateUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  const { name = '', email = '', role = '', password, access_type = 'both' } = req.body;
  const cleanName  = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail) {
    return res.status(400).json({ success: false, message: 'Name and email are required.' });
  }

  const safeRole       = VALID_ROLES.includes(role)               ? role        : 'verifier';
  const safeAccessType = VALID_ACCESS_TYPES.includes(access_type) ? access_type : 'both';

  try {
    const owned = ownedByClause(req.user);
    const grant = await smsBalanceGrant(req);
    const grantSet    = grant === null ? '' : ', can_view_sms_balance = ?';
    const grantParams = grant === null ? [] : [grant];
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.execute(
        `UPDATE users SET name = ?, email = ?, role = ?, access_type = ?, password = ?${grantSet} WHERE id = ? ${owned.clause}`,
        [cleanName, cleanEmail, safeRole, safeAccessType, hash, ...grantParams, id, ...owned.params]
      );
    } else {
      await pool.execute(
        `UPDATE users SET name = ?, email = ?, role = ?, access_type = ?${grantSet} WHERE id = ? ${owned.clause}`,
        [cleanName, cleanEmail, safeRole, safeAccessType, ...grantParams, id, ...owned.params]
      );
    }

    const [[user]] = await pool.execute(
      `SELECT ${await userSelect()} FROM users WHERE id = ?`,
      [id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error('[updateUser]', err);
    res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
}

// PATCH /users/:id/status
async function toggleStatus(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  if (req.user.id && Number(req.user.id) === id) {
    return res.status(403).json({ success: false, message: 'You cannot disable your own account.' });
  }

  try {
    const owned = ownedByClause(req.user);
    const [[existing]] = await pool.execute(
      `SELECT id, status FROM users WHERE id = ? ${owned.clause}`,
      [id, ...owned.params]
    );
    if (!existing) return res.status(404).json({ success: false, message: 'User not found.' });

    const newStatus = existing.status === 'active' ? 'disabled' : 'active';
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [newStatus, id]);

    const [[user]] = await pool.execute(
      `SELECT ${await userSelect()} FROM users WHERE id = ?`, [id]
    );
    res.json({ success: true, user });
  } catch (err) {
    console.error('[toggleStatus]', err);
    res.status(500).json({ success: false, message: 'Failed to update user status.' });
  }
}

// DELETE /users/:id
async function deleteUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  if (req.user.id && Number(req.user.id) === id) {
    return res.status(403).json({ success: false, message: 'You cannot delete your own account.' });
  }

  try {
    const owned = ownedByClause(req.user);
    const [result] = await pool.execute(
      `DELETE FROM users WHERE id = ? ${owned.clause}`,
      [id, ...owned.params]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    console.error('[deleteUser]', err);
    res.status(500).json({ success: false, message: 'Failed to delete user.' });
  }
}

module.exports = { listUsers, listForDropdown, createUser, getUser, updateUser, toggleStatus, deleteUser };
