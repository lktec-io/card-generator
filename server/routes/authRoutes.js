const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const JWT_SECRET = 'wedding_secret_key';

// Hardcoded user store — replace with DB lookup when user management is needed
const USERS = [
  {
    email:    process.env.ADMIN_EMAIL    || 'cardhub@digital.com',
    password: process.env.ADMIN_PASSWORD || '098765',
    role:     'admin',
  },
  {
    email:    process.env.STAFF_EMAIL    || 'staff@cardhub.com',
    password: process.env.STAFF_PASSWORD || 'staff123',
    role:     'gate_staff',
  },
];

// POST /login  — mounted at /auth, full path: /auth/login (Nginx strips /api)
router.post('/login', async (req, res) => {
  try {
    console.log('[LOGIN BODY]', req.body);

    const { email = '', password = '' } = req.body;
    const user = USERS.find(u => u.email === email && u.password === password);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ success: true, token, role: user.role });

  } catch (error) {
    console.error('[auth] error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
