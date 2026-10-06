'use strict';

/**
 * WhatsApp service — what the rest of the application talks to.
 *
 * Deliberately separate from SmsService: SMS and WhatsApp are different
 * products with different providers, different rules (WhatsApp needs an
 * approved template) and different logs. Nothing here touches sms_logs and
 * nothing in the SMS path touches this.
 *
 * One function does the sending — sendWhatsAppInvitation() — and the single,
 * selected, all and retry flows all go through it, so they cannot drift apart.
 */

const BeemWhatsAppProvider = require('./BeemWhatsAppProvider');
const { getConfig, publicStatus } = require('../../config/whatsapp');
const { validatePhone } = require('../../utils/phone');

let _provider = null;
let _pinned   = false;   // set by tests; a pinned provider is never replaced

/** The provider, rebuilt whenever configuration changes underneath us. */
function provider() {
  if (_pinned && _provider) return _provider;
  const cfg = getConfig();
  if (!_provider || _provider.config.apiKey !== cfg.apiKey
      || _provider.config.templateId !== cfg.templateId
      || _provider.config.apiUrl !== cfg.apiUrl) {
    _provider = new BeemWhatsAppProvider(cfg);
  }
  return _provider;
}

/**
 * For tests: inject a provider that is never swapped out underneath them.
 * Passing null restores normal behaviour.
 */
function __setProvider(p) {
  _provider = p;
  _pinned = Boolean(p);
}

const isConfigured = () => provider().isConfigured();
const configurationError = () => provider().configurationError();
const providerName = () => provider().name();

function formatEventDate(raw) {
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return String(raw).split('T')[0];
  }
}

/**
 * The template's placeholders, in the order an approved template declares them.
 *
 * Kept in one place so the template can be re-approved with a different wording
 * without hunting through controllers. If the approved template takes fewer
 * parameters, the extra ones are simply unused — Beem matches by position.
 */
function templateParams({ invitation, event, inviteUrl }) {
  return {
    guest_name: invitation.guest_name || '',
    event_name: event?.event_name || '',
    event_date: formatEventDate(event?.event_date),
    event_time: event?.event_time || '',
    venue:      event?.venue || '',
    invitation_code: invitation.code || '',
    invitation_link: inviteUrl || '',
  };
}

/**
 * Send one invitation over WhatsApp.
 *
 * Validation happens before anything is sent, so an unusable row becomes a
 * clear failure rather than a provider error:
 *   - WhatsApp configured (credentials + approved template)
 *   - event and invitation present
 *   - guest has a phone number that normalises to a deliverable one
 *
 * @param {object}  args
 * @param {object}  args.invitation  { id, code, guest_name, phone_number, image_url, invitation_uuid }
 * @param {object}  args.event       { id, event_name, event_date, event_time, venue }
 * @param {string} [args.baseUrl]    public site origin, for the invitation link
 * @param {boolean}[args.includeMedia] attach the card image (template must allow it)
 * @param {string} [args.reference]  our own correlation id, echoed back on callbacks
 * @returns {Promise<{ success:boolean, job_id:string|null, provider_message_id:string|null,
 *                     status:string, phone:string, params:object, media_url:string|null }>}
 */
async function sendWhatsAppInvitation({ invitation, event, baseUrl = '', includeMedia = true, reference = null }) {
  if (!invitation || !invitation.id) {
    const e = new Error('Invitation not found.');
    e.code = 'NO_INVITATION';
    throw e;
  }
  if (!event || !event.id) {
    const e = new Error('Event not found.');
    e.code = 'NO_EVENT';
    throw e;
  }

  const cfgError = configurationError();
  if (cfgError) {
    const e = new Error(cfgError);
    e.code = 'WHATSAPP_NOT_CONFIGURED';
    throw e;
  }

  const check = validatePhone(invitation.phone_number);
  if (!check.ok) {
    const e = new Error(check.reason === 'no phone number'
      ? `${invitation.guest_name || 'This guest'} has no phone number.`
      : check.reason);
    e.code = 'INVALID_PHONE';
    throw e;
  }

  const inviteUrl = invitation.invitation_uuid && baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/invite/${invitation.invitation_uuid}`
    : '';

  // WhatsApp fetches template media itself, so it must be a public HTTPS URL —
  // a relative /uploads/cards/... path would be unreachable to the provider.
  const mediaUrl = includeMedia ? absoluteHttpsUrl(invitation.image_url, baseUrl) : null;

  const params = templateParams({ invitation, event, inviteUrl });

  const result = await provider().send({
    phone: check.phone,
    params,
    mediaUrl: mediaUrl || undefined,
    reference: reference || undefined,
  });

  return {
    success: true,
    job_id: result.job_id,
    provider_message_id: result.provider_message_id,
    status: result.status || 'accepted',
    phone: check.phone,
    params,
    media_url: mediaUrl,
  };
}

/**
 * A card URL the provider can actually fetch, or null.
 * Relative paths are made absolute against the public site; anything that is
 * not HTTPS is dropped rather than sent and silently rejected by WhatsApp.
 */
function absoluteHttpsUrl(imageUrl, baseUrl) {
  const raw = String(imageUrl || '').trim();
  if (!raw) return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) return null;
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/** Normalise a delivery callback. Never throws. */
function parseCallback(payload) {
  try {
    return provider().parseCallback(payload);
  } catch {
    return { matched: false, job_id: null, provider_message_id: null, reference: null,
             status: null, raw_status: null, error: null, recipient: null };
  }
}

module.exports = {
  sendWhatsAppInvitation,
  parseCallback,
  isConfigured,
  configurationError,
  providerName,
  publicStatus,
  templateParams,
  absoluteHttpsUrl,
  __setProvider,
};
