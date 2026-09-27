import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdSend, MdCheckCircle, MdClose, MdErrorOutline } from 'react-icons/md';
import '../styles/send-progress.css';

/**
 * Bulk send progress overlay.
 *
 * Every number shown comes from the server's job state (GET /sms/bulk/progress/:job_id) —
 * nothing here is animated on a timer. `speed` is computed by the caller from real
 * progress samples. The modal stays open on completion until the user closes it.
 *
 * Props:
 *   job    { total, sent, failed, skipped, skipped_no_phone, skipped_already, failures[], done }
 *   speed  number | null   — messages per second, from actual progress over time
 *   onClose () => void     — only offered once the job is done
 */
export default function SendProgressModal({ job, speed, onClose }) {
  const done = !!job?.done;

  // Escape closes, but only after the job has finished
  useEffect(() => {
    if (!job) return;
    const onKey = (e) => { if (e.key === 'Escape' && done) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev || '';
    };
  }, [job, done, onClose]);

  if (!job) return null;

  const total     = Math.max(0, Number(job.total) || 0);
  const sent      = Number(job.sent)   || 0;
  const failed    = Number(job.failed) || 0;
  const skipped   = Number(job.skipped) || 0;
  const processed = sent + failed;
  // Only report 100% when the job itself says it is done
  const pct = done ? 100 : (total > 0 ? Math.min(99, Math.round((processed / total) * 100)) : 0);
  const failures = Array.isArray(job.failures) ? job.failures : [];
  const noPhone  = Number(job.skipped_no_phone) || 0;
  const already  = Number(job.skipped_already)  || 0;

  return createPortal(
    <div className="sp-overlay" role="dialog" aria-modal="true" aria-labelledby="sp-title">
      <div className={`sp-card${done ? ' sp-card--done' : ''}`}>

        <div className={`sp-icon${done ? ' sp-icon--done' : ''}`} aria-hidden="true">
          {done ? <MdCheckCircle size={30} /> : <MdSend size={26} />}
        </div>

        <h3 className="sp-title" id="sp-title">
          {done ? 'Thank You SMS Complete' : 'Sending Thank You SMS'}
        </h3>

        <p className="sp-pct" aria-hidden="true">{pct}%</p>

        <div
          className="sp-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Sending progress"
        >
          <div className={`sp-bar-fill${done ? ' sp-bar-fill--done' : ''}`} style={{ width: `${pct}%` }} />
        </div>

        <p className="sp-line" aria-live="polite">
          {done
            ? `${processed} of ${total} processed`
            : `Sending ${processed} of ${total}`}
        </p>

        {!done && (
          <p className="sp-speed">
            {speed != null && speed > 0 ? `${speed.toFixed(1)} SMS/sec` : 'Starting…'}
          </p>
        )}

        <div className="sp-stats">
          <div className="sp-stat">
            <strong className="sp-stat-val sp-stat-val--ok">{sent}</strong>
            <span className="sp-stat-label">Sent</span>
          </div>
          <div className="sp-stat">
            <strong className={`sp-stat-val${failed > 0 ? ' sp-stat-val--bad' : ''}`}>{failed}</strong>
            <span className="sp-stat-label">Failed</span>
          </div>
          <div className="sp-stat">
            <strong className="sp-stat-val">{skipped}</strong>
            <span className="sp-stat-label">Skipped</span>
          </div>
        </div>

        {skipped > 0 && (
          <p className="sp-note">
            Skipped: {noPhone > 0 && <>{noPhone} without a phone number</>}
            {noPhone > 0 && already > 0 && ' · '}
            {already > 0 && <>{already} already thanked</>}
          </p>
        )}

        {!done && <p className="sp-wait">Please wait — keep this page open.</p>}
        {done  && <p className="sp-wait">All processing completed.</p>}

        {done && failures.length > 0 && (
          <div className="sp-failures">
            <h4 className="sp-failures-title">
              <MdErrorOutline size={14} /> Failed Messages ({failures.length})
            </h4>
            <ul className="sp-failure-list">
              {failures.map((f, i) => (
                <li key={`${f.phone}-${i}`} className="sp-failure">
                  <span className="sp-failure-phone">{f.phone}</span>
                  {f.guest_name && <span className="sp-failure-name">{f.guest_name}</span>}
                  <span className="sp-failure-reason">{f.reason}</span>
                </li>
              ))}
            </ul>
            {failed > failures.length && (
              <p className="sp-note">{failed - failures.length} more failures not listed.</p>
            )}
          </div>
        )}

        {done && (
          <button className="btn-gold sp-close" onClick={onClose} autoFocus>
            <MdClose size={15} /> Close
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
