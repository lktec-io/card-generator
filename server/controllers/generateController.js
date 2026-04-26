const multer  = require('multer');
const pool    = require('../config/db');
const { uploadBuffer }           = require('../config/cloudinary');
const { generateStyledQRBuffer } = require('../utils/qrGenerator');
const { overlayQROnCard }        = require('../utils/imageProcessor');

// ── Multer (memory storage – files go straight to Cloudinary) ───────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ── Controller ────────────────────────────────────────────────────────────────

async function generateInvitation(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Card image is required.' });
  }

  const { guest_name, language = 'en' } = req.body;
  const guestName = (guest_name || '').trim();

  if (!guestName) {
    return res.status(400).json({ success: false, message: 'Guest name is required.' });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Insert placeholder row to get an auto-increment ID
    const [ins] = await connection.execute(
      `INSERT INTO invitations (code, guest_name, language, status)
       VALUES ('TEMP', ?, ?, 'unused')`,
      [guestName, language]
    );
    const id   = ins.insertId;
    const code = `CN-${String(id).padStart(3, '0')}`;

    // Update with the real code immediately
    await connection.execute(
      'UPDATE invitations SET code = ? WHERE id = ?',
      [code, id]
    );

    // 2. Upload original card to Cloudinary (async, not blocking main flow)
    const originalUpload = await uploadBuffer(req.file.buffer, {
      public_id:     `original_${code}`,
      resource_type: 'image',
    });

    // 3. Generate styled QR → PNG buffer
    const qrPayload = JSON.stringify({ code, name: guestName });
    const qrBuffer  = await generateStyledQRBuffer(qrPayload, 600);

    // 4. Overlay QR + text on card
    const finalCard = await overlayQROnCard(
      req.file.buffer,
      qrBuffer,
      guestName,
      code
    );

    // 5. Upload final invitation card to Cloudinary
    const finalUpload = await uploadBuffer(finalCard, {
      public_id:     `invitation_${code}`,
      resource_type: 'image',
    });

    // 6. Persist URLs in DB
    await connection.execute(
      `UPDATE invitations
          SET original_image_url = ?, image_url = ?
        WHERE id = ?`,
      [originalUpload.secure_url, finalUpload.secure_url, id]
    );

    await connection.commit();

    res.json({
      success:            true,
      code,
      guest_name:         guestName,
      image_url:          finalUpload.secure_url,
      original_image_url: originalUpload.secure_url,
    });

  } catch (err) {
    await connection.rollback();
    console.error('[generateInvitation]', err);
    res.status(500).json({ success: false, message: 'Failed to generate invitation. Please try again.' });
  } finally {
    connection.release();
  }
}

module.exports = { upload, generateInvitation };
