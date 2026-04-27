const express = require('express');
const router  = express.Router();
const path    = require('path');

const upload                                     = require('../middleware/upload');
const { generateCard, verifyCode, getStats, deleteInvitation, deleteAllInvitations } = require('../controllers/invitationController');
const { getDashboard }                           = require('../controllers/adminController');

// GET  /  (becomes /api when proxied) — API status
router.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Wedding QR API' });
});

// POST /generate  — upload card image + generate QR overlay
router.post('/generate', upload.single('image'), generateCard);

// POST /verify    — verify a scanned QR code
router.post('/verify', verifyCode);

// GET  /stats     — dashboard statistics
router.get('/stats', getStats);

// GET  /admin/dashboard  — full invitation list + stats for admin page
router.get('/admin/dashboard', getDashboard);

// DELETE /invitations  — remove ALL invitation records
router.delete('/invitations', deleteAllInvitations);

// DELETE /invitations/:id  — remove a single invitation record
router.delete('/invitations/:id', deleteInvitation);

// GET  /generated/:filename  — serve locally saved generated cards
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
