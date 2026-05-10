const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const ADMIN_EMAIL    = 'admin@wedding.com';
const ADMIN_PASSWORD = '123456';
const JWT_SECRET     = 'wedding_secret_key';

// POST /login  (mounted at /api/auth → full path: /api/auth/login)
router.post('/login', async (req, res) => {
  try {
    console.log('[LOGIN BODY]', req.body);

    const { email = '', password = '' } = req.body;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token });
    }

    return res.status(401).json({ success: false, message: 'Invalid credentials.' });

  } catch (error) {
    console.error('[auth] error:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
