const express = require('express');
const router  = express.Router();
const path    = require('path');

const upload       = require('../middleware/upload');
const verifyToken  = require('../middleware/authMiddleware');
const { generateCard, verifyCode, getStats, deleteInvitation, deleteAllInvitations, reserveCode, verifyManual } = require('../controllers/invitationController');
const { getDashboard } = require('../controllers/adminController');

// GET  /  (becomes /api when proxied) — API status
router.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Wedding QR API' });
});

// POST /reserve   — reserve a CN code (no image); frontend renders card with html2canvas
router.post('/reserve', reserveCode);

// POST /generate  — upload card image + generate QR overlay (legacy / server-side flow)
router.post('/generate', upload.single('image'), generateCard);

// POST /verify        — verify a scanned QR code
router.post('/verify', verifyCode);

// POST /verify/manual — verify by manually typed CN code (guests without smartphones)
router.post('/verify/manual', verifyManual);

// GET  /stats     — dashboard statistics
router.get('/stats', getStats);

// GET  /admin/dashboard  — full invitation list + stats (auth required)
router.get('/admin/dashboard', verifyToken, getDashboard);

// DELETE /invitations  — remove ALL invitation records (auth required)
router.delete('/invitations', verifyToken, deleteAllInvitations);

// DELETE /invitations/:id  — remove a single invitation record (auth required)
router.delete('/invitations/:id', verifyToken, deleteInvitation);

// GET  /generated/:filename  — serve locally saved generated cards
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
