import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://wedding.nardio.online/api',
  timeout: 30_000,
});

/**
 * Generate a wedding invitation card.
 * @param {FormData} formData  Must contain: image (File), guest_name, language
 */
export function generateCard(formData) {
  return api.post('/generate', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

/**
 * Reserve an invitation code (no image upload).
 * Frontend renders the card with html2canvas and downloads directly.
 * @param {string} guestName
 */
export function reserveCard(guestName) {
  return api.post('/reserve', { guest_name: guestName });
}

/**
 * Verify a scanned invitation QR code.
 * @param {string} code  e.g. "CN-001"
 */
export function verifyCode(code) {
  return api.post('/verify', { code });
}

/**
 * Verify a manually typed CN code (guests without smartphones).
 * @param {string} code  e.g. "CN-001"
 */
export function verifyManual(code) {
  return api.post('/verify/manual', { invitation_code: code });
}

/**
 * Fetch dashboard statistics: { total, used, unused }
 */
export function getStats() {
  return api.get('/stats');
}

export default api;
