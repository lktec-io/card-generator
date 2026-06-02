// Decode the stored JWT client-side to read role.
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

export function getRole()      { return decodeToken()?.role ?? null; }
export function getEmail()     { return decodeToken()?.email ?? null; }
export function isAdmin()      { return getRole() === 'admin'; }
export function isGateStaff()  { return getRole() === 'gate_staff'; }
export function isLoggedIn()   { return !!localStorage.getItem('wqr_token'); }
