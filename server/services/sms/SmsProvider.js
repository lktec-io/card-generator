'use strict';

/**
 * Abstract SMS provider interface.
 * Subclass this and implement send() to add a new provider.
 * Controllers must never import a concrete provider — always go through SmsService.
 */
class SmsProvider {
  /**
   * @param {string} to      Raw phone number (provider normalises format)
   * @param {string} message Message text (max ~160 chars for single-part SMS)
   * @returns {Promise<{ success: true, provider_message_id: string|null }>}
   * @throws {Error} on delivery failure — message describes the reason
   */
  async send(_to, _message) {
    throw new Error(`${this.constructor.name} must implement send(to, message)`);
  }

  /** Human-readable provider name used for log entries. */
  get name() {
    return this.constructor.name.replace('Provider', '').toLowerCase();
  }
}

module.exports = SmsProvider;
