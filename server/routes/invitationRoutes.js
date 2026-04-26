const express = require('express');
const router  = express.Router();
const path    = require('path');

const upload                            = require('../middleware/upload');
const { generateCard, verifyCode, getStats } = require('../controllers/invitationController');

// POST /api/generate  — upload card image + generate QR overlay
router.post('/generate', upload.single('image'), generateCard);

// POST /api/verify    — verify a scanned QR code
router.post('/verify', verifyCode);

// GET  /api/stats     — dashboard statistics
router.get('/stats', getStats);

// GET  /api/generated/:filename  — serve locally saved generated cards
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
