const express   = require('express');
const path      = require('path');
const multer    = require('multer');
const router    = express.Router();

const upload        = require('../middleware/upload');
const verifyToken                              = require('../middleware/authMiddleware');
const { requireAdmin, requireManager, requireAuth } = require('../middleware/authMiddleware');

// Audio upload multer — accepts audio/* and video/webm (Chrome records audio as video/webm)
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed.'));
    }
  },
});

const {
  generateCard, verifyCode, getStats,
  deleteInvitation, deleteAllInvitations, reserveCode, verifyManual, bulkImport, trackShare,
} = require('../controllers/invitationController');

const { getDashboard }           = require('../controllers/adminController');
const { listEvents, createEvent, getEvent, updateEvent, deleteEvent } = require('../controllers/eventController');
const { submitRSVP, getPublicInvite } = require('../controllers/rsvpController');
const { sendVoiceMessage, getVoiceMessages, deleteVoiceMessage } = require('../controllers/voiceMessageController');
const {
  listTemplates, listAllTemplates, toggleTemplate,
  createContributionTemplate, updateTemplateLayout,
} = require('../controllers/templateController');
const { getGlobalStats }         = require('../controllers/statsController');
const { getVerificationHistory } = require('../controllers/verificationLogController');

// ── API status ─────────────────────────────────────────────────────────────
router.get('/', (_req, res) => res.json({ status: 'ok', service: 'Nardio Events API v2' }));

// ── Templates (active list is public, admin ops require auth) ──────────────
router.get('/templates',         listTemplates);
router.get('/templates/all',     requireManager, listAllTemplates);
router.patch('/templates/:id/toggle', requireAdmin,   toggleTemplate);
router.patch('/templates/:id/layout', requireManager, updateTemplateLayout);
router.post('/templates/contribution', requireManager,
  upload.fields([{ name: 'background', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]),
  createContributionTemplate);

// ── Public (no auth) ────────────────────────────────────────────────────────
router.post('/reserve',       reserveCode);
router.post('/import',        requireManager, bulkImport);
router.post('/generate',      upload.single('image'), generateCard);
router.post('/verify',        verifyCode);
router.post('/verify/manual', verifyManual);
router.get( '/stats',         getStats);

// Public invite page + RSVP — UUID-based
router.get( '/invite/:uuid',       getPublicInvite);
router.post('/rsvp/:uuid',         submitRSVP);

// Public voice message — guest sends standalone voice (no auth, max 10 MB)
router.post('/voice-message/:uuid', audioUpload.single('audio'), sendVoiceMessage);

// ── Protected (admin JWT required) ─────────────────────────────────────────
router.get('/admin/dashboard',   requireAuth, getDashboard);
router.get('/stats/global',      requireAuth, getGlobalStats);
router.get('/verification-logs', requireAuth, getVerificationHistory);

// Invitations — destructive ops are admin-only
router.delete('/invitations',     requireAdmin,   deleteAllInvitations);
router.delete('/invitations/:id', requireManager, deleteInvitation);
router.post(  '/invitations/:id/share', requireManager, trackShare);

// Events CRUD — all admin-only
router.get(   '/events',                    requireAuth,    listEvents);
router.post(  '/events',                    requireManager, createEvent);
router.get(   '/events/:id',               requireAuth,    getEvent);
router.put(   '/events/:id',               requireManager, updateEvent);
router.delete('/events/:id',               requireAdmin,   deleteEvent);
router.get(   '/events/:id/voice-messages',requireAuth,    getVoiceMessages);
router.delete('/voice-messages/:id',       requireAdmin,   deleteVoiceMessage);

// ── Static — generated card images ─────────────────────────────────────────
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
