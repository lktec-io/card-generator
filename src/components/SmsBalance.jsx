import { MdRefresh, MdSms, MdWarningAmber } from 'react-icons/md';
import { useSmsBalance, refreshSmsBalance, formatCredits, formatChecked } from '../utils/smsBalance';
import '../styles/sms-balance.css';

/**
 * Live Beem SMS credit balance — a quantity of SMS credits, never money.
 * Both components render nothing for users without the SMS balance permission.
 */

function RefreshButton({ loading, label = 'Refresh SMS balance' }) {
  return (
    <button type="button" className="smsb-refresh" onClick={() => refreshSmsBalance({ fresh: true })}
            disabled={loading} aria-label={label} title={label}>
      <MdRefresh size={16} className={loading ? 'smsb-spin' : undefined} aria-hidden="true" />
    </button>
  );
}

/** Dashboard card. Loads on entry (a ≤30 s old answer may be reused); refresh asks Beem now. */
export function SmsBalanceCard() {
  const s = useSmsBalance({ onMount: 'cached' });
  if (s.status === 'forbidden' || s.status === 'idle') return null;
  const loading = s.status === 'loading';
  return (
    <section className="smsb-card" aria-labelledby="smsb-title" aria-busy={loading}>
      <div className="smsb-head">
        <h2 id="smsb-title" className="smsb-title"><MdSms aria-hidden="true" /> SMS Balance</h2>
        <RefreshButton loading={loading} />
      </div>
      {s.status === 'ok' && (
        <>
          <p className="smsb-value"><strong>{formatCredits(s.balance)}</strong> <span>SMS</span></p>
          <p className="smsb-meta">Checked with Beem {formatChecked(s.checkedAt)}</p>
          {s.balance <= 0 && <p className="smsb-warn"><MdWarningAmber aria-hidden="true" /> No SMS credits left — messages cannot be sent until the account is topped up.</p>}
        </>
      )}
      {loading && s.balance === null && <p className="smsb-meta">Checking with Beem…</p>}
      {s.status === 'error' && (
        <>
          <p className="smsb-error" role="alert">{s.error}</p>
          {s.lastKnown && (
            <p className="smsb-meta">Last verified: {formatCredits(s.lastKnown.sms_balance)} SMS at {formatChecked(s.lastKnown.checked_at)} — may have changed since.</p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * In the SMS send confirmations. Asks Beem for a fresh figure when shown.
 * Informational only: it never blocks or changes the send. No "credits needed"
 * estimate is shown — Beem charges "according to your tariff", which this
 * system does not know, so any figure would be a guess.
 */
export function SmsBalanceNotice() {
  const s = useSmsBalance({ onMount: 'fresh' });
  if (s.status === 'forbidden' || s.status === 'idle') return null;
  const loading = s.status === 'loading';
  return (
    <div className="smsb-notice" aria-live="polite">
      <div className="smsb-notice-row">
        <span>
          {s.status === 'ok' && <>Current SMS balance: <strong>{formatCredits(s.balance)} SMS</strong></>}
          {loading && 'Checking the SMS balance with Beem…'}
          {s.status === 'error' && <>SMS balance could not be checked: {s.error}</>}
        </span>
        <RefreshButton loading={loading} label="Check the SMS balance again" />
      </div>
      {s.status === 'ok' && <p className="smsb-meta">Checked {formatChecked(s.checkedAt)} · credits used per message depend on your Beem tariff and message length.</p>}
      {s.status === 'ok' && s.balance <= 0 && (
        <p className="smsb-warn"><MdWarningAmber aria-hidden="true" /> No SMS credits left — Beem will reject these messages and they will be logged as failed.</p>
      )}
      {s.status === 'error' && (
        <p className="smsb-meta">
          {s.lastKnown ? `Last verified: ${formatCredits(s.lastKnown.sms_balance)} SMS at ${formatChecked(s.lastKnown.checked_at)}. ` : ''}
          You can still send; any message Beem cannot accept is reported as failed.
        </p>
      )}
    </div>
  );
}
