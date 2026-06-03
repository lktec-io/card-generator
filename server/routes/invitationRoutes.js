const express   = require('express');
const path      = require('path');
const router    = express.Router();

const upload        = require('../middleware/upload');
const verifyToken   = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authMiddleware');

const {
  generateCard, verifyCode, getStats,
  deleteInvitation, deleteAllInvitations, reserveCode, verifyManual, bulkImport,
} = require('../controllers/invitationController');

const { getDashboard }           = require('../controllers/adminController');
const { listEvents, createEvent, getEvent, updateEvent, deleteEvent } = require('../controllers/eventController');
const { submitRSVP, getPublicInvite }  = require('../controllers/rsvpController');
const { getGlobalStats }         = require('../controllers/statsController');
const { getVerificationHistory } = require('../controllers/verificationLogController');

// ── API status ─────────────────────────────────────────────────────────────
router.get('/', (_req, res) => res.json({ status: 'ok', service: 'Nardio Events API v2' }));

// ── Public (no auth) ────────────────────────────────────────────────────────
router.post('/reserve',       reserveCode);
router.post('/import',        requireAdmin, bulkImport);
router.post('/generate',      upload.single('image'), generateCard);
router.post('/verify',        verifyCode);
router.post('/verify/manual', verifyManual);
router.get( '/stats',         getStats);

// Public invite page + RSVP — UUID-based (no auth, guests access directly)
router.get( '/invite/:uuid', getPublicInvite);
router.post('/rsvp/:uuid',   submitRSVP);

// ── Protected (admin JWT required) ─────────────────────────────────────────
router.get('/admin/dashboard',   requireAdmin, getDashboard);
router.get('/stats/global',      requireAdmin, getGlobalStats);
router.get('/verification-logs', requireAdmin, getVerificationHistory);

// Invitations — destructive ops are admin-only
router.delete('/invitations',     requireAdmin, deleteAllInvitations);
router.delete('/invitations/:id', requireAdmin, deleteInvitation);

// Events CRUD — all admin-only
router.get(   '/events',     requireAdmin, listEvents);
router.post(  '/events',     requireAdmin, createEvent);
router.get(   '/events/:id', requireAdmin, getEvent);
router.put(   '/events/:id', requireAdmin, updateEvent);
router.delete('/events/:id', requireAdmin, deleteEvent);

// ── Static — generated card images ─────────────────────────────────────────
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
