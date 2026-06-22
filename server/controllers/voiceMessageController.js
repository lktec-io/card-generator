const pool                        = require('../config/db');
const { uploadBuffer, cloudinary } = require('../config/cloudinary');
const { eventScopeSQL }           = require('../middleware/authMiddleware');

/* ── Extract Cloudinary public_id and resource_type from a secure_url ── */
function extractCloudinaryInfo(url) {
  if (!url) return null;
  try {
    // URL pattern: .../cloudinary.com/{cloud}/{resource_type}/upload/[v{ver}/]{public_id}.{ext}
    const match = url.match(/cloudinary\.com\/[^/]+\/([^/]+)\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    if (!match) return null;
    return { resource_type: match[1], public_id: match[2] };
  } catch {
    return null;
  }
}

// POST /voice-message/:uuid  — guest sends a voice message (public, no auth)
async function sendVoiceMessage(req, res) {
  const uuid = (req.params.uuid || '').trim();

  if (!uuid)     return res.status(400).json({ success: false, message: 'Invalid invitation link.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Audio file is required.' });

  try {
    const [[inv]] = await pool.execute(
      `SELECT id, code, guest_name, event_id
         FROM invitations
        WHERE invitation_uuid = ?
        LIMIT 1`,
      [uuid]
    );

    if (!inv) return res.status(404).json({ success: false, message: 'Invitation not found.' });

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
      success:    true,
      message:    'Ujumbe wako umetumwa.',
      guest_name: inv.guest_name,
    });
  } catch (err) {
    console.error('[sendVoiceMessage]', err);
    res.status(500).json({ success: false, message: 'Imeshindwa kutuma ujumbe.' });
  }
}

// GET /events/:id/voice-messages  — list voice messages for a scoped event
async function getVoiceMessages(req, res) {
  const eventId = parseInt(req.params.id, 10);
  if (!eventId) return res.status(400).json({ success: false, message: 'Invalid event ID.' });

  const scope = eventScopeSQL(req.user);

  try {
    // Verify the requester has access to this event
    if (scope.where) {
      const [[eventCheck]] = await pool.execute(
        `SELECT id FROM events e WHERE e.id = ? ${scope.where}`,
        [eventId, ...scope.params]
      );
      if (!eventCheck) {
        return res.status(404).json({ success: false, message: 'Event not found.' });
      }
    }

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

// DELETE /voice-messages/:id  — admin: delete one voice message
async function deleteVoiceMessage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ success: false, message: 'Invalid voice message ID.' });
  }

  try {
    const [[msg]] = await pool.execute(
      'SELECT id, voice_message_url FROM voice_messages WHERE id = ?',
      [id]
    );

    if (!msg) {
      return res.status(404).json({ success: false, message: 'Voice message not found.' });
    }

    // 1. Remove from Cloudinary (non-blocking — don't fail if Cloudinary is unreachable)
    const info = extractCloudinaryInfo(msg.voice_message_url);
    if (info) {
      try {
        await cloudinary.uploader.destroy(info.public_id, {
          resource_type: info.resource_type || 'video',
          invalidate:    true,
        });
        console.log(`[deleteVoiceMessage] Cloudinary removed: ${info.public_id}`);
      } catch (err) {
        console.warn('[deleteVoiceMessage] Cloudinary delete failed (continuing):', err.message);
      }
    }

    // 2. Remove from DB
    await pool.execute('DELETE FROM voice_messages WHERE id = ?', [id]);

    console.log(`[deleteVoiceMessage] DB record ${id} deleted`);
    res.json({ success: true, message: 'Ujumbe umefutwa.' });
  } catch (err) {
    console.error('[deleteVoiceMessage]', err);
    res.status(500).json({ success: false, message: 'Imeshindwa kufuta ujumbe.' });
  }
}

module.exports = { sendVoiceMessage, getVoiceMessages, deleteVoiceMessage };
