/**
 * SMS Service — provider-agnostic abstraction layer.
 *
 * Supported providers (configure via SMS_PROVIDER env var):
 *   beem          — Beem Africa (https://beem.africa)
 *   africastalking — Africa's Talking (https://africastalking.com)
 *   smartcodes    — Smart Codes Tanzania
 *
 * Required env vars (provider-specific):
 *   SMS_PROVIDER=beem
 *   BEEM_API_KEY=...
 *   BEEM_SECRET_KEY=...
 *   SMS_SENDER_ID=NardioEvents
 */

const SMS_PROVIDER = process.env.SMS_PROVIDER || 'beem';

/**
 * Send a single SMS.
 * @param {string} to      E.164 phone number, e.g. "+255712345678"
 * @param {string} message Plain-text message body
 * @returns {Promise<{success: boolean, provider: string, messageId?: string}>}
 */
async function sendSMS(to, message) {
  switch (SMS_PROVIDER) {
    case 'beem':
      return _sendViaBeem(to, message);
    case 'africastalking':
      return _sendViaAfricasTalking(to, message);
    case 'smartcodes':
      return _sendViaSmartCodes(to, message);
    default:
      throw new Error(`Unknown SMS provider: ${SMS_PROVIDER}`);
  }
}

/**
 * Send invitation link + RSVP link to a guest.
 * @param {string} phone
 * @param {string} guestName
 * @param {string} code        e.g. "CN-001"
 * @param {string} eventName
 * @param {string} baseUrl     e.g. "https://wedding.nardio.online"
 */
async function sendInvitationSMS(phone, guestName, code, eventName, baseUrl) {
  const inviteUrl = `${baseUrl}/invite/${code}`;
  const message = [
    `Dear ${guestName},`,
    `You are invited to ${eventName}.`,
    `View your invitation & RSVP: ${inviteUrl}`,
    `Your code: ${code}`,
    `— Nardio Events`,
  ].join('\n');
  return sendSMS(phone, message);
}

// ── Provider implementations ─────────────────────────────────────────────────

async function _sendViaBeem(to, message) {
  // TODO: install axios or node-fetch; implement Beem HTTP API call
  // POST https://apisms.beem.africa/v1/send
  // Headers: Authorization: Basic base64(api_key:secret_key)
  // Body: { source_addr, schedule_time, encoding, message, recipients: [{ recipient_id, dest_addr }] }
  console.log(`[SMS/Beem] → ${to}: ${message}`);
  return { success: true, provider: 'beem', messageId: null };
}

async function _sendViaAfricasTalking(to, message) {
  // TODO: npm install africastalking; implement SDK call
  // const AT = require('africastalking')({ apiKey, username });
  // await AT.SMS.send({ to: [to], message, from: process.env.SMS_SENDER_ID });
  console.log(`[SMS/AfricasTalking] → ${to}: ${message}`);
  return { success: true, provider: 'africastalking', messageId: null };
}

async function _sendViaSmartCodes(to, message) {
  // TODO: implement Smart Codes Tanzania HTTP API call
  console.log(`[SMS/SmartCodes] → ${to}: ${message}`);
  return { success: true, provider: 'smartcodes', messageId: null };
}

module.exports = { sendSMS, sendInvitationSMS };
