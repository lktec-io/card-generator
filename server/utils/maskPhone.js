'use strict';

/**
 * Mask a phone number for display in send results: keep the country code and
 * the last three digits, hide the rest. "255712345678" → "255******678".
 * Anything too short to mask meaningfully is fully hidden.
 */
function maskPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 7) return digits ? '•'.repeat(digits.length) : '';
  return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 6)}${digits.slice(-3)}`;
}

module.exports = { maskPhone };
