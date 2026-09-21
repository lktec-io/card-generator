import { useState, useEffect, useCallback } from 'react';
import { MdQrCodeScanner, MdKeyboard, MdRefresh, MdHistory } from 'react-icons/md';
import { getVerificationLogs, listUsersDropdown } from '../utils/api';
import { isVerifier } from '../utils/auth';
import '../styles/events.css';
import '../styles/history.css';

function MethodBadge({ method }) {
  return (
    <span className={`method-badge method-badge--${method.toLowerCase()}`}>
      {method === 'QR' ? <MdQrCodeScanner size={12} /> : <MdKeyboard size={12} />}
      {method}
    </span>
  );
}

function formatDateTime(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const verifierLabel = (log) => log.verifier_name || log.verified_by || 'Staff';

export default function VerificationHistoryPage() {
  const mine = isVerifier();              // verifier / gate_staff: own scans only (enforced server-side)

  const [logs,       setLogs]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [staff,      setStaff]      = useState([]);
  const [verifierId, setVerifierId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getVerificationLogs(!mine && verifierId ? { verifier_id: verifierId } : {})
      .then(({ data }) => setLogs(data.logs || []))
      .catch(() => setError('Failed to load verification history.'))
      .finally(() => setLoading(false));
  }, [mine, verifierId]);

  useEffect(load, [load]);

  // Admins: staff list for the "Verified by" filter (existing users dropdown endpoint)
  useEffect(() => {
    if (mine) return;
    listUsersDropdown()
      .then(({ data }) => setStaff(data.users || []))
      .catch(() => setStaff([]));
  }, [mine]);

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        <div className="events-header">
          <div>
            <span className="events-ornament">— Check-in Logs —</span>
            <h1>{mine ? 'My Scan History' : 'Verification History'}</h1>
            <p>{mine ? 'Guests you have checked in' : 'Every QR scan and manual CN check-in'}</p>
          </div>
          <div className="history-actions">
            {!mine && staff.length > 0 && (
              <label className="history-filter">
                <span>Verified by</span>
                <select value={verifierId} onChange={(e) => setVerifierId(e.target.value)}>
                  <option value="">All staff</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role.replace('_', ' ')})` : ''}</option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn-outline" onClick={load} disabled={loading}>
              <MdRefresh size={15} /> {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error && <p className="ef-error">{error}</p>}

        {loading && logs.length === 0 ? (
          <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
        ) : logs.length === 0 ? (
          <div className="events-empty">
            <MdHistory size={52} />
            <h3>{mine ? 'No Scans Yet' : 'No Verifications Yet'}</h3>
            <p>{mine
              ? 'Guests you check in will appear here.'
              : 'Check-in logs will appear here after guests are verified.'}</p>
          </div>
        ) : (
          <div className="ev-inv-section">
            <div className="ev-inv-head">
              <h2>Recent Check-ins</h2>
              <span className="log-count">{logs.length} records</span>
            </div>

            {/* Desktop / tablet: table */}
            <div className="table-scroll history-table">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Guest Name</th>
                    <th>Code</th>
                    <th>Method</th>
                    <th>Event</th>
                    {!mine && <th>Verified By</th>}
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id}>
                      <td className="date-cell">{formatDateTime(log.verified_at)}</td>
                      <td><strong>{log.guest_name}</strong></td>
                      <td><span className="code-cell">{log.invitation_code}</span></td>
                      <td><MethodBadge method={log.verification_method} /></td>
                      <td>{log.event_name || <span className="ev-info-empty">—</span>}</td>
                      {!mine && <td>{verifierLabel(log)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phones: cards, no sideways scrolling */}
            <ul className="history-cards">
              {logs.map(log => (
                <li key={log.id} className="history-card">
                  <div className="history-card-top">
                    <strong className="history-card-name">{log.guest_name}</strong>
                    <span className="code-cell">{log.invitation_code}</span>
                  </div>
                  <div className="history-card-meta">
                    <span>{log.event_name || '—'}</span>
                    <MethodBadge method={log.verification_method} />
                  </div>
                  <div className="history-card-foot">
                    <span>{formatDateTime(log.verified_at)}</span>
                    {!mine && <span>by {verifierLabel(log)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
