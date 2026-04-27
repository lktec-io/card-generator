import { useState, useEffect } from 'react';
import { MdRefresh, MdDelete, MdDeleteSweep } from 'react-icons/md';
import '../styles/admin.css';

const API_BASE = import.meta.env.VITE_API_URL || 'https://wedding.nardio.online/api';

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
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [deleting,    setDeleting]    = useState(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${API_BASE}/admin/dashboard`);
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

  const handleDelete = async (inv) => {
    if (!inv.id) { alert('Invalid invitation ID.'); return; }
    if (!window.confirm(`Delete invitation for ${inv.guest_name} (${inv.code})?\n\nThis cannot be undone.`)) return;

    setDeleting(inv.id);
    try {
      const res  = await fetch(`${API_BASE}/invitations/${inv.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setData(prev => ({
        ...prev,
        recent: prev.recent.filter(i => i.id !== inv.id),
        stats: {
          total:  (prev.stats.total  || 0) - 1,
          used:   (prev.stats.used   || 0) - (inv.status === 'used'   ? 1 : 0),
          unused: (prev.stats.unused || 0) - (inv.status === 'unused' ? 1 : 0),
        },
      }));
    } catch (err) {
      alert(err.message || 'Failed to delete invitation.');
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL invitations?\n\nThis will permanently remove every record. This cannot be undone.')) return;
    setDeletingAll(true);
    try {
      const res  = await fetch(`${API_BASE}/invitations`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setData(prev => ({ ...prev, recent: [], stats: { total: 0, used: 0, unused: 0 } }));
    } catch (err) {
      alert(err.message || 'Failed to delete all invitations.');
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div className="admin-page page-enter">
      <div className="admin-container">

        <header className="admin-header">
          <div>
            <p className="admin-ornament">— Admin Panel —</p>
            <h1>Admin Dashboard</h1>
            <p className="admin-subtitle">Wedding Invitation Overview</p>
          </div>
          <button className="btn-refresh" onClick={fetchDashboard} disabled={loading}>
            <MdRefresh size={15} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </header>

        {error && <p className="admin-error">{error}</p>}

        {data && (
          <div className="admin-stats-grid">
            <div className="admin-stat-card accent">
              <p className="stat-value">{data.stats.total ?? '—'}</p>
              <p className="stat-label">Total Generated</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value">{data.stats.used ?? '—'}</p>
              <p className="stat-label">Used</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value">{data.stats.unused ?? '—'}</p>
              <p className="stat-label">Unused</p>
            </div>
          </div>
        )}

        <div className="table-wrap">
          <div className="table-heading-row">
            <h2 className="table-heading">Recent Invitations</h2>
            {data && data.recent.length > 0 && (
              <button
                className="btn-delete-all"
                onClick={handleDeleteAll}
                disabled={deletingAll}
                title="Delete all invitations"
              >
                <MdDeleteSweep size={16} />
                {deletingAll ? 'Deleting…' : 'Delete All'}
              </button>
            )}
          </div>

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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((inv) => (
                    <tr key={inv.code}>
                      <td>
                        {inv.image_url ? (
                          <a href={inv.image_url} target="_blank" rel="noreferrer">
                            <img src={inv.image_url} alt={inv.code} className="thumb" />
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
                      <td>
                        <button
                          className="btn-delete"
                          onClick={() => handleDelete(inv)}
                          disabled={deleting === inv.id}
                          aria-label={`Delete ${inv.code}`}
                          title="Delete invitation"
                        >
                          <MdDelete size={16} />
                        </button>
                      </td>
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
