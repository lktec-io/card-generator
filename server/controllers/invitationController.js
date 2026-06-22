const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const pool                        = require('../config/db');
const { uploadBuffer }            = require('../config/cloudinary');
const { getNextCode }             = require('../utils/codeGenerator');
const { generateStyledQRBuffer }  = require('../utils/qrGenerator');
const { processCardImage }        = require('../utils/imageProcessor');
const { eventScopeSQL }           = require('../middleware/authMiddleware');

const CLIENT_URL = process.env.CLIENT_URL || 'https://wedding.nardio.online';

// Ensure the generated/ folder exists at server startup
const GENERATED_DIR = path.join(__dirname, '..', 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

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
  const phone       = (req.body.phone_number || '').trim() || null;
  const eventId     = req.body.event_id ? parseInt(req.body.event_id, 10) || null : null;
  const nameColor   = (req.body.name_color   || '#111111').trim();
  const cnColor     = (req.body.cn_color     || '#222222').trim();
  const amountColor = (req.body.amount_color || '#222222').trim();

  let requestedAmount = null;
  if (req.body.requested_amount) {
    const parsed = parseFloat(String(req.body.requested_amount).replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) requestedAmount = parsed;
  }

  // Drag-and-drop positions (all in 1080px canvas space, sent as strings from FormData)
  const parseNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const posNameY    = parseNum(req.body.pos_name_y);
  const posCodeY    = parseNum(req.body.pos_code_y);
  const posQrLeft   = parseNum(req.body.pos_qr_left);
  const posQrTop    = parseNum(req.body.pos_qr_top);
  const posAmountY  = parseNum(req.body.pos_amount_y);
  const hasPositions = posNameY != null && posCodeY != null && posQrLeft != null && posQrTop != null;
  const positions = hasPositions
    ? { nameY: posNameY, codeY: posCodeY, qrLeft: posQrLeft, qrTop: posQrTop, amountY: posAmountY }
    : null;

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1 — Fetch event for mode + contact info (if event_id provided)
    let event = null;
    if (eventId) {
      const [[ev]] = await connection.execute('SELECT * FROM events WHERE id = ?', [eventId]);
      event = ev || null;
    }
    const isContribution = event?.event_mode === 'contribution';

    // 2 — Reserve a unique code
    const code = await getNextCode(connection);
    const uuid = crypto.randomUUID();

    // 3 — Insert invitation row
    await connection.execute(
      `INSERT INTO invitations
         (code, guest_name, phone_number, requested_amount, status, event_id, invitation_uuid)
       VALUES (?, ?, ?, ?, 'unused', ?, ?)`,
      [code, guestName, phone, requestedAmount, eventId, uuid]
    );

    // 4 — Upload original card to Cloudinary
    await uploadBuffer(req.file.buffer, {
      public_id:     `wedding-qr/originals/original_${code}`,
      resource_type: 'image',
      overwrite:     true,
      quality:       'auto:best',
    });

    // 5 — Generate styled QR code
    // Contribution: QR encodes the guest's shareable invite link.
    // Invitation:   QR encodes the CN code (scanned at entrance).
    const qrData   = isContribution
      ? `${CLIENT_URL}/invite/${uuid}`
      : JSON.stringify({ code, name: guestName });
    const qrBuffer = await generateStyledQRBuffer(qrData, 400);

    // 6 — Format amount text for card overlay
    let amountText = null;
    if (requestedAmount != null) {
      amountText = `TZS ${requestedAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    }

    // 7 — Overlay QR + text onto card image with colour, amount, and optional drag positions
    const finalBuffer = await processCardImage(req.file.buffer, qrBuffer, guestName, code, {
      nameColor,
      cnColor,
      amountColor,
      amount:       amountText,
      contactName:  event?.contact_name  || null,
      contactPhone: event?.contact_phone || null,
      positions,
    });

    // 8 — Save locally for static serving
    const localFile = path.join(GENERATED_DIR, `${code}.png`);
    fs.writeFileSync(localFile, finalBuffer);

    // 9 — Upload final card to Cloudinary
    const finalUpload = await uploadBuffer(finalBuffer, {
      public_id:     `wedding-qr/generated/card_${code}`,
      resource_type: 'image',
      overwrite:     true,
      quality:       'auto:best',
    });

    // 10 — Persist image URL in DB
    await connection.execute(
      `UPDATE invitations SET image_url = ? WHERE code = ?`,
      [finalUpload.secure_url, code]
    );

    await connection.commit();

    console.log(`[generateCard] Created: ${code} for "${guestName}" (${isContribution ? 'contribution' : 'invitation'})`);

    return res.status(201).json({
      success:         true,
      message:         'Card generated successfully.',
      code,
      invitation_uuid: uuid,
      guest_name:      guestName,
      image_url:       finalUpload.secure_url,
      local_url:       `/generated/${code}.png`,
    });

  } catch (err) {
    await connection.rollback();
    console.error('[generateCard]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate invitation. Please try again.',
    });
  } finally {
    connection.release();
  }
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

    if (inv.event_mode === 'contribution') {
      return res.status(200).json({
        success: false,
        type:    'not_applicable',
        message: 'This code belongs to a Contribution Campaign — QR check-in is not applicable here.',
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

    // Optional contribution amount — accepts numbers or numeric strings (e.g. "50,000")
    let amount = null;
    if (g.requested_amount !== undefined && g.requested_amount !== null && g.requested_amount !== '') {
      const parsed = Number(String(g.requested_amount).replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed >= 0) amount = parsed;
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const code = await getNextCode(connection);
      const uuid = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO invitations (code, guest_name, phone_number, requested_amount, status, event_id, invitation_uuid) VALUES (?, ?, ?, ?, 'unused', ?, ?)`,
        [code, name, phone, amount, eventId, uuid]
      );
      await connection.commit();
      created.push({ code, guest_name: name, phone_number: phone, requested_amount: amount, invitation_uuid: uuid });
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

module.exports = {
  generateCard, verifyCode, getStats, deleteInvitation, deleteAllInvitations,
  reserveCode, verifyManual, bulkImport, trackShare,
};
