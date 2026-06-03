const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const pool                        = require('../config/db');
const { uploadBuffer }            = require('../config/cloudinary');
const { getNextCode }             = require('../utils/codeGenerator');
const { generateStyledQRBuffer }  = require('../utils/qrGenerator');
const { processCardImage }        = require('../utils/imageProcessor');

// Ensure the generated/ folder exists at server startup
const GENERATED_DIR = path.join(__dirname, '..', 'generated');
if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

// ── generateCard ──────────────────────────────────────────────────────────────

async function generateCard(req, res) {
  // Validation
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Card image is required.' });
  }

  const guestName = (req.body.guest_name || '').trim();
  const language  = (req.body.language   || 'english').trim();

  if (!guestName) {
    return res.status(400).json({ success: false, message: 'Guest name is required.' });
  }
  if (guestName.length > 100) {
    return res.status(400).json({ success: false, message: 'Guest name must be 100 characters or fewer.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1 — Reserve a unique code inside the transaction (FOR UPDATE prevents races)
    const code = await getNextCode(connection);

    // 2 — Insert the row immediately so the code is locked in DB
    const uuid = crypto.randomUUID();
    await connection.execute(
      `INSERT INTO invitations (code, guest_name, status, invitation_uuid)
       VALUES (?, ?, 'unused', ?)`,
      [code, guestName, uuid]
    );

    // 3 — Upload original card to Cloudinary
    const originalUpload = await uploadBuffer(req.file.buffer, {
      public_id:     `wedding-qr/originals/original_${code}`,
      resource_type: 'image',
      overwrite:     true,
      quality:       'auto:best',
    });

    // 4 — Generate styled QR code as PNG buffer
    const qrData   = JSON.stringify({ code, name: guestName });
    const qrBuffer = await generateStyledQRBuffer(qrData, 400);

    // 5 — Overlay QR + text onto the card image
    const finalBuffer = await processCardImage(req.file.buffer, qrBuffer, guestName, code);

    // 6 — Save final card locally for static serving
    const localFile = path.join(GENERATED_DIR, `${code}.png`);
    fs.writeFileSync(localFile, finalBuffer);

    // 7 — Upload final card to Cloudinary
    const finalUpload = await uploadBuffer(finalBuffer, {
      public_id:     `wedding-qr/generated/card_${code}`,
      resource_type: 'image',
      overwrite:     true,
      quality:       'auto:best',
    });

    // 8 — Persist image URL in DB
    await connection.execute(
      `UPDATE invitations SET image_url = ? WHERE code = ?`,
      [finalUpload.secure_url, code]
    );

    await connection.commit();

    console.log(`[generateCard] Created: ${code} for "${guestName}"`);

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
      'SELECT id, code, guest_name, status, used_at, event_id FROM invitations WHERE code = ? LIMIT 1',
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
  const guestName = (req.body.guest_name || '').trim();
  const eventId   = req.body.event_id ? parseInt(req.body.event_id, 10) : null;

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
      `INSERT INTO invitations (code, guest_name, status, event_id, invitation_uuid) VALUES (?, ?, 'unused', ?, ?)`,
      [code, guestName, eventId, uuid]
    );
    await connection.commit();
    console.log(`[reserveCode] Reserved: ${code} (${uuid}) for "${guestName}"${eventId ? ` event=${eventId}` : ''}`);
    return res.status(201).json({ success: true, code, invitation_uuid: uuid, guest_name: guestName, event_id: eventId });
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
      'SELECT id, code, guest_name, status, used_at, event_id FROM invitations WHERE code = ? LIMIT 1',
      [code]
    );

    if (rows.length === 0) {
      return res.status(200).json({ success: false, type: 'invalid', message: 'Invalid invitation code.' });
    }

    const inv = rows[0];

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

module.exports = { generateCard, verifyCode, getStats, deleteInvitation, deleteAllInvitations, reserveCode, verifyManual };
