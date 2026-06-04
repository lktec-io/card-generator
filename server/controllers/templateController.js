const pool = require('../config/db');

// GET /templates  — list all active templates
async function listTemplates(req, res) {
  try {
    const [templates] = await pool.execute(
      `SELECT id, name, slug, category, description, thumbnail_url, is_active, is_premium, sort_order
         FROM templates
        WHERE is_active = 1
        ORDER BY sort_order ASC, name ASC`
    );
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[listTemplates]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch templates.' });
  }
}

// GET /templates/all  — admin: list all (including inactive)
async function listAllTemplates(req, res) {
  try {
    const [templates] = await pool.execute(
      `SELECT * FROM templates ORDER BY sort_order ASC, name ASC`
    );
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[listAllTemplates]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch templates.' });
  }
}

// PATCH /templates/:id/toggle  — admin: enable/disable
async function toggleTemplate(req, res) {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.execute(
      'UPDATE templates SET is_active = NOT is_active WHERE id = ?',
      [id]
    );
    const [[tmpl]] = await pool.execute('SELECT * FROM templates WHERE id = ?', [id]);
    res.json({ success: true, template: tmpl });
  } catch (err) {
    console.error('[toggleTemplate]', err);
    res.status(500).json({ success: false, message: 'Failed to toggle template.' });
  }
}

module.exports = { listTemplates, listAllTemplates, toggleTemplate };
