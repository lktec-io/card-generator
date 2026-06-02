import { useState, useEffect } from 'react';
import { MdQrCodeScanner, MdKeyboard, MdRefresh, MdHistory } from 'react-icons/md';
import { getVerificationLogs } from '../utils/api';
import '../styles/events.css';

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

export default function VerificationHistoryPage() {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    getVerificationLogs()
      .then(({ data }) => setLogs(data.logs || []))
      .catch(() => setError('Failed to load verification history.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        <div className="events-header">
          <div>
            <span className="events-ornament">— Check-in Logs —</span>
            <h1>Verification History</h1>
            <p>Every QR scan and manual CN check-in</p>
          </div>
          <button className="btn-outline" onClick={load} disabled={loading}>
            <MdRefresh size={15} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && <p className="ef-error">{error}</p>}

        {loading && logs.length === 0 ? (
          <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
        ) : logs.length === 0 ? (
          <div className="events-empty">
            <MdHistory size={52} />
            <h3>No Verifications Yet</h3>
            <p>Check-in logs will appear here after guests are verified.</p>
          </div>
        ) : (
          <div className="ev-inv-section">
            <div className="ev-inv-head">
              <h2>Recent Check-ins</h2>
              <span className="log-count">{logs.length} records</span>
            </div>
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Guest Name</th>
                    <th>Code</th>
                    <th>Method</th>
                    <th>Event</th>
                    <th>Verified By</th>
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
                      <td>{log.verified_by || 'Staff'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
