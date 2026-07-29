import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'https://wedding.nardio.online/api';

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
    if (err.response?.status === 401) {
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
export const getVerificationLogs = () => api.get('/verification-logs');

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
export const getSmsLogs          = (eventId)       => api.get(`/sms/logs/${eventId}`);
export const retrySms            = (logId)         => api.post(`/sms/retry/${logId}`);

export default api;
