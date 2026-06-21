const pool   = require('../config/db');
const bcrypt = require('bcryptjs');

const VALID_ROLES = ['admin', 'event_manager', 'verifier'];

// GET /users
async function listUsers(_req, res) {
  try {
    const [users] = await pool.execute(
      'SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, users });
  } catch (err) {
    console.error('[listUsers]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// GET /users/dropdown — manager+ — lightweight list for assignment selects
async function listForDropdown(_req, res) {
  try {
    const [users] = await pool.execute(
      "SELECT id, name, role FROM users WHERE status = 'active' ORDER BY name ASC"
    );
    res.json({ success: true, users });
  } catch (err) {
    console.error('[listForDropdown]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// POST /users
async function createUser(req, res) {
  const { name = '', email = '', password = '', role = 'verifier' } = req.body;
  const cleanName  = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
  }

  const safeRole = VALID_ROLES.includes(role) ? role : 'verifier';

  try {
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [cleanName, cleanEmail, hash, safeRole]
    );
    const [[user]] = await pool.execute(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = ?',
      [result.insertId]
    );
    console.log(`[createUser] "${user.name}" <${user.email}> role=${user.role}`);
    res.status(201).json({ success: true, user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error('[createUser]', err);
    res.status(500).json({ success: false, message: 'Failed to create user.' });
  }
}

// GET /users/:id
async function getUser(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid user ID.' });

  try {
    const [[user]] = await pool.execute(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = ?',
      [id]
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

  const { name = '', email = '', role = '', password } = req.body;
  const cleanName  = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName || !cleanEmail) {
    return res.status(400).json({ success: false, message: 'Name and email are required.' });
  }

  const safeRole = VALID_ROLES.includes(role) ? role : 'verifier';

  try {
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, role = ?, password = ? WHERE id = ?',
        [cleanName, cleanEmail, safeRole, hash, id]
      );
    } else {
      await pool.execute(
        'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
        [cleanName, cleanEmail, safeRole, id]
      );
    }

    const [[user]] = await pool.execute(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = ?',
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
    const [[existing]] = await pool.execute(
      'SELECT id, status FROM users WHERE id = ?', [id]
    );
    if (!existing) return res.status(404).json({ success: false, message: 'User not found.' });

    const newStatus = existing.status === 'active' ? 'disabled' : 'active';
    await pool.execute('UPDATE users SET status = ? WHERE id = ?', [newStatus, id]);

    const [[user]] = await pool.execute(
      'SELECT id, name, email, role, status, created_at FROM users WHERE id = ?', [id]
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
    const [result] = await pool.execute('DELETE FROM users WHERE id = ?', [id]);
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
