// Decode the stored JWT client-side to read payload fields.
// No secret needed — we just read the payload, not verify it.

function decodeToken() {
  const token = localStorage.getItem('wqr_token');
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function getRole()         { return decodeToken()?.role  ?? null; }
export function getEmail()        { return decodeToken()?.email ?? null; }
export function getUserId()       { return decodeToken()?.id    ?? null; }
export function getUserName()     { return decodeToken()?.name  ?? null; }

export function isSuperAdmin()    { return getRole() === 'super_admin'; }
export function isAdmin()         { const r = getRole(); return r === 'admin' || r === 'super_admin'; }
export function isEventManager()  { return getRole() === 'event_manager'; }
export function isVerifier()      { const r = getRole(); return r === 'verifier' || r === 'gate_staff'; }
export function isGateStaff()     { return getRole() === 'gate_staff'; }
export function canManage()       { return isAdmin() || isEventManager(); }
export function getAccessType()   { return decodeToken()?.access_type ?? 'both'; }

export function isLoggedIn()      { return !!localStorage.getItem('wqr_token'); }
