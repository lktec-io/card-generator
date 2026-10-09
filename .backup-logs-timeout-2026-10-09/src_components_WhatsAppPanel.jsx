import { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageCircle, Send, RefreshCw, Search, Users, LoaderCircle,
  TriangleAlert, ChevronLeft, ChevronRight, CircleAlert,
} from 'lucide-react';
import {
  getWhatsAppSummary, sendWhatsAppBulk, getWhatsAppProgress,
  retryWhatsAppFailed, getWhatsAppLogs,
} from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/whatsapp.css';

const STATUS_FILTERS = ['all', 'pending', 'sending', 'accepted', 'sent', 'delivered', 'read', 'failed'];
const PAGE_SIZE = 25;
// A campaign is watched for at most this long. Beyond it the poll stops and
// says so, rather than spinning for the life of the tab.
const POLL_DEADLINE_MS = 15 * 60 * 1000;

/** What each status actually means, so "accepted" is never read as "delivered". */
const STATUS_HELP = {
  pending:   'Queued here, not yet handed to Beem',
  sending:   'Being handed to Beem now',
  accepted:  'Beem accepted the job — not yet confirmed delivered',
  sent:      'Beem reports it left for WhatsApp',
  delivered: 'WhatsApp confirmed delivery to the handset',
  read:      'The guest opened it (only when Beem sends a read receipt)',
  failed:    'Rejected or undeliverable — see the reason in the log',
};

/**
 * Say what actually went wrong. A request that never reached the application
 * carries no JSON message, so the status (or the absence of a response) has to
 * speak instead of a generic phrase.
 */
function describeError(err, fallback) {
  if (!err.response) {
    return err.code === 'ECONNABORTED'
      ? 'The server did not respond in time. Nothing was started — try again.'
      : `${fallback} The server could not be reached (${err.message}).`;
  }
  const data = err.response.data;
  if (data && typeof data === 'object' && data.message) return data.message;
  if (err.response.status === 413) return 'The request was rejected as too large before it reached the application.';
  return `${fallback} Server replied HTTP ${err.response.status}.`;
}

const fmt = (ts) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

/**
 * WhatsApp for one event.
 *
 * Every number shown comes from the server for THIS event id — the summary is a
 * GROUP BY on whatsapp_logs, not anything counted in the browser — so figures
 * from another event can never appear here.
 */
export default function WhatsAppPanel({ eventId, selectedIds = [], onClearSelection }) {
  const { showToast } = useToast();

  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [job, setJob]           = useState(null);
  const [jobId, setJobId]       = useState(null);
  const [jobDone, setJobDone]   = useState(false);   // stops the poll for good
  const [pollError, setPollError] = useState('');
  const [busy, setBusy]         = useState(false);
  // Separate slots: the summary and the logs load independently, so a
  // successful log search must not clear a summary failure (or the reverse).
  const [summaryError, setSummaryError] = useState('');
  const [logsError,    setLogsError]    = useState('');

  const [logs, setLogs]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [page, setPage]       = useState(1);
  const [query, setQuery]     = useState('');
  const [status, setStatus]   = useState('all');
  const [logsLoading, setLogsLoading] = useState(false);

  const sendGuard = useRef(false);     // one click = one campaign
  const logSeq    = useRef(0);         // discards superseded log responses

  const configured = summary?.whatsapp?.configured;

  const loadSummary = useCallback(() => {
    if (!eventId) return;
    getWhatsAppSummary(eventId)
      .then(({ data }) => { setSummary(data); setSummaryError(''); })
      .catch((err) => {
        setSummary(null);
        // A failure here used to leave the panel looking simply empty.
        setSummaryError(err.response?.data?.message
          || (err.code === 'ECONNABORTED'
            ? 'The server did not respond in time. Reload to try again.'
            : `Could not load the WhatsApp summary (${err.response?.status || err.message}).`));
      })
      // always cleared, so "Loading…" cannot outlive the request
      .finally(() => setLoading(false));
  }, [eventId]);

  const loadLogs = useCallback(() => {
    if (!eventId) return;
    const seq = ++logSeq.current;
    setLogsLoading(true);
    getWhatsAppLogs(eventId, { q: query, status, page, pageSize: PAGE_SIZE })
      .then(({ data }) => {
        if (seq !== logSeq.current) return;        // a newer search already won
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
        setLogsError('');
      })
      .catch((err) => {
        if (seq !== logSeq.current) return;
        setLogs([]); setTotal(0); setPages(1);
        setLogsError(err.response?.data?.message
          || (err.code === 'ECONNABORTED'
            ? 'The log search timed out. Narrow the search or try again.'
            : 'Could not load the WhatsApp logs.'));
      })
      .finally(() => { if (seq === logSeq.current) setLogsLoading(false); });
  }, [eventId, query, status, page]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  /* Search is debounced and runs on the server — the browser never filters. */
  useEffect(() => {
    const t = setTimeout(loadLogs, 300);
    return () => clearTimeout(t);
  }, [loadLogs]);

  /* Latest callbacks, held in refs so the poll below depends only on the job id.
     Previously the interval was torn down and restarted — firing an extra
     immediate poll — every time the search box or page number changed. */
  const loadSummaryRef = useRef(loadSummary);
  const loadLogsRef    = useRef(loadLogs);
  const toastRef       = useRef(showToast);
  useEffect(() => { loadSummaryRef.current = loadSummary; }, [loadSummary]);
  useEffect(() => { loadLogsRef.current = loadLogs; }, [loadLogs]);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);

  /**
   * Real campaign progress, polled from the job the backend is running.
   *
   * Three things keep this from spinning forever:
   *   - it depends on the job id alone, so it is created once per campaign
   *   - one poll at a time; a slow response never stacks another on top
   *   - a hard deadline, so a job that never reports finished still stops
   */
  useEffect(() => {
    if (!jobId || jobDone) return undefined;

    let alive = true;
    let inFlight = false;
    const startedAt = Date.now();

    const stop = (reason) => {
      sendGuard.current = false;
      setJobDone(true);
      if (reason) setPollError(reason);
    };

    const tick = async () => {
      if (!alive || inFlight) return;             // never overlap
      if (Date.now() - startedAt > POLL_DEADLINE_MS) {
        stop('Stopped watching this campaign after 15 minutes. It may still be running — reload to see the latest counts.');
        return;
      }
      inFlight = true;
      try {
        const { data } = await getWhatsAppProgress(jobId);
        if (!alive) return;
        setJob(data);
        setPollError('');
        if (data.finished) {
          stop(null);
          toastRef.current(
            data.failed
              ? `WhatsApp: ${data.sent} sent, ${data.failed} failed${data.skipped ? `, ${data.skipped} skipped` : ''}.`
              : `WhatsApp: all ${data.sent} sent${data.skipped ? `, ${data.skipped} already sent` : ''}.`,
            data.failed ? 'error' : 'success'
          );
          loadSummaryRef.current();
          loadLogsRef.current();
        }
      } catch (err) {
        if (!alive) return;
        // 404 means the job is gone (API restarted) — the messages already sent
        // are in the logs, so stop and say so rather than polling a ghost.
        const gone = err.response?.status === 404;
        setJob((j) => ({ ...(j || {}), finished: true }));
        stop(gone
          ? 'This campaign is no longer being tracked (the API restarted). The WhatsApp logs below show what was actually sent.'
          : err.response?.data?.message || 'Lost contact with the campaign. The logs below show what was sent.');
        loadSummaryRef.current();
        loadLogsRef.current();
      } finally {
        inFlight = false;                          // always released
      }
    };

    const id = setInterval(tick, 1500);
    tick();
    return () => { alive = false; clearInterval(id); };
  }, [jobId, jobDone]);

  const beginJob = (data) => {
    setPollError('');
    setJobDone(false);                 // arm the poll for this campaign
    setJobId(data.job_id);
    setJob({ total: data.total, completed: 0, sent: 0, failed: 0, skipped: 0, percent: 0, finished: false, failures: [] });
  };

  /**
   * A start that fails must always release the guard and the busy flag, or the
   * buttons stay disabled with nothing running — which reads as "stuck".
   */
  const startCampaign = async (ids = null) => {
    if (sendGuard.current || busy) return;
    sendGuard.current = true;
    setBusy(true);
    try {
      const { data } = await sendWhatsAppBulk(eventId, ids);
      beginJob(data);
      if (ids && onClearSelection) onClearSelection();
    } catch (err) {
      sendGuard.current = false;
      showToast(describeError(err, 'Could not start the WhatsApp campaign.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    if (sendGuard.current || busy) return;
    sendGuard.current = true;
    setBusy(true);
    try {
      const { data } = await retryWhatsAppFailed(eventId);
      beginJob(data);
      showToast(`Retrying ${data.retrying} failed message${data.retrying > 1 ? 's' : ''}…`, 'success');
    } catch (err) {
      sendGuard.current = false;
      showToast(describeError(err, 'Could not start the retry.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const counts  = summary?.counts || {};
  const running = Boolean(job && !job.finished);

  if (loading) {
    return (
      <section className="wa-panel">
        <h3 className="wa-title"><MessageCircle size={17} /> WhatsApp</h3>
        <p className="wa-muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="wa-panel">
      <div className="wa-head">
        <h3 className="wa-title"><MessageCircle size={17} /> WhatsApp</h3>
        {summary?.whatsapp?.template_id && (
          <span className="wa-chip" title="Approved WhatsApp template in use">
            template: {summary.whatsapp.template_id} · {summary.whatsapp.language}
          </span>
        )}
      </div>

      {!configured && (
        <p className="wa-alert wa-alert--warn">
          <TriangleAlert size={16} />
          <span>
            WhatsApp is not switched on yet. Add{' '}
            <code>{(summary?.whatsapp?.missing || []).join(', ') || 'the Beem WhatsApp settings'}</code>{' '}
            to the server environment and restart the API. Everything else here is ready.
          </span>
        </p>
      )}

      {(summary?.whatsapp?.warnings || []).map((w) => (
        <p key={w} className="wa-alert wa-alert--warn"><TriangleAlert size={16} /><span>{w}</span></p>
      ))}

      {summaryError && (
        <p className="wa-alert wa-alert--error"><CircleAlert size={16} /><span>{summaryError}</span></p>
      )}

      {/* ── campaign summary: real values from whatsapp_logs for this event ── */}
      <div className="wa-tiles">
        <div className="wa-tile"><span className="wa-n">{summary?.total ?? 0}</span><span className="wa-l">Total</span></div>
        <div className="wa-tile"><span className="wa-n">{counts.pending ?? 0}</span><span className="wa-l">Pending</span></div>
        <div className="wa-tile"><span className="wa-n">{counts.sending ?? 0}</span><span className="wa-l">Sending</span></div>
        <div className="wa-tile wa-tile--info" title={STATUS_HELP.accepted}><span className="wa-n">{counts.accepted ?? 0}</span><span className="wa-l">Accepted</span></div>
        <div className="wa-tile wa-tile--ok" title={STATUS_HELP.delivered}><span className="wa-n">{counts.delivered ?? 0}</span><span className="wa-l">Delivered</span></div>
        <div className="wa-tile wa-tile--read" title={STATUS_HELP.read}><span className="wa-n">{counts.read ?? 0}</span><span className="wa-l">Read</span></div>
        <div className="wa-tile wa-tile--bad"><span className="wa-n">{counts.failed ?? 0}</span><span className="wa-l">Failed</span></div>
      </div>

      {/* ── actions ── */}
      <div className="wa-actions">
        <button
          type="button"
          className="btn-wa"
          disabled={!configured || running || busy || !(summary?.eligible_guests)}
          onClick={() => startCampaign(null)}
          title={configured ? 'Send the WhatsApp invitation to every guest with a phone number' : 'WhatsApp is not configured'}
        >
          {running ? <LoaderCircle size={15} className="wa-spin" /> : <MessageCircle size={15} />}
          Send WhatsApp to All
          {summary?.eligible_guests ? <span className="wa-count">{summary.eligible_guests}</span> : null}
        </button>

        <button
          type="button"
          className="btn-wa btn-wa--ghost"
          disabled={!configured || running || busy || selectedIds.length === 0}
          onClick={() => startCampaign(selectedIds)}
          title={selectedIds.length ? `Send to the ${selectedIds.length} selected guest(s)` : 'Select guests in the list first'}
        >
          <Send size={15} /> Send WhatsApp to Selected
          {selectedIds.length > 0 && <span className="wa-count">{selectedIds.length}</span>}
        </button>

        <button
          type="button"
          className="btn-wa btn-wa--ghost"
          disabled={!configured || running || busy || !(counts.failed > 0)}
          onClick={retryFailed}
          title="Retry only the messages that failed"
        >
          <RefreshCw size={15} /> Retry Failed
          {counts.failed > 0 && <span className="wa-count">{counts.failed}</span>}
        </button>
      </div>

      {/* ── live progress (real backend counters) ── */}
      {job && (
        <div className="wa-progress">
          <div className="wa-progress-top">
            <strong>{job.completed ?? 0}</strong> / {job.total ?? 0}
            <span className="wa-muted">
              {job.sent ?? 0} sent · {job.failed ?? 0} failed{job.skipped ? ` · ${job.skipped} skipped` : ''}
            </span>
          </div>
          <div className="wa-bar" role="progressbar" aria-valuenow={job.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${job.percent ?? 0}%` }} />
          </div>
          {!job.finished && !jobDone && job.current_guest && <p className="wa-muted">Sending to {job.current_guest}…</p>}
          {pollError && <p className="wa-alert wa-alert--warn"><TriangleAlert size={16} /><span>{pollError}</span></p>}
          {(job.finished || jobDone) && (
            <p className="wa-muted">
              Accepted by Beem is not the same as delivered. Delivered and Read appear
              only when Beem sends the matching receipt.
            </p>
          )}
          {job.finished && job.failures?.length > 0 && (
            <ul className="wa-failures">
              {job.failures.slice(0, 6).map((f) => (
                <li key={f.invitation_id}>
                  <CircleAlert size={13} /> <strong>{f.guest_name}</strong> — {f.reason}
                </li>
              ))}
              {job.failures.length > 6 && <li className="wa-muted">…and {job.failures.length - 6} more, listed below.</li>}
            </ul>
          )}
        </div>
      )}

      {/* ── logs: searched, filtered and paged on the server ── */}
      <div className="wa-logs">
        <div className="wa-logs-head">
          <h4><Users size={15} /> WhatsApp Logs <span className="wa-muted">({total})</span></h4>
          <div className="wa-search">
            <Search size={15} />
            <input
              type="search"
              value={query}
              placeholder="Guest, phone, CN, job ID…"
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              aria-label="Search WhatsApp logs"
            />
          </div>
        </div>

        <div className="wa-filters" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={`wa-filter${status === s ? ' wa-filter--on' : ''}`}
              onClick={() => { setStatus(s); setPage(1); }}
            >
              {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {logsError && (
          <p className="wa-alert wa-alert--error"><CircleAlert size={16} /><span>{logsError}</span></p>
        )}

        <div className="wa-table-wrap">
          <table className="wa-table">
            <thead>
              <tr><th>Guest</th><th>Phone</th><th>CN</th><th>Status</th><th>Updated</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {logsLoading && <tr><td colSpan={6} className="wa-muted">Searching…</td></tr>}
              {!logsLoading && logs.length === 0 && (
                <tr><td colSpan={6} className="wa-muted">
                  {query || status !== 'all' ? 'Nothing matches that search.' : 'No WhatsApp messages for this event yet.'}
                </td></tr>
              )}
              {!logsLoading && logs.map((l) => (
                <tr key={l.id}>
                  <td>{l.guest_name || '—'}</td>
                  <td className="wa-mono">{l.phone_number}</td>
                  <td className="wa-mono">{l.invitation_code || '—'}</td>
                  <td><span className={`wa-status wa-status--${l.status}`} title={STATUS_HELP[l.status] || l.status}>{l.status}</span></td>
                  <td className="wa-mono">{fmt(l.read_at || l.delivered_at || l.failed_at || l.sent_at || l.created_at)}</td>
                  <td className="wa-detail">{l.error_message || l.beem_job_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="wa-pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page">
              <ChevronLeft size={15} />
            </button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} aria-label="Next page">
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
