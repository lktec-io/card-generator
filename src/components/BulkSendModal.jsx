import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaWhatsapp } from 'react-icons/fa';
import {
  MdSms, MdClose, MdCheckCircle, MdErrorOutline, MdHelpOutline, MdBlock,
  MdStopCircle, MdRefresh, MdHourglassEmpty,
} from 'react-icons/md';
import { friendlyReason, safeDetail, normaliseJob } from '../utils/sendResults';
import '../styles/bulk-send.css';

/**
 * WhatsApp / SMS sending: the confirmation before anything is sent, and the
 * live progress + results of a bulk job.
 *
 * Nothing here is simulated. Every number is read from the server's job state
 * (GET /whatsapp/bulk/progress/:id or /sms/bulk/progress/:id); the caller polls
 * and passes the latest object in. "Successful" means the provider ACCEPTED the
 * message — delivery and read receipts are a separate, later signal.
 */

const CHANNEL = {
  whatsapp: { label: 'WhatsApp', Icon: FaWhatsapp, cls: 'bs--wa' },
  sms:      { label: 'SMS',      Icon: MdSms,      cls: 'bs--sms' },
};

const OUTCOME = {
  accepted:    { label: 'Successful',          Icon: MdCheckCircle,  cls: 'ok' },
  failed:      { label: 'Failed',              Icon: MdErrorOutline, cls: 'bad' },
  unconfirmed: { label: 'Delivery unconfirmed', Icon: MdHelpOutline,  cls: 'warn' },
  skipped:     { label: 'Skipped',             Icon: MdBlock,        cls: 'muted' },
};

function useModalChrome(open, onEscape) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onEscape?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev || ''; };
  }, [open, onEscape]);
}

/* ── 1. confirmation ─────────────────────────────────────────────────────── */

/**
 * Props: open, channel ('whatsapp'|'sms'), count, detail (optional node),
 *        busy (request starting — disables both buttons), onConfirm, onCancel
 */
export function SendConfirmModal({ open, channel, count, detail, busy = false, onConfirm, onCancel }) {
  const ch = CHANNEL[channel] || CHANNEL.sms;
  // Synchronous guard: two clicks in the same tick both see the same React
  // state, so only a ref can make "confirm" fire exactly once per opening.
  const fired = useRef(false);
  useEffect(() => { if (open) fired.current = false; }, [open]);
  useModalChrome(open, busy ? null : onCancel);
  if (!open) return null;
  const n = Number(count) || 0;
  const confirmOnce = () => {
    if (fired.current || busy) return;
    fired.current = true;
    onConfirm();
  };

  return createPortal(
    <div className="bs-overlay" onClick={busy ? undefined : onCancel} role="presentation">
      <div className={`bs-card ${ch.cls}`} role="dialog" aria-modal="true" aria-labelledby="bs-confirm-title"
           onClick={(e) => e.stopPropagation()}>
        <button type="button" className="bs-x" onClick={onCancel} disabled={busy} aria-label="Close">
          <MdClose size={18} />
        </button>
        <div className="bs-icon" aria-hidden="true"><ch.Icon size={30} /></div>
        <h3 className="bs-title" id="bs-confirm-title">Confirm {ch.label} Sending</h3>
        <p className="bs-text">
          Are you sure you want to send {ch.label} messages to the selected recipient{n === 1 ? '' : 's'}?
        </p>
        <p className="bs-count"><strong>{n}</strong> recipient{n === 1 ? '' : 's'}</p>
        {detail && <div className="bs-detail">{detail}</div>}
        <div className="bs-actions">
          <button type="button" className="bs-btn bs-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="bs-btn bs-btn--primary" onClick={confirmOnce} disabled={busy || n === 0} autoFocus>
            {busy ? 'Starting…' : <>Yes, Send {ch.label}</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── 2 + 3. live progress, cancellation and results ──────────────────────── */

/**
 * Props:
 *   open, channel, job (raw progress object from the server)
 *   error        string — polling stopped (job lost / tracking ended)
 *   onCancelSending () => Promise — asks the server to stop before the next recipient
 *   onClose      () => void — "Close" when finished, "Hide" while running (job continues)
 *   onRetryFailed () => void | undefined — offered only when supported and there are definite failures
 */
export default function BulkSendModal({ open, channel, job, error, onCancelSending, onClose, onRetryFailed }) {
  const ch = CHANNEL[channel] || CHANNEL.sms;
  const j = useMemo(() => normaliseJob(job), [job]);
  const [stopStep, setStopStep] = useState('idle');   // idle | confirm | requesting | requested | failed
  const [stopError, setStopError] = useState('');
  const [view, setView] = useState(null);              // null | 'failed' | 'all'
  const stopSent = useRef(false);                      // one cancel request per job, even on a double click

  const ended = Boolean(j?.finished || error);
  useModalChrome(open, ended ? onClose : null);

  if (!open || !j) return null;

  // 100% only when every recipient was processed — a cancelled run shows how far it got
  const pct = j.finished && !j.cancelled ? 100
    : (j.total ? Math.min(j.finished ? 100 : 99, Math.round((j.completed / j.total) * 100)) : 0);
  const stopping = stopStep === 'requested' || j.cancelRequested;

  const askStop = () => { setStopError(''); setStopStep('confirm'); };
  const doStop = async () => {
    if (stopSent.current) return;
    stopSent.current = true;
    setStopStep('requesting');
    try {
      await onCancelSending();
      setStopStep('requested');
    } catch (err) {
      // 409 "already finished" is not a failure: the job simply ended first
      if (err?.response?.status === 409) { setStopStep('requested'); return; }
      stopSent.current = false;                      // nothing reached the server: allow another try
      setStopError(err?.response?.data?.message || 'Could not reach the server to stop sending. Try again.');
      setStopStep('failed');
    }
  };

  const title = !ended
    ? (stopping ? `Stopping ${ch.label} Sending…` : `Sending ${ch.label} Messages`)
    : j.cancelled ? `${ch.label} Sending Cancelled`
    : j.finished ? `${ch.label} Sending Completed`
    : `${ch.label} Sending — tracking stopped`;

  const results = j.results || [];
  const problem = results.filter((r) => r.outcome === 'failed' || r.outcome === 'unconfirmed');
  const shown = view === 'failed' ? problem : view === 'all' ? results : [];

  return createPortal(
    <div className="bs-overlay" role="presentation">
      <div className={`bs-card bs-card--wide ${ch.cls}`} role="dialog" aria-modal="true" aria-labelledby="bs-run-title">
        <div className="bs-head">
          <div className={`bs-icon bs-icon--sm${ended && !j.cancelled ? ' bs-icon--done' : ''}`} aria-hidden="true">
            {ended && !j.cancelled ? <MdCheckCircle size={22} /> : <ch.Icon size={22} />}
          </div>
          <div>
            <h3 className="bs-title bs-title--left" id="bs-run-title">{title}</h3>
            <p className="bs-sub">Channel: {ch.label} · {j.total} recipient{j.total === 1 ? '' : 's'}</p>
          </div>
        </div>

        <div className="bs-progress">
          <div className="bs-progress-top">
            <span>{ended ? 'Processed' : 'Sent'}: <strong>{j.completed}</strong> / {j.total}</span>
            <span className="bs-pct">{pct}%</span>
          </div>
          <div className="bs-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${ch.label} sending progress`}>
            <span className={`bs-bar-fill${ended && !j.cancelled ? ' bs-bar-fill--done' : ''}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="bs-status" aria-live="polite">
            {!ended && (stopping
              ? 'Stopping after the current message — nothing further will be submitted.'
              : j.current ? `Sending to ${j.current}…` : 'Starting…')}
            {ended && j.cancelled && 'Sending was cancelled. Messages already submitted may still be delivered.'}
            {ended && !j.cancelled && j.finished && 'All recipients processed.'}
          </p>
        </div>

        <div className="bs-stats">
          <Stat label="Successful" value={j.sent} cls="ok" hint="Accepted by the provider" />
          <Stat label="Failed" value={j.failed} cls={j.failed ? 'bad' : ''} />
          <Stat label="Unconfirmed" value={j.unconfirmed} cls={j.unconfirmed ? 'warn' : ''} hint="Delivery could not be confirmed" />
          {j.skipped > 0 && <Stat label="Skipped" value={j.skipped} hint="Already sent earlier" />}
          {ended
            ? <Stat label="Not processed" value={j.notProcessed} hint="Never submitted" />
            : <Stat label="Pending" value={j.pending} />}
        </div>

        <p className="bs-note">
          “Successful” means the provider accepted the message.
          {channel === 'whatsapp' ? ' Delivered and Read appear in the WhatsApp logs when receipts arrive.' : ''}
          {j.unconfirmed > 0 ? ' Unconfirmed messages may have been delivered — check before resending.' : ''}
        </p>

        {error && <p className="bs-alert">{error}</p>}
        {stopError && <p className="bs-alert">{stopError}</p>}

        {/* ── stop confirmation, inline ── */}
        {!ended && stopStep === 'confirm' && (
          <div className="bs-confirm-stop" role="alertdialog" aria-label="Confirm cancel sending">
            <p><strong>Stop sending now?</strong> The message being sent right now will finish.
              Messages already submitted cannot be recalled and may still be delivered.</p>
            <div className="bs-actions">
              <button type="button" className="bs-btn bs-btn--ghost" onClick={() => setStopStep('idle')} autoFocus>Keep Sending</button>
              <button type="button" className="bs-btn bs-btn--danger" onClick={doStop}>Yes, Stop Sending</button>
            </div>
          </div>
        )}

        {ended && results.length > 0 && (
          <div className="bs-results">
            <div className="bs-tabs">
              <button type="button" className={`bs-tab${view === 'failed' ? ' bs-tab--on' : ''}`}
                      onClick={() => setView(view === 'failed' ? null : 'failed')} disabled={problem.length === 0}>
                View Failed Recipients ({problem.length})
              </button>
              <button type="button" className={`bs-tab${view === 'all' ? ' bs-tab--on' : ''}`}
                      onClick={() => setView(view === 'all' ? null : 'all')}>
                View All Results ({results.length})
              </button>
            </div>
            {shown.length > 0 && (
              <ul className="bs-list">
                {shown.map((r, i) => {
                  const o = OUTCOME[r.outcome] || OUTCOME.failed;
                  const detail = r.outcome === 'accepted' ? '' : safeDetail(r.reason);
                  return (
                    <li key={`${r.invitation_id}-${i}`} className="bs-row">
                      <div className="bs-row-main">
                        <strong>{r.guest_name || '—'}</strong>
                        <span className="bs-mono">{r.phone || '—'}</span>
                        <span className="bs-chan">{ch.label}</span>
                      </div>
                      <span className={`bs-badge bs-badge--${o.cls}`}><o.Icon size={13} /> {o.label}</span>
                      <p className="bs-reason">{friendlyReason(r, channel)}</p>
                      {detail && <p className="bs-reason-raw">Provider said: {detail}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="bs-actions bs-actions--end">
          {!ended && (
            <>
              <button type="button" className="bs-btn bs-btn--ghost" onClick={onClose} title="The send keeps running; progress stays visible on the page">
                Hide
              </button>
              <button type="button" className="bs-btn bs-btn--danger"
                      onClick={askStop}
                      disabled={stopping || stopStep === 'requesting' || stopStep === 'confirm'}>
                {stopStep === 'requesting' || stopping
                  ? <><MdHourglassEmpty size={15} /> {stopStep === 'requesting' ? 'Cancelling…' : 'Stopping…'}</>
                  : <><MdStopCircle size={15} /> Cancel Sending</>}
              </button>
            </>
          )}
          {ended && onRetryFailed && j.failed > 0 && (
            <button type="button" className="bs-btn bs-btn--ghost" onClick={onRetryFailed}
                    title="Retries definite failures only. Unconfirmed messages are never resent automatically.">
              <MdRefresh size={15} /> Retry Failed
            </button>
          )}
          {ended && <button type="button" className="bs-btn bs-btn--primary" onClick={onClose} autoFocus>Close</button>}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Stat({ label, value, cls = '', hint }) {
  return (
    <div className="bs-stat" title={hint || undefined}>
      <strong className={`bs-stat-val${cls ? ` bs-stat-val--${cls}` : ''}`}>{value}</strong>
      <span className="bs-stat-label">{label}</span>
    </div>
  );
}
