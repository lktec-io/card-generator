const pool = require('../config/db');

// POST /rsvp/:code
async function submitRSVP(req, res) {
  const code     = (req.params.code || '').trim().toUpperCase();
  const response = (req.body.response || '').trim();

  if (!['attending', 'declined'].includes(response)) {
    return res.status(400).json({ success: false, message: 'Response must be "attending" or "declined".' });
  }

  try {
    const [[inv]] = await pool.execute(
      'SELECT id, event_id, guest_name FROM invitations WHERE code = ? LIMIT 1',
      [code]
    );
    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    await pool.execute(
      `INSERT INTO rsvp_responses (event_id, invitation_id, response)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE response = VALUES(response), created_at = NOW()`,
      [inv.event_id, inv.id, response]
    );

    console.log(`[submitRSVP] ${code} → ${response}`);

    res.json({
      success:    true,
      response,
      guest_name: inv.guest_name,
      message:    response === 'attending'
        ? 'Thank you! We look forward to seeing you.'
        : 'Thank you for letting us know.',
    });
  } catch (err) {
    console.error('[submitRSVP]', err);
    res.status(500).json({ success: false, message: 'Failed to submit RSVP.' });
  }
}

// GET /invite/:code  — public invitation data (no auth)
async function getPublicInvite(req, res) {
  const code = (req.params.code || '').trim().toUpperCase();

  try {
    const [[inv]] = await pool.execute(
      `SELECT i.id, i.code, i.guest_name, i.image_url, i.event_id,
              r.response AS rsvp_response
         FROM invitations i
         LEFT JOIN rsvp_responses r ON r.invitation_id = i.id
        WHERE i.code = ?
        LIMIT 1`,
      [code]
    );

    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    let event = null;
    if (inv.event_id) {
      const [[ev]] = await pool.execute('SELECT * FROM events WHERE id = ?', [inv.event_id]);
      event = ev || null;
    }

    res.json({ success: true, invitation: inv, event });
  } catch (err) {
    console.error('[getPublicInvite]', err);
    res.status(500).json({ success: false, message: 'Failed to load invitation.' });
  }
}

module.exports = { submitRSVP, getPublicInvite };
