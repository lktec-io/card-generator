import { useState, useEffect } from 'react';
import '../styles/admin.css';

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card${accent ? ' accent' : ''}`}>
      <p className="stat-value">{value ?? '—'}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status === 'used' ? 'badge-used' : 'badge-unused'}`}>
      {status === 'used' ? 'Used' : 'Unused'}
    </span>
  );
}

function formatDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/dashboard');
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setData(json);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDashboard(); }, []);

  return (
    <div className="admin-page">
      <div className="admin-container">

        <header className="admin-header">
          <div>
            <p className="admin-ornament">✦ &nbsp; ✦ &nbsp; ✦</p>
            <h1>Admin Dashboard</h1>
            <p className="admin-subtitle">Wedding Invitation Overview</p>
          </div>
          <button className="btn-refresh" onClick={fetchDashboard} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </header>

        {error && <p className="admin-error">{error}</p>}

        {/* Stats */}
        {data && (
          <div className="stats-grid">
            <StatCard label="Total Generated" value={data.stats.total}  accent />
            <StatCard label="Used"            value={data.stats.used} />
            <StatCard label="Unused"          value={data.stats.unused} />
          </div>
        )}

        {/* Table */}
        <div className="table-wrap">
          <h2 className="table-heading">Recent Invitations</h2>

          {loading && !data && (
            <div className="table-loading">
              <div className="admin-spinner" />
              <p>Loading…</p>
            </div>
          )}

          {data && data.recent.length === 0 && (
            <p className="table-empty">No invitations generated yet.</p>
          )}

          {data && data.recent.length > 0 && (
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Card</th>
                    <th>Code</th>
                    <th>Guest Name</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Scanned At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((inv) => (
                    <tr key={inv.code}>
                      <td>
                        {inv.image_url ? (
                          <a href={inv.image_url} target="_blank" rel="noreferrer">
                            <img
                              src={inv.image_url}
                              alt={inv.code}
                              className="thumb"
                            />
                          </a>
                        ) : (
                          <span className="no-thumb">—</span>
                        )}
                      </td>
                      <td><span className="code-cell">{inv.code}</span></td>
                      <td>{inv.guest_name}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="date-cell">{formatDate(inv.created_at)}</td>
                      <td className="date-cell">{formatDate(inv.used_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
