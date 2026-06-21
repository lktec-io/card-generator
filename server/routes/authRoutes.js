const express = require('express');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const pool    = require('../config/db');
const router  = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'wedding_secret_key';

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body;
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // ── Bootstrap mode ─────────────────────────────────────────────────────
    // If the users table is empty, fall back to env-var credentials and
    // auto-create the first admin account so subsequent logins use DB auth.
    const [[{ cnt }]] = await pool.execute('SELECT COUNT(*) AS cnt FROM users');
    if (Number(cnt) === 0) {
      const adminEmail = (process.env.ADMIN_EMAIL    || 'cardhub@digital.com').toLowerCase();
      const adminPass  =  process.env.ADMIN_PASSWORD || '098765';

      if (cleanEmail !== adminEmail || password !== adminPass) {
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }

      const hash = await bcrypt.hash(password, 12);
      const [result] = await pool.execute(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ['Administrator', adminEmail, hash, 'admin']
      );
      const token = jwt.sign(
        { id: result.insertId, email: adminEmail, name: 'Administrator', role: 'admin' },
        JWT_SECRET, { expiresIn: '7d' }
      );
      console.log('[auth] Bootstrap: created first admin account.');
      return res.json({ success: true, token, role: 'admin', name: 'Administrator' });
    }

    // ── Normal DB auth ──────────────────────────────────────────────────────
    const [[user]] = await pool.execute(
      "SELECT * FROM users WHERE email = ? AND status = 'active' LIMIT 1",
      [cleanEmail]
    );

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET, { expiresIn: '7d' }
    );

    console.log(`[auth] Login: ${user.email} (${user.role})`);
    return res.json({ success: true, token, role: user.role, name: user.name });

  } catch (err) {
    console.error('[auth] login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
