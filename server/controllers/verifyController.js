const pool = require('../config/db');

async function verifyInvitation(req, res) {
  const { code } = req.body;

  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: 'Code is required.', type: 'error' });
  }

  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.execute(
      `SELECT id, code, guest_name, status
         FROM invitations
        WHERE code = ?
        LIMIT 1`,
      [code.trim().toUpperCase()]
    );

    if (rows.length === 0) {
      return res.json({
        success: false,
        type:    'invalid',
        message: 'Invalid Code – this invitation does not exist.',
      });
    }

    const inv = rows[0];

    if (inv.status === 'used') {
      return res.json({
        success: false,
        type:    'used',
        message: 'Already Scanned – this invitation has already been used.',
        name:    inv.guest_name,
        code:    inv.code,
      });
    }

    // Mark as used
    await connection.execute(
      `UPDATE invitations
          SET status = 'used', used_at = NOW()
        WHERE id = ?`,
      [inv.id]
    );

    res.json({
      success: true,
      type:    'valid',
      message: 'Valid Invitation',
      name:    inv.guest_name,
      code:    inv.code,
    });

  } catch (err) {
    console.error('[verifyInvitation]', err);
    res.status(500).json({ success: false, type: 'error', message: 'Verification failed.' });
  } finally {
    connection.release();
  }
}

module.exports = { verifyInvitation };
