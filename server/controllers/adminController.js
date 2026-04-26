const pool = require('../config/db');

async function getDashboard(req, res) {
  const connection = await pool.getConnection();

  try {
    const [[{ total }]]  = await connection.execute('SELECT COUNT(*) AS total FROM invitations');
    const [[{ used }]]   = await connection.execute("SELECT COUNT(*) AS used  FROM invitations WHERE status = 'used'");
    const [[{ unused }]] = await connection.execute("SELECT COUNT(*) AS unused FROM invitations WHERE status = 'unused'");

    const [recent] = await connection.execute(
      `SELECT code, guest_name, status, image_url, created_at, used_at
         FROM invitations
        ORDER BY created_at DESC
        LIMIT 50`
    );

    res.json({
      success: true,
      stats:   { total, used, unused },
      recent,
    });

  } catch (err) {
    console.error('[getDashboard]', err);
    res.status(500).json({ success: false, message: 'Failed to load dashboard.' });
  } finally {
    connection.release();
  }
}

module.exports = { getDashboard };
