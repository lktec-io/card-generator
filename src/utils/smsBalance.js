import { useEffect, useSyncExternalStore } from 'react';
import { getSmsBalance } from './api';

/**
 * One shared, live view of the Beem SMS credit balance for the whole tab, so
 * the Dashboard card and the send confirmations show the same figure and
 * never fire duplicate requests.
 *
 *   status: idle | loading | ok | error | forbidden
 *   balance / checkedAt: the latest VERIFIED answer (checkedAt = when Beem answered)
 *   lastKnown: after a failure, the last verified answer — shown as such, never as current
 *
 * A 403 is remembered for the session, so users without the permission are not
 * asked again. Signing in as someone else starts from scratch.
 */
const INITIAL = { status: 'idle', balance: null, checkedAt: null, error: '', lastKnown: null, token: null };
let state = INITIAL;
let inflight = null;
const subs = new Set();

const currentToken = () => { try { return localStorage.getItem('wqr_token'); } catch { return null; } };
const view = () => (state.token === currentToken() ? state : INITIAL);
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((fn) => fn()); };

function describe(err) {
  if (!err?.response) return err?.code === 'ECONNABORTED' ? 'The server took too long to answer.' : 'Could not reach the server.';
  return err.response.data?.message || 'The SMS balance could not be checked right now.';
}

/** Ask for the balance. fresh=true → the server asks Beem now (rate-limited there). */
export function refreshSmsBalance({ fresh = false } = {}) {
  const token = currentToken();
  if (!token) return Promise.resolve(INITIAL);
  if (state.token !== token) state = { ...INITIAL, token };      // a different signed-in user
  if (state.status === 'forbidden') return Promise.resolve(state);
  if (inflight) return inflight;                                // one request at a time
  set({ status: 'loading', error: '' });
  inflight = getSmsBalance({ fresh })
    .then(({ data }) => {
      if (data?.success && Number.isFinite(Number(data.sms_balance))) {
        set({ status: 'ok', balance: Number(data.sms_balance), checkedAt: data.checked_at || null, error: '', lastKnown: null });
      } else {
        set({ status: 'error', error: 'The SMS balance could not be checked right now.', balance: null });
      }
      return state;
    })
    .catch((err) => {
      if (err?.response?.status === 403) { set({ status: 'forbidden', balance: null, checkedAt: null }); return state; }
      const known = err?.response?.data?.last_known
        || (state.balance !== null ? { sms_balance: state.balance, checked_at: state.checkedAt } : null);
      set({ status: 'error', error: describe(err), balance: null, checkedAt: null, lastKnown: known });
      return state;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/** React hook: the shared state, plus an optional fetch on mount. */
export function useSmsBalance({ onMount = null } = {}) {
  const snap = useSyncExternalStore((fn) => { subs.add(fn); return () => subs.delete(fn); }, view, view);
  useEffect(() => {
    if (onMount) refreshSmsBalance({ fresh: onMount === 'fresh' });
  }, [onMount]);
  return snap;
}

/** "1,250" — credits can be fractional on some tariffs, so up to 2 decimals. */
export const formatCredits = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const formatChecked = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** Tests only. */
export const __resetSmsBalance = () => { state = INITIAL; inflight = null; };
