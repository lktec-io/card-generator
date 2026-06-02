/**
 * WhatsApp Service — provider-agnostic abstraction layer.
 *
 * Supported providers (configure via WA_PROVIDER env var):
 *   meta    — Meta WhatsApp Business API (cloud)
 *   twilio  — Twilio WhatsApp sandbox / Business
 *
 * Required env vars:
 *   WA_PROVIDER=meta
 *   WA_ACCESS_TOKEN=...
 *   WA_PHONE_NUMBER_ID=...
 *   WA_BUSINESS_ACCOUNT_ID=...
 */

const WA_PROVIDER = process.env.WA_PROVIDER || 'meta';

/**
 * Send a WhatsApp text message.
 * @param {string} to      E.164 phone number, e.g. "+255712345678"
 * @param {string} message Plain-text body
 * @returns {Promise<{success: boolean, provider: string, messageId?: string}>}
 */
async function sendWhatsApp(to, message) {
  switch (WA_PROVIDER) {
    case 'meta':
      return _sendViaMeta(to, message);
    case 'twilio':
      return _sendViaTwilio(to, message);
    default:
      throw new Error(`Unknown WhatsApp provider: ${WA_PROVIDER}`);
  }
}

/**
 * Send an invitation link via WhatsApp.
 */
async function sendInvitationWhatsApp(phone, guestName, code, eventName, baseUrl) {
  const inviteUrl = `${baseUrl}/invite/${code}`;
  const message = [
    `🎉 *${eventName}*`,
    ``,
    `Dear *${guestName}*,`,
    `You are cordially invited!`,
    ``,
    `🔗 View Invitation & RSVP:`,
    inviteUrl,
    ``,
    `🎫 Your Code: *${code}*`,
    ``,
    `_— Nardio Events_`,
  ].join('\n');
  return sendWhatsApp(phone, message);
}

/**
 * Send an RSVP reminder via WhatsApp.
 */
async function sendRSVPReminder(phone, guestName, code, eventName, eventDate, baseUrl) {
  const inviteUrl = `${baseUrl}/invite/${code}`;
  const message = [
    `⏰ *RSVP Reminder*`,
    ``,
    `Dear *${guestName}*,`,
    `Please confirm your attendance for *${eventName}*${eventDate ? ` on ${eventDate}` : ''}.`,
    ``,
    `👉 Respond here: ${inviteUrl}`,
  ].join('\n');
  return sendWhatsApp(phone, message);
}

// ── Provider implementations ─────────────────────────────────────────────────

async function _sendViaMeta(to, message) {
  // TODO: implement Meta Cloud API call
  // POST https://graph.facebook.com/v18.0/{WA_PHONE_NUMBER_ID}/messages
  // Headers: Authorization: Bearer WA_ACCESS_TOKEN
  // Body: { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }
  console.log(`[WhatsApp/Meta] → ${to}: ${message}`);
  return { success: true, provider: 'meta', messageId: null };
}

async function _sendViaTwilio(to, message) {
  // TODO: npm install twilio; implement Twilio SDK call
  // const client = require('twilio')(TWILIO_SID, TWILIO_AUTH);
  // await client.messages.create({ from: 'whatsapp:+14155238886', to: `whatsapp:${to}`, body: message });
  console.log(`[WhatsApp/Twilio] → ${to}: ${message}`);
  return { success: true, provider: 'twilio', messageId: null };
}

module.exports = { sendWhatsApp, sendInvitationWhatsApp, sendRSVPReminder };
