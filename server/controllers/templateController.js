const pool             = require('../config/db');
const { uploadBuffer } = require('../config/cloudinary');

const CONTRIBUTION_CATEGORIES = [
  'Graduation Fundraising', 'Wedding Contributions', 'Church Building Fund',
  'Mission Project', 'Choir Uniform Fund', 'General Fundraiser',
];

// Sensible starting layout for a freshly-uploaded contribution template —
// admin drags these into place; QR is optional so it starts hidden.
const DEFAULT_CONTRIBUTION_LAYOUT = {
  guestName: { x: 90,  y: 700, visible: true },
  cn:        { x: 90,  y: 800, visible: true },
  amount:    { x: 90,  y: 870, visible: true },
  qr:        { x: 800, y: 700, visible: false },
};

function sanitize(v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; }

// GET /templates  — list all active templates (optionally filtered by ?type=)
async function listTemplates(req, res) {
  const type = ['invitation', 'contribution'].includes(req.query.type) ? req.query.type : null;
  try {
    const [templates] = await pool.execute(
      `SELECT id, name, slug, category, template_type, description,
              thumbnail_url, background_image, layout_config,
              is_active, is_premium, sort_order
         FROM templates
        WHERE is_active = 1 ${type ? 'AND template_type = ?' : ''}
        ORDER BY sort_order ASC, name ASC`,
      type ? [type] : []
    );
    res.json({ success: true, templates });
  } catch (err) {
    console.error('[listTemplates]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch templates.' });
  }
}

// GET /templates/all  — admin: list all (including inactive), with usage counts
async function listAllTemplates(req, res) {
  const type = ['invitation', 'contribution'].includes(req.query.type) ? req.query.type : null;
  try {
    const [templates] = await pool.execute(
      `SELECT t.*, COUNT(DISTINCT e.id) AS usage_count
         FROM templates t
         LEFT JOIN events e ON e.template_id = t.id
        ${type ? 'WHERE t.template_type = ?' : ''}
        GROUP BY t.id
        ORDER BY t.sort_order ASC, t.name ASC`,
      type ? [type] : []
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

// POST /templates/contribution  — admin: upload a new image-based contribution template
// multipart/form-data: name, category, background (file, required), thumbnail (file, optional)
async function createContributionTemplate(req, res) {
  const name     = sanitize(req.body.name);
  const category = CONTRIBUTION_CATEGORIES.includes(req.body.category)
    ? req.body.category
    : 'General Fundraiser';

  const backgroundFile = req.files?.background?.[0];
  const thumbnailFile  = req.files?.thumbnail?.[0];

  if (!name) {
    return res.status(400).json({ success: false, message: 'Template name is required.' });
  }
  if (!backgroundFile) {
    return res.status(400).json({ success: false, message: 'A background image is required.' });
  }

  try {
    const slugBase = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const slug     = `${slugBase || 'contribution'}-${Date.now().toString(36)}`;

    const bgUpload = await uploadBuffer(backgroundFile.buffer, {
      public_id:     `wedding-qr/templates/contribution_bg_${slug}`,
      resource_type: 'image',
      overwrite:     true,
      quality:       'auto:best',
    });

    let thumbnailUrl = bgUpload.secure_url;
    if (thumbnailFile) {
      const thumbUpload = await uploadBuffer(thumbnailFile.buffer, {
        public_id:     `wedding-qr/templates/contribution_thumb_${slug}`,
        resource_type: 'image',
        overwrite:     true,
        quality:       'auto:good',
      });
      thumbnailUrl = thumbUpload.secure_url;
    }

    const [result] = await pool.execute(
      `INSERT INTO templates
         (name, slug, category, template_type, thumbnail_url, background_image, layout_config, is_active)
       VALUES (?, ?, ?, 'contribution', ?, ?, ?, 1)`,
      [name, slug, category, thumbnailUrl, bgUpload.secure_url, JSON.stringify(DEFAULT_CONTRIBUTION_LAYOUT)]
    );

    const [[template]] = await pool.execute('SELECT * FROM templates WHERE id = ?', [result.insertId]);
    console.log(`[createContributionTemplate] "${template.name}" id=${template.id}`);
    res.status(201).json({ success: true, template });
  } catch (err) {
    console.error('[createContributionTemplate]', err);
    res.status(500).json({ success: false, message: 'Failed to create template.' });
  }
}

// PATCH /templates/:id/layout  — admin: save drag-and-drop element positions
async function updateTemplateLayout(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid template ID.' });

  const layout = req.body.layout_config;
  if (!layout || typeof layout !== 'object') {
    return res.status(400).json({ success: false, message: 'layout_config is required.' });
  }

  try {
    await pool.execute(
      'UPDATE templates SET layout_config = ? WHERE id = ?',
      [JSON.stringify(layout), id]
    );
    const [[template]] = await pool.execute('SELECT * FROM templates WHERE id = ?', [id]);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, template });
  } catch (err) {
    console.error('[updateTemplateLayout]', err);
    res.status(500).json({ success: false, message: 'Failed to save layout.' });
  }
}

module.exports = {
  listTemplates, listAllTemplates, toggleTemplate,
  createContributionTemplate, updateTemplateLayout,
  CONTRIBUTION_CATEGORIES,
};
