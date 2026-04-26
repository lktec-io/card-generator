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
 * Verify a scanned invitation QR code.
 * @param {string} code  e.g. "CN-001"
 */
export function verifyCode(code) {
  return api.post('/verify', { code });
}

/**
 * Fetch dashboard statistics: { total, used, unused }
 */
export function getStats() {
  return api.get('/stats');
}

export default api;
