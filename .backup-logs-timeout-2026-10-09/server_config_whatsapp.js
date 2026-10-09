'use strict';

/**
 * WhatsApp configuration — the single place credentials and template settings
 * are read from the environment.
 *
 * Nothing here is hardcoded and nothing reaches the browser: the frontend only
 * ever learns whether WhatsApp is configured, never the values.
 *
 * Beem requires an APPROVED TEMPLATE to start a WhatsApp conversation, so a
 * template id and language are as essential as the credentials. Until all of
 * them are present the service reports itself unconfigured and refuses to send,
 * rather than firing malformed requests at the provider.
 *
 * ── What still needs confirming against the live account ────────────────────
 * The exact endpoint path, the auth scheme and the request/callback field names
 * are the only things that could differ from what is set up here. They are all
 * overridable by environment variable and all isolated in
 * services/whatsapp/BeemWhatsAppProvider.js, so confirming them tomorrow is a
 * configuration change, not a code change.
 */

const DEFAULTS = {
  // Beem Broadcast template send — the endpoint verified working on this
  // account. Overridable, but this is the correct default, not a guess.
  apiUrl:   'https://apibroadcast.beem.africa/v1/broadcast/template/api-send',
  language: 'en',
  // Basic (same scheme as the working SMS integration) or Bearer.
  authMode: 'basic',
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function readConfig(env = process.env) {
  const cfg = {
    apiUrl:      str(env.BEEM_WHATSAPP_API_URL)   || DEFAULTS.apiUrl,
    apiKey:      str(env.BEEM_WHATSAPP_API_KEY),
    apiSecret:   str(env.BEEM_WHATSAPP_API_SECRET),
    // The Beem sender number that goes out as `from_addr`, e.g. 255706422927.
    // BEEM_WHATSAPP_FROM is the documented name; the two aliases are accepted
    // so a server already configured under a different name keeps working
    // instead of silently sending an empty sender.
    from: str(env.BEEM_WHATSAPP_FROM)
       || str(env.BEEM_WHATSAPP_FROM_ADDR)
       || str(env.BEEM_WHATSAPP_SENDER_ID),
    templateId:  str(env.BEEM_WHATSAPP_TEMPLATE_ID),
    language:    str(env.BEEM_WHATSAPP_TEMPLATE_LANGUAGE) || DEFAULTS.language,
    callbackUrl: str(env.BEEM_WHATSAPP_CALLBACK_URL),
    // Shared secret Beem is asked to send back on the delivery callback. Optional,
    // but when set the webhook rejects anything that does not present it.
    callbackSecret: str(env.BEEM_WHATSAPP_CALLBACK_SECRET),
    authMode:    (str(env.BEEM_WHATSAPP_AUTH_MODE) || DEFAULTS.authMode).toLowerCase(),
    // Sends per second. Beem rate-limits; this keeps a 400-guest campaign inside it.
    ratePerSecond: Number(env.BEEM_WHATSAPP_RATE_PER_SECOND) > 0
      ? Number(env.BEEM_WHATSAPP_RATE_PER_SECOND) : 5,
    timeoutMs: Number(env.BEEM_WHATSAPP_TIMEOUT_MS) > 0
      ? Number(env.BEEM_WHATSAPP_TIMEOUT_MS) : 20000,
  };

  // Configuration that is present but cannot work as set up. Surfaced to the
  // UI and the logs so it is noticed before a campaign, not after.
  cfg.warnings = [];
  if (cfg.callbackSecret && cfg.callbackUrl && !/[?&]secret=/.test(cfg.callbackUrl)) {
    cfg.warnings.push(
      'BEEM_WHATSAPP_CALLBACK_SECRET is set but BEEM_WHATSAPP_CALLBACK_URL does not carry it. ' +
      'Beem sends no secret header of its own, so delivery callbacks will be rejected. ' +
      'Append ?secret=<the secret> to the callback URL registered with Beem.'
    );
  }
  if (cfg.callbackUrl && !/^https:\/\//i.test(cfg.callbackUrl)) {
    cfg.warnings.push('BEEM_WHATSAPP_CALLBACK_URL must be public HTTPS for Beem to reach it.');
  }

  cfg.missing = [];
  if (!cfg.apiKey)     cfg.missing.push('BEEM_WHATSAPP_API_KEY');
  if (!cfg.apiSecret)  cfg.missing.push('BEEM_WHATSAPP_API_SECRET');
  if (!cfg.from)       cfg.missing.push('BEEM_WHATSAPP_FROM');
  if (!cfg.templateId) cfg.missing.push('BEEM_WHATSAPP_TEMPLATE_ID');
  cfg.configured = cfg.missing.length === 0;

  return cfg;
}

/** Read fresh every time, so adding credentials needs only a restart. */
function getConfig() {
  return readConfig(process.env);
}

/**
 * Safe to send to the browser and safe to log: says what is set up without
 * revealing any of it. Only the template id is shown in full, because it is not
 * a secret and staff need to be able to confirm which template is live.
 */
function publicStatus() {
  const c = getConfig();
  return {
    configured:  c.configured,
    missing:     c.missing,
    warnings:    c.warnings || [],
    template_id: c.templateId || null,
    language:    c.language,
    from:        c.from ? `…${c.from.slice(-4)}` : null,
    api_url:     c.apiUrl,
    callback_url: c.callbackUrl || null,
    rate_per_second: c.ratePerSecond,
  };
}

module.exports = { getConfig, publicStatus, readConfig, DEFAULTS };
