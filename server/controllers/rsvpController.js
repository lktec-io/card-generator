const pool = require('../config/db');

// GET /invite/:uuid  — public invitation page data (no auth)
async function getPublicInvite(req, res) {
  const uuid = (req.params.uuid || '').trim();
  if (!uuid) return res.status(400).json({ success: false, message: 'Invalid invitation link.' });

  try {
    const [[inv]] = await pool.execute(
      `SELECT
         i.id, i.code, i.guest_name, i.image_url, i.event_id, i.invitation_uuid,
         r.response AS rsvp_response
       FROM invitations i
       LEFT JOIN rsvp_responses r ON r.invitation_id = i.id
       WHERE i.invitation_uuid = ?
       LIMIT 1`,
      [uuid]
    );

    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found.' });

    let event = null;
    if (inv.event_id) {
      const [[ev]] = await pool.execute(
        `SELECT e.*, t.slug AS template_slug, t.name AS template_name
           FROM events e
           LEFT JOIN templates t ON t.id = e.template_id
          WHERE e.id = ?`,
        [inv.event_id]
      );
      event = ev || null;
    }

    res.json({ success: true, invitation: inv, event });
  } catch (err) {
    console.error('[getPublicInvite]', err);
    res.status(500).json({ success: false, message: 'Failed to load invitation.' });
  }
}

// POST /rsvp/:uuid  — guest submits RSVP (immutable: one response only)
async function submitRSVP(req, res) {
  const uuid     = (req.params.uuid || '').trim();
  const response = (req.body.response || '').trim();

  if (!uuid) return res.status(400).json({ success: false, message: 'Invalid invitation link.' });
  if (!['attending', 'declined'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Response must be "attending" or "declined".' });
  }

  try {
    const [[inv]] = await pool.execute(
      'SELECT id, event_id, guest_name FROM invitations WHERE invitation_uuid = ? LIMIT 1',
      [uuid]
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found.' });

    const [[existing]] = await pool.execute(
      'SELECT id, response FROM rsvp_responses WHERE invitation_id = ? LIMIT 1',
      [inv.id]
    );

    if (existing) {
      return res.status(409).json({
        success:           false,
        already_responded: true,
        response:          existing.response,
        message:           'Tayari umeshajibu mwaliko huu.',
      });
    }

    await pool.execute(
      `INSERT INTO rsvp_responses (event_id, invitation_id, response) VALUES (?, ?, ?)`,
      [inv.event_id || null, inv.id, response]
    );

    console.log(`[submitRSVP] ${inv.guest_name} → ${response}`);

    const message = response === 'attending'
      ? 'Asante! Tunafurahi kukuona.'
      : 'Asante kwa kutujulisha.';

    res.json({ success: true, response, guest_name: inv.guest_name, message });
  } catch (err) {
    console.error('[submitRSVP]', err);
    res.status(500).json({ success: false, message: 'Imeshindwa kuhifadhi jibu lako.' });
  }
}

module.exports = { submitRSVP, getPublicInvite };
