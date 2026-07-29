'use strict';

const BeemProvider = require('./BeemProvider');

/**
 * Application-level SMS service.
 * Controllers call SmsService.send() — never a concrete provider directly.
 * Swap providers by changing the one line below; controllers are untouched.
 */
const _provider = new BeemProvider();

/**
 * Send an SMS message.
 * @param {string} to      Recipient phone number (raw format — provider normalises)
 * @param {string} message Message body
 * @returns {Promise<{ success: true, provider_message_id: string|null }>}
 */
async function send(to, message) {
  return _provider.send(to, message);
}

/** Provider slug for log entries (e.g. "beem"). */
function providerName() {
  return _provider.name;
}

module.exports = { send, providerName };
