const pool              = require('../config/db');
const { uploadBuffer }  = require('../config/cloudinary');

// POST /voice-message/:uuid  — guest sends a voice message (public, no auth)
async function sendVoiceMessage(req, res) {
  const uuid = (req.params.uuid || '').trim();

  if (!uuid)    return res.status(400).json({ success: false, message: 'Invalid invitation link.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Audio file is required.' });

  try {
    const [[inv]] = await pool.execute(
      `SELECT id, code, guest_name, event_id
         FROM invitations
        WHERE invitation_uuid = ?
        LIMIT 1`,
      [uuid]
    );

    if (!inv) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    // Upload to Cloudinary — transcode to mp3 for small size & universal playback
    const result = await uploadBuffer(req.file.buffer, {
      resource_type: 'auto',
      public_id:     `voice-messages/${inv.code}-${Date.now()}`,
      overwrite:     false,
      format:        'mp3',
    });

    await pool.execute(
      `INSERT INTO voice_messages
         (event_id, invitation_id, guest_name, invitation_code, voice_message_url)
       VALUES (?, ?, ?, ?, ?)`,
      [inv.event_id || null, inv.id, inv.guest_name, inv.code, result.secure_url]
    );

    console.log(`[voiceMessage] ${inv.code} "${inv.guest_name}" → ${result.secure_url}`);

    res.status(201).json({
      success: true,
      message: 'Ujumbe wako umetumwa.',
      guest_name: inv.guest_name,
    });
  } catch (err) {
    console.error('[sendVoiceMessage]', err);
    res.status(500).json({ success: false, message: 'Imeshindwa kutuma ujumbe.' });
  }
}

// GET /events/:id/voice-messages  — admin: list voice messages for an event
async function getVoiceMessages(req, res) {
  const eventId = parseInt(req.params.id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  try {
    const [messages] = await pool.execute(
      `SELECT id, guest_name, invitation_code, voice_message_url, created_at
         FROM voice_messages
        WHERE event_id = ?
        ORDER BY created_at DESC`,
      [eventId]
    );

    res.json({ success: true, messages });
  } catch (err) {
    console.error('[getVoiceMessages]', err);
    res.status(500).json({ success: false, message: 'Failed to load voice messages.' });
  }
}

module.exports = { sendVoiceMessage, getVoiceMessages };
