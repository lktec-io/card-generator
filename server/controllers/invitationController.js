const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const pool                        = require('../config/db');
const { uploadBuffer }            = require('../config/cloudinary');
const { getNextCode }             = require('../utils/codeGenerator');
const { generateStyledQRBuffer }  = require('../utils/qrGenerator');
const { processCardImage }        = require('../utils/imageProcessor');
const { eventScopeSQL }           = require('../middleware/authMiddleware');

// Ensure the generated/ folder exists at server startup
const GENERATED_DIR = path.join(__dirname, '..', 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// ── In-memory QR cache (avoids regenerating the same QR on the download step) ──
const _qrCache = new Map();
const QR_CACHE_TTL = 300_000; // 5 minutes

function _getQR(key) {
  const e = _qrCache.get(key);
  if (!e) return null;
  if (Date.now() - e.t > QR_CACHE_TTL) { _qrCache.delete(key); return null; }
  return e.b;
}

function _setQR(key, buf) {
  _qrCache.set(key, { b: buf, t: Date.now() });
  if (_qrCache.size > 200) {
    const cutoff = Date.now() - QR_CACHE_TTL;
    for (const [k, v] of _qrCache) { if (v.t < cutoff) _qrCache.delete(k); }
  }
}

// ── generateCard ──────────────────────────────────────────────────────────────

async function generateCard(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Card image is required.' });
  }

  const guestName = (req.body.guest_name || '').trim();
  if (!guestName) {
    return res.status(400).json({ success: false, message: 'Guest name is required.' });
  }
  if (guestName.length > 100) {
    return res.status(400).json({ success: false, message: 'Guest name must be 100 characters or fewer.' });
  }

  // Optional fields
  const phone   = (req.body.phone_number || '').trim() || null;
  const eventId = req.body.event_id ? parseInt(req.body.event_id, 10) || null : null;

  // Text appearance
  const nameColor      = (req.body.name_color      || '#111111').trim();
  const cnColor        = (req.body.cn_color        || '#222222').trim();
  // Font sizes are ABSOLUTE OUTPUT PIXELS (user-selected, no server-side scaling)
  const nameFontSizeRaw = parseInt(req.body.name_font_size, 10);
  const nameFontSize   = Number.isFinite(nameFontSizeRaw) && nameFontSizeRaw > 0
    ? nameFontSizeRaw : 150;
  const cnFontSizeRaw  = parseInt(req.body.cn_font_size, 10);
  const cnFontSize     = Number.isFinite(cnFontSizeRaw) && cnFontSizeRaw > 0
    ? cnFontSizeRaw : 100;
  const nameFontWeight = ['normal', '700', 'bold'].includes(req.body.name_font_weight)
    ? req.body.name_font_weight : '700';
  const nameTextAlign  = ['left', 'center', 'right'].includes(req.body.name_text_align)
    ? req.body.name_text_align : 'center';

  // Visibility toggles
  const skipQR = req.body.show_qr === '0' || req.body.show_qr === 'false';
  const skipCN = req.body.show_cn === '0' || req.body.show_cn === 'false';

  const skipType = req.body.show_type === '0' || req.body.show_type === 'false';

  // Card type — Single / Double (whitelisted; anything else falls back to single)
  const cardType = ['single', 'double'].includes(req.body.card_type)
    ? req.body.card_type : 'single';
  const typeColor = (req.body.type_color || '#444444').trim();
  const typeFontSizeRaw = parseInt(req.body.type_font_size, 10);
  const typeFontSize = Number.isFinite(typeFontSizeRaw) && typeFontSizeRaw > 0
    ? typeFontSizeRaw : 70;

  // Drag-and-drop positions (all in 1080px canvas space)
  const parseNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const posNameX  = parseNum(req.body.pos_name_x);
  const posNameY  = parseNum(req.body.pos_name_y);
  const posCodeX  = parseNum(req.body.pos_code_x);
  const posCodeY  = parseNum(req.body.pos_code_y);
  const posQrLeft = parseNum(req.body.pos_qr_left);
  const posQrTop  = parseNum(req.body.pos_qr_top);
  const posTypeX  = parseNum(req.body.pos_type_x);
  const posTypeY  = parseNum(req.body.pos_type_y);
  const hasPositions = posNameY != null;
  const positions = hasPositions
    ? { nameX: posNameX, nameY: posNameY, codeX: posCodeX, codeY: posCodeY,
        qrLeft: posQrLeft, qrTop: posQrTop, typeX: posTypeX, typeY: posTypeY }
    : null;

  const connection = await pool.getConnection();
  const t0 = Date.now();
  let code, uuid, finalBuffer;

  try {
    await connection.beginTransaction();

    // 1 — Fetch event for contact info (if event_id provided)
    let event = null;
    if (eventId) {
      const [[ev]] = await connection.execute('SELECT * FROM events WHERE id = ?', [eventId]);
      event = ev || null;
    }

    // 2 — Reserve a unique code
    code = await getNextCode(connection);
    uuid = crypto.randomUUID();

    // 3 — Insert invitation row
    await connection.execute(
      `INSERT INTO invitations
         (code, guest_name, card_type, phone_number, status, event_id, invitation_uuid)
       VALUES (?, ?, ?, ?, 'unused', ?, ?)`,
      [code, guestName, cardType, phone, eventId, uuid]
    );

    // 4 — Generate QR buffer (400px is enough quality; smaller = faster PNG encode)
    console.time(`[timer:${code}] qr-generate`);
    // Encode the bare code — same payload as the Public Invitation / RSVP QR.
    // Keeps the module grid small (v1) so the printed QR stays large & sharp.
    const qrData   = code;
    let qrBuffer   = _getQR(qrData);
    if (!qrBuffer) { qrBuffer = await generateStyledQRBuffer(qrData, 400); _setQR(qrData, qrBuffer); }
    console.timeEnd(`[timer:${code}] qr-generate`);

    // 5 — Overlay QR + text onto card image
    const naturalW = parseInt(req.body.natural_w, 10) || 0;
    const naturalH = parseInt(req.body.natural_h, 10) || 0;
    console.time(`[timer:${code}] processCardImage`);
    const isContribution = event?.event_mode === 'contribution';
    finalBuffer = await processCardImage(req.file.buffer, qrBuffer, guestName, code, {
      isContribution, skipQR, skipCN, skipType, cardType,
      nameColor, cnColor, typeColor,
      nameFontSize, cnFontSize, typeFontSize, nameFontWeight, nameTextAlign,
      contactName:  event?.contact_name  || null,
      contactPhone: event?.contact_phone || null,
      positions, naturalW, naturalH,
    });
    console.timeEnd(`[timer:${code}] processCardImage`);

    // 6 — Save locally
    const localFile = path.join(GENERATED_DIR, `${code}.png`);
    fs.writeFileSync(localFile, finalBuffer);

    // 7 — Commit with local URL; background job will update to Cloudinary URL
    await connection.execute(
      `UPDATE invitations SET image_url = ? WHERE code = ?`,
      [`/generated/${code}.png`, code]
    );
    await connection.commit();

  } catch (err) {
    await connection.rollback().catch(() => {});
    connection.release();
    const msg = err?.message || String(err);
    console.error('[generateCard] ERROR:', msg, '\n', err?.stack || '');
    const userMsg = msg.includes('Input image exceeds pixel limit')
      ? 'Image is too large. Please reduce the image size and try again.'
      : msg.includes('ECONNRESET') || msg.includes('timeout')
        ? 'Upload timed out. Please check your internet connection and try again.'
        : 'Failed to generate invitation. Please try again.';
    return res.status(500).json({ success: false, message: userMsg });
  }

  // Release AFTER successful commit
  connection.release();
  console.log(`[generateCard] ${code} ready in ${Date.now() - t0}ms → sending response`);

  // ── Return immediately — user does not wait for Cloudinary ─────────────────
  res.status(201).json({
    success:         true,
    message:         'Card generated successfully.',
    code,
    invitation_uuid: uuid,
    guest_name:      guestName,
    card_type:       cardType,
    image_url:       `/generated/${code}.png`,
    local_url:       `/generated/${code}.png`,
  });

  // ── Background: upload to Cloudinary + update DB (non-blocking) ────────────
  setImmediate(async () => {
    try {
      console.time(`[bg:${code}] cloudinary`);
      const finalUpload = await uploadBuffer(finalBuffer, {
        public_id:     `wedding-qr/generated/card_${code}`,
        resource_type: 'image',
        overwrite:     true,
        quality:       'auto:best',
      });
      console.timeEnd(`[bg:${code}] cloudinary`);
      await pool.execute(
        `UPDATE invitations SET image_url = ? WHERE code = ?`,
        [finalUpload.secure_url, code]
      );
      console.log(`[bg:${code}] Cloudinary synced: ${finalUpload.secure_url}`);
    } catch (err) {
      console.error(`[bg:${code}] Cloudinary upload failed:`, err.message);
    }
  });
}

// ── verifyCode ────────────────────────────────────────────────────────────────

async function verifyCode(req, res) {
  const code = (req.body.code || '').trim().toUpperCase();

  if (!code) {
    return res.status(400).json({ success: false, message: 'Code is required.' });
  }

  // Validate format
  if (!/^CN-\d{3,}$/.test(code)) {
    return res.status(200).json({
      success: false,
      type:    'invalid',
      message: 'Invalid Code — unrecognised format.',
    });
  }

  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(
      `SELECT i.id, i.code, i.guest_name, i.status, i.used_at, i.event_id, e.event_mode
         FROM invitations i
         LEFT JOIN events e ON e.id = i.event_id
        WHERE i.code = ? LIMIT 1`,
      [code]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: false,
        type:    'invalid',
        message: 'Invalid Code — not found in system.',
      });
    }

    const inv = rows[0];

    // If a scoped user is logged in, ensure the code belongs to one of their events
    if (req.user && req.user.role !== 'super_admin' && inv.event_id) {
      const scope = eventScopeSQL(req.user);
      if (scope.where) {
        const [[eventCheck]] = await connection.execute(
          `SELECT id FROM events e WHERE e.id = ? ${scope.where}`,
          [inv.event_id, ...scope.params]
        );
        if (!eventCheck) {
          return res.status(200).json({
            success: false,
            type:    'unauthorized',
            message: 'Hauna ruhusa kuverify event hii.',
          });
        }
      }
    }

    if (inv.status === 'used') {
      return res.status(200).json({
        success: false,
        type:    'used',
        message: 'Already used — this invitation was already scanned.',
        name:    inv.guest_name,
        used_at: inv.used_at,
      });
    }

    // Mark as used
    await connection.execute(
      "UPDATE invitations SET status = 'used', used_at = NOW() WHERE id = ?",
      [inv.id]
    );

    // Log verification
    await connection.execute(
      `INSERT INTO verification_logs (event_id, invitation_id, verification_method, verified_by)
       VALUES (?, ?, 'QR', 'Staff')`,
      [inv.event_id || null, inv.id]
    ).catch(() => {});

    return res.status(200).json({
      success: true,
      type:    'valid',
      message: 'Valid Invitation',
      name:    inv.guest_name,
      code:    inv.code,
    });

  } catch (err) {
    console.error('[verifyCode]', err);
    return res.status(500).json({ success: false, type: 'error', message: 'Verification failed.' });
  } finally {
    connection.release();
  }
}

// ── getStats ──────────────────────────────────────────────────────────────────

async function getStats(req, res) {
  const connection = await pool.getConnection();

  try {
    const [[row]] = await connection.execute(
      `SELECT
         COUNT(*)                              AS total,
         SUM(status = 'used')                  AS used,
         SUM(status = 'unused')                AS unused
       FROM invitations`
    );

    return res.status(200).json({
      total:  Number(row.total)  || 0,
      used:   Number(row.used)   || 0,
      unused: Number(row.unused) || 0,
    });

  } catch (err) {
    console.error('[getStats]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats.' });
  } finally {
    connection.release();
  }
}

// ── reserveCode ───────────────────────────────────────────────────────────────
// Lightweight endpoint: no image upload — just reserves a CN code and returns it.
// Frontend renders the card with html2canvas and downloads directly.

async function reserveCode(req, res) {
  const guestName   = (req.body.guest_name   || '').trim();
  const phoneNumber = (req.body.phone_number || '').trim() || null;
  const eventId     = req.body.event_id ? parseInt(req.body.event_id, 10) : null;

  if (!guestName) {
    return res.status(400).json({ success: false, message: 'Guest name is required.' });
  }
  if (guestName.length > 100) {
    return res.status(400).json({ success: false, message: 'Guest name must be 100 characters or fewer.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const code = await getNextCode(connection);
    const uuid = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO invitations (code, guest_name, phone_number, status, event_id, invitation_uuid) VALUES (?, ?, ?, 'unused', ?, ?)`,
      [code, guestName, phoneNumber, eventId, uuid]
    );
    await connection.commit();
    console.log(`[reserveCode] Reserved: ${code} (${uuid}) for "${guestName}"${eventId ? ` event=${eventId}` : ''}`);
    return res.status(201).json({ success: true, code, invitation_uuid: uuid, guest_name: guestName, phone_number: phoneNumber, event_id: eventId });
  } catch (err) {
    await connection.rollback();
    console.error('[reserveCode]', err);
    return res.status(500).json({ success: false, message: 'Failed to reserve invitation code.' });
  } finally {
    connection.release();
  }
}

// ── deleteAllInvitations ──────────────────────────────────────────────────────

async function deleteAllInvitations(req, res) {
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.execute('DELETE FROM invitations');
    console.log(`[deleteAllInvitations] Deleted ${result.affectedRows} rows`);
    return res.status(200).json({ success: true, message: `Deleted ${result.affectedRows} invitation(s).` });
  } catch (err) {
    console.error('[deleteAllInvitations]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete all invitations.' });
  } finally {
    connection.release();
  }
}

// ── deleteInvitation ──────────────────────────────────────────────────────────

async function deleteInvitation(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: 'Invalid invitation ID.' });
  }

  const connection = await pool.getConnection();
  try {
    const [result] = await connection.execute(
      'DELETE FROM invitations WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }
    console.log(`[deleteInvitation] Deleted id=${id}`);
    return res.status(200).json({ success: true, message: 'Invitation deleted.' });
  } catch (err) {
    console.error('[deleteInvitation]', err);
    return res.status(500).json({ success: false, message: 'Failed to delete invitation.' });
  } finally {
    connection.release();
  }
}

// ── verifyManual ──────────────────────────────────────────────────────────
// Staff manually types a CN code for guests without smartphones.
// Reuses the same status/used_at columns as QR verification.

async function verifyManual(req, res) {
  const code = (req.body.invitation_code || '').trim().toUpperCase();

  if (!code) {
    return res.status(400).json({ success: false, message: 'Invitation code is required.' });
  }
  if (!/^CN-\d{3,}$/.test(code)) {
    return res.status(200).json({ success: false, type: 'invalid', message: 'Invalid invitation code.' });
  }

  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      `SELECT i.id, i.code, i.guest_name, i.status, i.used_at, i.event_id, e.event_mode
         FROM invitations i
         LEFT JOIN events e ON e.id = i.event_id
        WHERE i.code = ? LIMIT 1`,
      [code]
    );

    if (rows.length === 0) {
      return res.status(200).json({ success: false, type: 'invalid', message: 'Invalid invitation code.' });
    }

    const inv = rows[0];

    if (inv.event_mode === 'contribution') {
      return res.status(200).json({
        success: false,
        type:    'not_applicable',
        message: 'This code belongs to a Contribution Campaign — check-in is not applicable here.',
        name:    inv.guest_name,
      });
    }

    // If a scoped user is logged in, ensure the code belongs to one of their events
    if (req.user && req.user.role !== 'super_admin' && inv.event_id) {
      const scope = eventScopeSQL(req.user);
      if (scope.where) {
        const [[eventCheck]] = await connection.execute(
          `SELECT id FROM events e WHERE e.id = ? ${scope.where}`,
          [inv.event_id, ...scope.params]
        );
        if (!eventCheck) {
          return res.status(200).json({
            success: false,
            type:    'unauthorized',
            message: 'Hauna ruhusa kuverify event hii.',
          });
        }
      }
    }

    if (inv.status === 'used') {
      return res.status(200).json({
        success: false,
        type:    'used',
        message: 'Invitation already used.',
        name:    inv.guest_name,
        used_at: inv.used_at,
      });
    }

    await connection.execute(
      "UPDATE invitations SET status = 'used', used_at = NOW() WHERE id = ?",
      [inv.id]
    );

    // Log verification
    await connection.execute(
      `INSERT INTO verification_logs (event_id, invitation_id, verification_method, verified_by)
       VALUES (?, ?, 'CN', 'Staff')`,
      [inv.event_id || null, inv.id]
    ).catch(() => {});

    console.log(`[verifyManual] Checked in: ${code} — "${inv.guest_name}"`);

    return res.status(200).json({
      success:         true,
      type:            'valid',
      message:         'Guest verified successfully.',
      name:            inv.guest_name,
      invitation_code: inv.code,
    });

  } catch (err) {
    console.error('[verifyManual]', err);
    return res.status(500).json({ success: false, type: 'error', message: 'Verification failed.' });
  } finally {
    connection.release();
  }
}

// ── bulkImport ────────────────────────────────────────────────────────────────
// POST /import  — create multiple invitations from uploaded guest list

async function bulkImport(req, res) {
  const guests  = req.body.guests;
  const eventId = req.body.event_id ? parseInt(req.body.event_id, 10) : null;

  if (!Array.isArray(guests) || guests.length === 0) {
    return res.status(400).json({ success: false, message: 'Guest list is required.' });
  }
  if (guests.length > 500) {
    return res.status(400).json({ success: false, message: 'Maximum 500 guests per import.' });
  }

  const created = [];
  const errors  = [];

  for (const g of guests) {
    const name  = (g.guest_name   || '').trim();
    const phone = (g.phone_number || '').trim() || null;
    if (!name) { errors.push({ input: g, error: 'Name is required' }); continue; }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const code = await getNextCode(connection);
      const uuid = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO invitations (code, guest_name, phone_number, status, event_id, invitation_uuid) VALUES (?, ?, ?, 'unused', ?, ?)`,
        [code, name, phone, eventId, uuid]
      );
      await connection.commit();
      created.push({ code, guest_name: name, phone_number: phone, invitation_uuid: uuid });
    } catch (err) {
      await connection.rollback();
      errors.push({ input: g, error: err.message });
    } finally {
      connection.release();
    }
  }

  console.log(`[bulkImport] Created ${created.length}, errors ${errors.length}`);
  return res.status(201).json({ success: true, created, errors });
}

// ── trackShare ────────────────────────────────────────────────────────────────
// POST /invitations/:id/share — records that a card was shared (powers the
// "Total Shared" Contribution Dashboard metric). Idempotent-ish: just stamps now().

async function trackShare(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: 'Invalid invitation ID.' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE invitations SET shared_at = NOW() WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[trackShare]', err);
    return res.status(500).json({ success: false, message: 'Failed to record share.' });
  }
}

// ── renderCard ────────────────────────────────────────────────────────────────
// Composites image + text + QR at given positions; returns PNG buffer directly.
// No DB writes, no Cloudinary — pure render used for the download step.

async function renderCard(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Card image is required.' });
  }

  const code      = (req.body.code       || '').trim();
  const guestName = (req.body.guest_name || '').trim();
  if (!code || !guestName) {
    return res.status(400).json({ success: false, message: 'code and guest_name are required.' });
  }

  const nameColor      = (req.body.name_color || '#111111').trim();
  const cnColor        = (req.body.cn_color   || '#222222').trim();
  const nameFontSizeRaw = parseInt(req.body.name_font_size, 10);
  const nameFontSize   = Number.isFinite(nameFontSizeRaw) && nameFontSizeRaw > 0
    ? nameFontSizeRaw : 150;
  const cnFontSizeRaw  = parseInt(req.body.cn_font_size, 10);
  const cnFontSize     = Number.isFinite(cnFontSizeRaw) && cnFontSizeRaw > 0
    ? cnFontSizeRaw : 100;
  const nameFontWeight = ['normal', '700', 'bold'].includes(req.body.name_font_weight)
    ? req.body.name_font_weight : '700';

  const contactName  = (req.body.contact_name  || '').trim() || null;
  const contactPhone = (req.body.contact_phone || '').trim() || null;

  const skipQR   = req.body.show_qr   === '0' || req.body.show_qr   === 'false';
  const skipCN   = req.body.show_cn   === '0' || req.body.show_cn   === 'false';
  const skipType = req.body.show_type === '0' || req.body.show_type === 'false';

  const cardType = ['single', 'double'].includes(req.body.card_type)
    ? req.body.card_type : 'single';
  const typeColor = (req.body.type_color || '#444444').trim();
  const typeFontSizeRaw = parseInt(req.body.type_font_size, 10);
  const typeFontSize = Number.isFinite(typeFontSizeRaw) && typeFontSizeRaw > 0
    ? typeFontSizeRaw : 70;

  const parseNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const posNameX  = parseNum(req.body.pos_name_x);
  const posNameY  = parseNum(req.body.pos_name_y);
  const posCodeX  = parseNum(req.body.pos_code_x);
  const posCodeY  = parseNum(req.body.pos_code_y);
  const posQrLeft = parseNum(req.body.pos_qr_left);
  const posQrTop  = parseNum(req.body.pos_qr_top);
  const posTypeX  = parseNum(req.body.pos_type_x);
  const posTypeY  = parseNum(req.body.pos_type_y);
  const positions = posNameY != null
    ? { nameX: posNameX, nameY: posNameY, codeX: posCodeX, codeY: posCodeY,
        qrLeft: posQrLeft, qrTop: posQrTop, typeX: posTypeX, typeY: posTypeY }
    : null;

  const naturalW = parseInt(req.body.natural_w, 10) || 0;
  const naturalH = parseInt(req.body.natural_h, 10) || 0;

  try {
    const qrData  = code;   // same payload as the Public Invitation / RSVP QR
    // Reuse cached QR from the generate step; regenerate only if cache missed
    let qrBuffer  = _getQR(qrData);
    if (!qrBuffer) { qrBuffer = await generateStyledQRBuffer(qrData, 400); _setQR(qrData, qrBuffer); }

    const finalBuffer = await processCardImage(req.file.buffer, qrBuffer, guestName, code, {
      skipQR, skipCN, skipType, cardType,
      nameColor, cnColor, typeColor,
      nameFontSize, cnFontSize, typeFontSize, nameFontWeight,
      contactName, contactPhone,
      positions, naturalW, naturalH,
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.png"`);
    return res.send(finalBuffer);

  } catch (err) {
    console.error('[renderCard]', err);
    return res.status(500).json({ success: false, message: 'Render failed. Please try again.' });
  }
}

module.exports = {
  generateCard, renderCard, verifyCode, getStats, deleteInvitation, deleteAllInvitations,
  reserveCode, verifyManual, bulkImport, trackShare,
};
