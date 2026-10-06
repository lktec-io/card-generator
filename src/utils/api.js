import axios from 'axios';

// Same-origin: nginx proxies /api/ on every hostname that serves this app
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('wqr_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // A 401 from the sign-in request itself just means wrong credentials — the login page
    // shows that inline. Redirecting here would reload the page and wipe the message.
    const isLoginRequest = (err.config?.url || '').includes('/auth/login');
    if (err.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('wqr_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export function getAuthHeaders() {
  const token = localStorage.getItem('wqr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const login = (email, password) =>
  api.post('/auth/login', { email, password });

// ── Invitations ───────────────────────────────────────────────────────────────
export const generateCard = (formData) =>
  api.post('/generate', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

export const renderCard = (formData) =>
  api.post('/render', formData, {
    headers:      { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
  });

export const reserveCard  = (guestName, phoneNumber = null, eventId = null) =>
  api.post('/reserve', { guest_name: guestName, phone_number: phoneNumber, event_id: eventId });

export const verifyCode   = (code) => api.post('/verify',        { code });
export const verifyManual = (code) => api.post('/verify/manual', { invitation_code: code });

// Guest name search — read-only lookup; check-in still goes through verifyManual
export const searchGuests = (q, config = {}) =>
  api.get('/invitations/search', { params: { q }, ...config });

export const getStats             = () => api.get('/stats');
export const getGlobalStats       = () => api.get('/stats/global');
export const getAdminDashboard    = () => api.get('/admin/dashboard');

// ── Templates ─────────────────────────────────────────────────────────────────
export const listTemplates    = (type = null) => api.get('/templates',     { params: type ? { type } : {} });
export const listAllTemplates = (type = null) => api.get('/templates/all', { params: type ? { type } : {} });
export const toggleTemplate   = (id) => api.patch(`/templates/${id}/toggle`);
export const updateTemplateLayout = (id, layoutConfig) =>
  api.patch(`/templates/${id}/layout`, { layout_config: layoutConfig });

export const createContributionTemplate = (formData) =>
  api.post('/templates/contribution', formData, { headers: { 'Content-Type': 'multipart/form-data' } });

// ── Events ────────────────────────────────────────────────────────────────────
export const listEvents  = ()         => api.get('/events');
export const createEvent = (data)     => api.post('/events', data);
export const getEvent    = (id)       => api.get(`/events/${id}`);
export const updateEvent = (id, data) => api.put(`/events/${id}`, data);
export const deleteEvent = (id)       => api.delete(`/events/${id}`);

// ── Verification history ──────────────────────────────────────────────────────
// Verifiers always get their own history (decided by the server from the login token);
// admins may pass { verifier_id } to narrow the list to one staff member.
export const getVerificationLogs = (params = {}) => api.get('/verification-logs', { params });

// ── Public invite & RSVP (no auth, UUID-based) ───────────────────────────────
export const getPublicInvite = (uuid)       => api.get(`/invite/${uuid}`);
export const submitRSVP      = (uuid, resp) => api.post(`/rsvp/${uuid}`, { response: resp });

// Standalone voice message — independent of RSVP
export const sendVoiceMessage = (uuid, audioBlob) => {
  const ext  = audioBlob.type?.includes('mp4') ? 'm4a' : 'webm';
  const form = new FormData();
  form.append('audio', audioBlob, `voice.${ext}`);
  return api.post(`/voice-message/${uuid}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const getVoiceMessages    = (eventId) => api.get(`/events/${eventId}/voice-messages`);
export const deleteVoiceMessage  = (id)      => api.delete(`/voice-messages/${id}`);

// ── Admin ─────────────────────────────────────────────────────────────────────
export const deleteInvitation     = (id)           => api.delete(`/invitations/${id}`);
export const deleteAllInvitations = ()             => api.delete('/invitations');
export const trackInvitationShare = (id)           => api.post(`/invitations/${id}/share`);
export const bulkImport           = (guests, eventId) =>
  api.post('/import', { guests, event_id: eventId });

// ── Bulk card generation (Import → Generate Cards) ───────────────────────────
// The spreadsheet is validated and re-read server-side, so the rows that get
// generated are exactly the rows the file describes.
// The template is built and stored by the API (storage/templates), not assembled
// in the browser — so what staff fill in is exactly what the server parses.
export const downloadImportTemplate = (format = 'xlsx') =>
  api.get('/import/template', { params: { format }, responseType: 'blob' });

export const validateGuestSheet = (file, eventId) => {
  const form = new FormData();
  form.append('sheet', file);
  form.append('event_id', eventId);
  return api.post('/import/validate', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
};

export const startBulkCardGeneration = (eventId, { sheet, image, layout }) => {
  const form = new FormData();
  form.append('sheet', sheet);
  form.append('image', image);
  for (const [k, v] of Object.entries(layout || {})) {
    if (v !== null && v !== undefined) form.append(k, v);
  }
  return api.post(`/import/bulk-generate/${eventId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  });
};

export const getBulkCardProgress = (jobId) =>
  api.get(`/import/bulk-generate/progress/${jobId}`);

export const retryBulkCards = (jobId, image) => {
  const form = new FormData();
  form.append('image', image);
  return api.post(`/import/bulk-generate/retry/${jobId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000,
  });
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsers         = ()           => api.get('/users');
export const listUsersDropdown = ()           => api.get('/users/dropdown');
export const createUser        = (data)       => api.post('/users', data);
export const getUser           = (id)         => api.get(`/users/${id}`);
export const updateUser        = (id, data)   => api.put(`/users/${id}`, data);
export const toggleUserStatus  = (id)         => api.patch(`/users/${id}/status`);
export const deleteUser        = (id)         => api.delete(`/users/${id}`);

// ── SMS ───────────────────────────────────────────────────────────────────────
export const sendInvitationSms   = (invitationId)  => api.post(`/sms/send/${invitationId}`);
export const sendBulkSms         = (eventId)       => api.post(`/sms/bulk/${eventId}`);
export const getBulkSmsProgress  = (jobId)         => api.get(`/sms/bulk/progress/${jobId}`);
// Server-side search + pagination. Called with no options it behaves as before.
export const getSmsLogs = (eventId, { q = '', status = '', page = 1, pageSize = 50 } = {}) =>
  api.get(`/sms/logs/${eventId}`, { params: { q, status, page, page_size: pageSize } });
export const retrySms            = (logId)         => api.post(`/sms/retry/${logId}`);

// ── WhatsApp (Beem) ───────────────────────────────────────────────────────────
// A separate channel from SMS: its own provider, its own logs, its own routes.
// Credentials never reach the browser — the status endpoint only reports whether
// the server is configured and which template is live.
export const getWhatsAppStatus   = ()        => api.get('/whatsapp/status');
export const getWhatsAppSummary  = (eventId) => api.get(`/whatsapp/summary/${eventId}`);

export const sendWhatsAppInvitation = (invitationId, opts = {}) =>
  api.post(`/whatsapp/send/${invitationId}`, opts);

/** Omit invitationIds to message every eligible guest in the event. */
export const sendWhatsAppBulk = (eventId, invitationIds = null) =>
  api.post(`/whatsapp/bulk/${eventId}`, invitationIds ? { invitation_ids: invitationIds } : {});

export const getWhatsAppProgress = (jobId)   => api.get(`/whatsapp/bulk/progress/${jobId}`);
export const retryWhatsAppFailed = (eventId) => api.post(`/whatsapp/retry/${eventId}`);

/** Server-side search + pagination — never load every row into the browser. */
export const getWhatsAppLogs = (eventId, { q = '', status = '', page = 1, pageSize = 25 } = {}) =>
  api.get(`/whatsapp/logs/${eventId}`, { params: { q, status, page, page_size: pageSize } });

// Post-event thank-you SMS (same Beem service, recipients resolved server-side per event)
export const getThankYouInfo     = (eventId)       => api.get(`/sms/thank-you/${eventId}`);
export const saveThankYouTemplate = (eventId, message)      => api.put(`/sms/thank-you/${eventId}`, { message });
export const sendThankYouSms     = (invitationId, message) => api.post(`/sms/thank-you/send/${invitationId}`, { message });
export const sendThankYouBulkSms = (eventId, payload)      => api.post(`/sms/thank-you/bulk/${eventId}`, payload);

export default api;
