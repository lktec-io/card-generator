'use strict';

/**
 * Bulk card generation — the Import module's second workflow.
 *
 *   Select event → upload spreadsheet → validate → position the layout once →
 *   generate every card → live progress → summary
 *
 * This is a SEPARATE path from the single-card workflow in
 * invitationController.generateCard, which is untouched. What it reuses rather
 * than reimplements:
 *
 *   CN codes   utils/codeGenerator.getNextCode        (same sequence, same lock)
 *   QR         utils/qrGenerator.generateStyledQRBuffer (same payload: the bare code)
 *   rendering  utils/imageProcessor.processCardImage  (same compositor, same options)
 *   storage    services/cardStorage.saveCardImageWithToken (VPS, token-named)
 *   type       invitations.card_type                  ('single' | 'double', as the SMS reads it)
 *
 * Two phases, on purpose:
 *
 *   1. every valid guest is INSERTed (code, uuid, name, phone, type, event) in
 *      chunked transactions. Fast, and it either happens or it does not.
 *   2. cards are rendered and saved with limited concurrency, writing image_url
 *      per invitation as each one lands.
 *
 * So a rendering failure leaves a real invitation with a real CN and no image,
 * which is a state the system already understands (reserveCode does the same) —
 * and retrying re-renders THAT invitation instead of creating a second one.
 * That is what makes retry duplicate-free.
 */

const crypto = require('crypto');
const multer = require('multer');

const pool = require('../config/db');
const { getNextCode }            = require('../utils/codeGenerator');
const { generateStyledQRBuffer } = require('../utils/qrGenerator');
const { processCardImage }       = require('../utils/imageProcessor');
const { saveCardImageWithToken } = require('../services/cardStorage');
const { readSpreadsheet }        = require('../utils/xlsxReader');
const { validateGuestRows, MAX_GUESTS } = require('../utils/guestImport');
const { eventScopeSQL } = require('../middleware/authMiddleware');

// ── tuning ──────────────────────────────────────────────────────────────────
// One card at a time, deliberately — measured, not assumed.
//
// Rendering a card is ~700 ms, of which ~620 ms is resvg rasterising text
// SYNCHRONOUSLY (three passes). Synchronous work cannot overlap, so running
// cards in parallel does not make the batch faster — it only makes the event
// loop stall for longer in one go. Measured over 24 cards on an 8-core box:
//
//   concurrency 1 → 770 ms/card,  worst event-loop stall  581 ms
//   concurrency 3 → 801 ms/card,  worst event-loop stall 1263 ms
//   concurrency 4 → 686 ms/card,  worst event-loop stall 1097 ms
//
// So concurrency 1 is the same throughput at half the latency cost to everything
// else the API is doing — which during an event means gate check-in and QR
// verification. Raise BULK_CARD_CONCURRENCY only on a box doing nothing else.
// The pause hands the loop back between cards so queued requests get served.
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.BULK_CARD_CONCURRENCY) || 1));
const PAUSE_MS    = Math.max(0, Number(process.env.BULK_CARD_PAUSE_MS) ?? 20);
const INSERT_CHUNK = 100;   // invitations per transaction in phase 1

const SHEET_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// ── uploads ─────────────────────────────────────────────────────────────────

const SHEET_EXT = /\.(xlsx|csv)$/i;

/**
 * Turn an upload rejection into the JSON shape the rest of the API uses.
 * Without this, multer's error reaches Express's default handler and the browser
 * gets an HTML 500 for something as ordinary as an oversized file.
 */
const wrapUpload = (middleware) => (req, res, next) =>
  middleware(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That file is too large. The card design must be under 10 MB and the spreadsheet under 5 MB.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
        ? 'Unexpected file upload.'
        : err.message || 'Upload failed.';
    return res.status(400).json({ success: false, message });
  });

/** Spreadsheet only — used by the validation step. */
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: SHEET_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (SHEET_EXT.test(file.originalname || '')) cb(null, true);
    else cb(new Error('Upload a .xlsx or .csv file.'));
  },
}).single('sheet');

/**
 * Card template + spreadsheet together — used by the generation step.
 * The sheet is re-read and re-validated server-side, so the set of cards that
 * gets generated is exactly the set the file describes; the browser cannot add,
 * rename or retype a guest between the preview and the run.
 */
const generateUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: IMAGE_MAX_BYTES, files: 2 },
  fileFilter(_req, file, cb) {
    if (file.fieldname === 'image') {
      return ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('The card design must be a JPEG, PNG or WebP image.'));
    }
    if (file.fieldname === 'sheet') {
      return SHEET_EXT.test(file.originalname || '')
        ? cb(null, true)
        : cb(new Error('Upload a .xlsx or .csv file.'));
    }
    cb(new Error('Unexpected file field.'));
  },
}).fields([{ name: 'image', maxCount: 1 }, { name: 'sheet', maxCount: 1 }]);

/** Card template only — used when retrying failed rows. */
const retryUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: IMAGE_MAX_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('The card design must be a JPEG, PNG or WebP image.'));
  },
}).single('image');

// ── job tracker ─────────────────────────────────────────────────────────────
// Same in-memory polling model as the bulk SMS jobs. Progress is only ever
// incremented by work that actually finished — there is no timer anywhere.
const _jobs   = new Map();
const JOB_TTL = 60 * 60 * 1000;   // an hour covers a 500-card run plus review

function pruneJobs() {
  for (const [id, job] of _jobs) {
    if (Date.now() - job.startedAt > JOB_TTL) _jobs.delete(id);
  }
}

function createJob({ eventId, eventName, userId, total, layout }) {
  pruneJobs();
  const id = `bg_${eventId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  _jobs.set(id, {
    id, eventId, eventName, userId,
    total,
    completed: 0,
    generated: 0,
    failed:    0,
    current:   null,
    finished:  false,
    startedAt: Date.now(),
    finishedAt: null,
    failures:  [],      // { row, invitation_id, code, guest_name, phone_number, reason }
    layout,             // reused verbatim on retry
  });
  return _jobs.get(id);
}

// ── layout options ──────────────────────────────────────────────────────────

/**
 * Read the card layout from the request exactly as the single-card endpoints do,
 * so a bulk card and a single card drawn with the same settings come out identical.
 * Positions are in the shared 1080-wide canvas space.
 */
function readLayout(body = {}) {
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const int = (v, fallback) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : fallback; };

  const posNameY = num(body.pos_name_y);
  const positions = posNameY != null ? {
    nameX:  num(body.pos_name_x),
    nameY:  posNameY,
    codeX:  num(body.pos_code_x),
    codeY:  num(body.pos_code_y),
    qrLeft: num(body.pos_qr_left),
    qrTop:  num(body.pos_qr_top),
    typeX:  num(body.pos_type_x),
    typeY:  num(body.pos_type_y),
  } : null;

  return {
    nameColor: (body.name_color || '#111111').trim(),
    cnColor:   (body.cn_color   || '#222222').trim(),
    typeColor: (body.type_color || '#444444').trim(),
    nameFontSize: int(body.name_font_size, 150),
    cnFontSize:   int(body.cn_font_size,   100),
    typeFontSize: int(body.type_font_size,  70),
    nameFontWeight: ['normal', '700', 'bold'].includes(body.name_font_weight) ? body.name_font_weight : '700',
    nameTextAlign:  ['left', 'center', 'right'].includes(body.name_text_align) ? body.name_text_align : 'center',
    skipQR:   body.show_qr   === '0' || body.show_qr   === 'false',
    skipCN:   body.show_cn   === '0' || body.show_cn   === 'false',
    skipType: body.show_type === '0' || body.show_type === 'false',
    naturalW: parseInt(body.natural_w, 10) || 0,
    naturalH: parseInt(body.natural_h, 10) || 0,
    positions,
  };
}

// ── shared helpers ──────────────────────────────────────────────────────────

/** The event, but only if this user is allowed to manage it. */
async function loadScopedEvent(eventId, user) {
  const scope = eventScopeSQL(user);
  const [[event]] = await pool.execute(
    `SELECT e.id, e.event_name, e.event_date, e.event_mode, e.contact_name, e.contact_phone
       FROM events e
      WHERE e.id = ? ${scope.where || ''}`,
    [eventId, ...(scope.params || [])]
  );
  return event || null;
}

function parseSheetFile(file) {
  if (!file || !file.buffer?.length) {
    const err = new Error('No spreadsheet was uploaded.');
    err.status = 400;
    throw err;
  }
  try {
    return readSpreadsheet(file.buffer, file.originalname || '');
  } catch (e) {
    const err = new Error(e.message || 'That file could not be read.');
    err.status = 400;
    throw err;
  }
}

/** Guests already on this event — lets validation flag a file imported twice. */
async function existingGuests(eventId) {
  const [rows] = await pool.execute(
    'SELECT guest_name, phone_number FROM invitations WHERE event_id = ?',
    [eventId]
  );
  return rows;
}

// ── POST /import/validate ───────────────────────────────────────────────────
// Reads the spreadsheet and reports what would be generated. Writes nothing.

async function validateImport(req, res) {
  const eventId = parseInt(req.body.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Select an event first.' });

  try {
    const event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const rows   = parseSheetFile(req.file);
    const result = validateGuestRows(rows, { existing: await existingGuests(eventId) });

    return res.json({
      ...result,
      success: true,
      event:   { id: event.id, event_name: event.event_name, event_date: event.event_date },
      file:    { name: req.file.originalname, rows: rows.length },
      max_guests: MAX_GUESTS,
    });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[validateImport]', err);
    return res.status(status).json({ success: false, message: status === 500 ? 'Could not read that file.' : err.message });
  }
}

// ── POST /import/bulk-generate/:event_id ────────────────────────────────────

async function bulkGenerate(req, res) {
  const eventId = parseInt(req.params.event_id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });
  if (!req.files?.image?.[0]) {
    return res.status(400).json({ success: false, message: 'Upload the card design image.' });
  }

  let event, guests, layout;
  try {
    event = await loadScopedEvent(eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    const rows   = parseSheetFile(req.files?.sheet?.[0]);
    const result = validateGuestRows(rows, { existing: await existingGuests(eventId) });

    // Note the spread comes FIRST in both replies: validateGuestRows returns a
    // `message` key that is undefined on success, and spreading it last would
    // blank out the message being set here.
    if (!result.ok) {
      return res.status(400).json({
        ...result,
        success: false,
        message: result.message || 'No valid guest rows to generate.',
      });
    }
    // The file must be clean before anything is created — a half-valid file is
    // fixed and re-uploaded rather than half-generated.
    if (result.invalid > 0) {
      return res.status(400).json({
        ...result,
        success: false,
        message: result.invalid === 1
          ? '1 row still needs fixing. Correct the file and upload it again.'
          : `${result.invalid} rows still need fixing. Correct the file and upload it again.`,
      });
    }
    guests = result.guests;
    layout = readLayout(req.body);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error('[bulkGenerate] setup', err);
    return res.status(status).json({ success: false, message: status === 500 ? 'Could not start generation.' : err.message });
  }

  // ── phase 1: create the invitations ───────────────────────────────────────
  // Chunked so the code-sequence lock is never held for the whole file.
  const created = [];
  try {
    for (let i = 0; i < guests.length; i += INSERT_CHUNK) {
      const chunk = guests.slice(i, i + INSERT_CHUNK);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        for (const g of chunk) {
          const code = await getNextCode(connection);       // existing CN logic
          const uuid = crypto.randomUUID();
          const [ins] = await connection.execute(
            `INSERT INTO invitations
               (code, guest_name, card_type, phone_number, status, event_id, invitation_uuid)
             VALUES (?, ?, ?, ?, 'unused', ?, ?)`,
            [code, g.guest_name, g.card_type, g.phone_number, eventId, uuid]
          );
          created.push({ ...g, id: ins.insertId, code, invitation_uuid: uuid });
        }
        await connection.commit();
      } catch (err) {
        await connection.rollback().catch(() => {});
        throw err;
      } finally {
        connection.release();
      }
    }
  } catch (err) {
    console.error('[bulkGenerate] invitation insert failed:', err.message);
    return res.status(500).json({
      success: false,
      message: created.length
        ? `Created ${created.length} of ${guests.length} invitations before failing: ${err.message}. The cards were not generated — check the event's guest list before retrying.`
        : `Could not create the invitations: ${err.message}`,
    });
  }

  const job = createJob({
    eventId,
    eventName: event.event_name,
    userId:    req.user?.id ?? null,
    total:     created.length,
    layout,
  });

  // Answer now — the browser follows the job from here.
  res.status(202).json({
    success: true,
    job_id:  job.id,
    total:   created.length,
    event:   { id: event.id, event_name: event.event_name },
    single:  created.filter((g) => g.card_type === 'single').length,
    double:  created.filter((g) => g.card_type === 'double').length,
  });

  const template = req.files.image[0].buffer;
  setImmediate(() => runRenderQueue(job, created, template, layout, event));
}

// ── the rendering queue ─────────────────────────────────────────────────────

/**
 * Render each invitation's card and store it. Shared by the first run and by
 * retries; it only ever UPDATEs existing invitation rows, so it can never
 * create a duplicate guest.
 */
async function runRenderQueue(job, items, templateBuffer, layout, event) {
  const queue = items.slice();
  const isContribution = event?.event_mode === 'contribution';

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      job.current = item.guest_name;

      try {
        const qrBuffer = await generateStyledQRBuffer(item.code, 400);

        const buffer = await processCardImage(templateBuffer, qrBuffer, item.guest_name, item.code, {
          isContribution,
          skipQR:   layout.skipQR,
          skipCN:   layout.skipCN,
          skipType: layout.skipType,
          cardType: item.card_type,                 // per guest, from the file
          nameColor: layout.nameColor,
          cnColor:   layout.cnColor,
          typeColor: layout.typeColor,
          nameFontSize: layout.nameFontSize,
          cnFontSize:   layout.cnFontSize,
          typeFontSize: layout.typeFontSize,
          nameFontWeight: layout.nameFontWeight,
          nameTextAlign:  layout.nameTextAlign,
          contactName:  event?.contact_name  || null,
          contactPhone: event?.contact_phone || null,
          positions: layout.positions,
          naturalW:  layout.naturalW,
          naturalH:  layout.naturalH,
        });

        const stored = saveCardImageWithToken(job.eventId, buffer, 'png');
        await pool.execute('UPDATE invitations SET image_url = ? WHERE id = ?', [stored.url, item.id]);

        job.generated++;
        // Drop the failure record when a retry succeeds
        const at = job.failures.findIndex((f) => f.invitation_id === item.id);
        if (at !== -1) job.failures.splice(at, 1);
      } catch (err) {
        job.failed++;
        if (!job.failures.some((f) => f.invitation_id === item.id)) {
          job.failures.push({
            row:           item.row ?? null,
            invitation_id: item.id,
            code:          item.code,
            guest_name:    item.guest_name,
            phone_number:  item.phone_number,
            reason:        err?.message || 'rendering failed',
          });
        }
        console.error(`[bulkGenerate] ${item.code} (${item.guest_name}) failed: ${err?.message}`);
      } finally {
        job.completed++;
      }

      // Hand the event loop back so the rest of the API stays responsive
      if (PAUSE_MS) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

  job.current    = null;
  job.finished   = true;
  job.finishedAt = Date.now();
  console.log(`[bulkGenerate] job=${job.id} event=${job.eventId} generated=${job.generated} failed=${job.failed} in ${Math.round((job.finishedAt - job.startedAt) / 1000)}s`);
}

// ── GET /import/bulk-generate/progress/:job_id ──────────────────────────────
// Real counters only: completed/generated/failed are incremented by finished work.

function bulkGenerateProgress(req, res) {
  const job = _jobs.get(req.params.job_id);
  if (!job) {
    return res.status(404).json({ success: false, message: 'That generation job has expired. Check the event\'s invitation list for what was created.' });
  }
  // A job belongs to whoever started it (super admins can watch any).
  if (job.userId && req.user?.id !== job.userId && req.user?.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'That job belongs to another user.' });
  }

  res.json({
    success:   true,
    job_id:    job.id,
    event_id:  job.eventId,
    event_name: job.eventName,
    total:     job.total,
    completed: job.completed,
    generated: job.generated,
    failed:    job.failed,
    percent:   job.total ? Math.floor((job.completed / job.total) * 100) : 100,
    current_guest: job.current,
    finished:  job.finished,
    started_at:  job.startedAt,
    finished_at: job.finishedAt,
    failures:  job.failures,
  });
}

// ── POST /import/bulk-generate/retry/:job_id ────────────────────────────────
// Re-renders the cards that failed, for the SAME invitations. No new rows.

async function bulkGenerateRetry(req, res) {
  const job = _jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ success: false, message: 'That generation job has expired. Start a new import for the guests that are missing cards.' });
  if (job.userId && req.user?.id !== job.userId && req.user?.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'That job belongs to another user.' });
  }
  if (!job.finished)   return res.status(409).json({ success: false, message: 'This job is still running.' });
  if (!job.failures.length) return res.status(400).json({ success: false, message: 'Nothing failed in this job.' });
  if (!req.file?.buffer?.length) return res.status(400).json({ success: false, message: 'Upload the same card design image to retry.' });

  try {
    const event = await loadScopedEvent(job.eventId, req.user);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found, or you do not have access to it.' });

    // Re-read the invitations from the database, so a retry works on what is
    // really there rather than on anything the browser sent.
    const ids = job.failures.map((f) => f.invitation_id).filter(Boolean);
    if (!ids.length) return res.status(400).json({ success: false, message: 'No retryable rows in this job.' });

    const [rows] = await pool.query(
      `SELECT id, code, guest_name, phone_number, card_type
         FROM invitations
        WHERE event_id = ? AND id IN (?)`,
      [job.eventId, ids]
    );
    if (!rows.length) return res.status(400).json({ success: false, message: 'Those invitations no longer exist.' });

    const byId   = new Map(job.failures.map((f) => [f.invitation_id, f.row]));
    const items  = rows.map((r) => ({ ...r, row: byId.get(r.id) ?? null }));

    // Count the retry as its own pass over the same job counters
    job.total     = (job.total || 0) + items.length;
    job.failed    = Math.max(0, job.failed - items.length);
    job.finished  = false;
    job.finishedAt = null;

    res.status(202).json({ success: true, job_id: job.id, retrying: items.length });

    const template = req.file.buffer;
    setImmediate(() => runRenderQueue(job, items, template, job.layout, event));
  } catch (err) {
    console.error('[bulkGenerateRetry]', err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Could not start the retry.' });
  }
}

module.exports = {
  sheetUpload:    wrapUpload(sheetUpload),
  generateUpload: wrapUpload(generateUpload),
  retryUpload:    wrapUpload(retryUpload),
  validateImport, bulkGenerate, bulkGenerateProgress, bulkGenerateRetry,
  // exported for tests
  readLayout, CONCURRENCY,
};
