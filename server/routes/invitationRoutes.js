const express   = require('express');
const path      = require('path');
const multer    = require('multer');
const router    = express.Router();

const upload        = require('../middleware/upload');
const verifyToken                              = require('../middleware/authMiddleware');
const { requireAdmin, requireManager, requireAuth, optionalAuth } = require('../middleware/authMiddleware');

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
  generateCard, renderCard, verifyCode, getStats,
  deleteInvitation, deleteAllInvitations, reserveCode, verifyManual, bulkImport, trackShare,
  searchGuests,
} = require('../controllers/invitationController');

const {
  sheetUpload, generateUpload, retryUpload,
  validateImport, bulkGenerate, bulkGenerateProgress, bulkGenerateRetry, downloadTemplate,
} = require('../controllers/bulkGenerateController');

const { getDashboard }           = require('../controllers/adminController');
const { listEvents, createEvent, getEvent, updateEvent, deleteEvent } = require('../controllers/eventController');
const { submitRSVP, getPublicInvite } = require('../controllers/rsvpController');
const { sendVoiceMessage, getVoiceMessages, deleteVoiceMessage } = require('../controllers/voiceMessageController');
const { listTemplates }          = require('../controllers/templateController');
const { getGlobalStats }         = require('../controllers/statsController');
const { getVerificationHistory } = require('../controllers/verificationLogController');
const { sendSingle, sendBulk, getBulkProgress, getSmsLogs, retrySms,
        getThankYouInfo, saveThankYouTemplate, sendThankYouSingle, sendThankYouBulk } = require('../controllers/smsController');

// ── API status ─────────────────────────────────────────────────────────────
router.get('/', (_req, res) => res.json({ status: 'ok', service: 'Nardio Events API v2' }));

// ── Templates (active list only — management routes removed) ───────────────
router.get('/templates', listTemplates);

// ── Public (no auth) ────────────────────────────────────────────────────────
router.post('/reserve',       reserveCode);
router.post('/import',        requireManager, bulkImport);

// Bulk card generation — the Import module's second workflow. Separate from
// /generate (single card) and from /import (guest rows only, no cards).
router.get( '/import/template',                    requireManager, downloadTemplate);
router.post('/import/validate',                    requireManager, sheetUpload,    validateImport);
router.post('/import/bulk-generate/:event_id',     requireManager, generateUpload, bulkGenerate);
router.get( '/import/bulk-generate/progress/:job_id', requireManager, bulkGenerateProgress);
router.post('/import/bulk-generate/retry/:job_id', requireManager, retryUpload,    bulkGenerateRetry);

router.post('/generate',      upload.single('image'), generateCard);
router.post('/render',        upload.single('image'), renderCard);
router.post('/verify',        optionalAuth, verifyCode);
router.post('/verify/manual', optionalAuth, verifyManual);
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

// Guest name search for staff-assisted check-in (read-only; check-in still goes
// through /verify/manual). Declared before any '/invitations/:id' style route.
router.get('/invitations/search', requireAuth, searchGuests);

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

// ── SMS ─────────────────────────────────────────────────────────────────────
router.post('/sms/send/:invitation_id',      requireManager, sendSingle);
router.post('/sms/bulk/:event_id',           requireManager, sendBulk);
router.get( '/sms/bulk/progress/:job_id',   requireManager, getBulkProgress);
router.get( '/sms/logs/:event_id',          requireAuth,    getSmsLogs);
router.post('/sms/retry/:log_id',           requireManager, retrySms);

// Post-event thank-you — same requireManager rule as the other SMS routes (verifiers excluded)
router.get( '/sms/thank-you/:event_id',            requireManager, getThankYouInfo);
router.put( '/sms/thank-you/:event_id',            requireManager, saveThankYouTemplate);
router.post('/sms/thank-you/send/:invitation_id',  requireManager, sendThankYouSingle);
router.post('/sms/thank-you/bulk/:event_id',       requireManager, sendThankYouBulk);

// ── Static — generated card images ─────────────────────────────────────────
router.get('/generated/:filename', (req, res) => {
  const file = path.join(__dirname, '..', 'generated', req.params.filename);
  res.sendFile(file, (err) => {
    if (err) res.status(404).json({ success: false, message: 'File not found.' });
  });
});

module.exports = router;
