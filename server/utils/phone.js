'use strict';

/**
 * Phone normalisation and validation.
 *
 * The system stores whatever staff typed — `0754…`, `+255754…`, `255754…`, with
 * spaces or brackets — so anything that talks to a provider has to normalise
 * first. This mirrors what services/sms/BeemProvider.js already does for SMS
 * (which is left untouched) and adds the validation WhatsApp needs, because an
 * unreachable number has to become a FAILED row with a reason rather than a
 * request the provider rejects.
 *
 * Tanzania:
 *   0712345678    → 255712345678
 *   0612345678    → 255612345678
 *   +255712345678 → 255712345678
 *   712345678     → 255712345678   (leading zero lost in a spreadsheet)
 *
 * Numbers from other countries are left alone apart from formatting characters,
 * so a guest travelling in on a Kenyan or UK number is not corrupted.
 */

const TZ_CODE = '255';

/** Digits only, no '+'. Returns '' when there is nothing usable. */
function toDigits(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const hadPlus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (!hadPlus && s.startsWith('00')) d = d.replace(/^00/, '');
  if (s.startsWith('00')) d = d.replace(/^00/, '');
  return d;
}

/**
 * International format without '+', which is what Beem expects.
 * @returns {string} '' when the input cannot be turned into a number
 */
function normalisePhone(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';

  const explicitlyInternational = s.startsWith('+') || s.startsWith('00');
  let d = toDigits(s);
  if (!d) return '';

  if (explicitlyInternational) return d;          // already told us the country
  if (d.startsWith('0')) return TZ_CODE + d.slice(1);
  if (d.startsWith(TZ_CODE)) return d;
  // Nine digits beginning 6 or 7 is a Tanzanian mobile that lost its zero
  if (/^[67]\d{8}$/.test(d)) return TZ_CODE + d;
  return d;
}

/**
 * Is this something a provider can actually deliver to?
 * @returns {{ ok: boolean, phone: string, reason?: string }}
 */
function validatePhone(raw) {
  const original = String(raw == null ? '' : raw).trim();
  if (!original) return { ok: false, phone: '', reason: 'no phone number' };

  const phone = normalisePhone(original);
  if (!phone) return { ok: false, phone: '', reason: `"${original}" has no digits` };

  if (phone.startsWith(TZ_CODE)) {
    // 255 + 9 digits, mobile prefixes 6 and 7
    if (!/^255[67]\d{8}$/.test(phone)) {
      return { ok: false, phone, reason: `"${original}" is not a valid Tanzanian mobile number` };
    }
    return { ok: true, phone };
  }

  // Any other country: a plausible E.164 length is all we can honestly check
  if (phone.length < 8 || phone.length > 15) {
    return { ok: false, phone, reason: `"${original}" is not a valid international number` };
  }
  return { ok: true, phone };
}

/** With a leading '+', for display. */
const displayPhone = (raw) => {
  const p = normalisePhone(raw);
  return p ? `+${p}` : '';
};

module.exports = { normalisePhone, validatePhone, displayPhone, toDigits, TZ_CODE };
