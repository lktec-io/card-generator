import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'https://wedding.nardio.online/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

// Attach JWT token to every request automatically
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wqr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 — clear stale token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('wqr_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// Helper for plain fetch calls that also need the auth header (admin page)
export function getAuthHeaders() {
  const token = localStorage.getItem('wqr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Login with email + password. Returns { success, token }.
 */
export function login(email, password) {
  return api.post('/auth/login', { email, password });
}

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
