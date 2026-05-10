const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@wedding.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@2024';
const JWT_SECRET     = process.env.JWT_SECRET     || 'wqr-jwt-secret-key';
const JWT_EXPIRES    = '12h';

// POST /auth/login
router.post('/auth/login', (req, res) => {
  const { email = '', password = '' } = req.body;

  if (
    email.trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase() ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return res.json({ success: true, token });
});

module.exports = router;
