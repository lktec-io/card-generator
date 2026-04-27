import { useState, useEffect } from 'react';
import { MdRefresh, MdDelete, MdDeleteSweep, MdWarning } from 'react-icons/md';
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

/* ── Reusable confirm modal ─────────────────────────────────────────── */
function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Delete', danger = true }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className={`modal-icon ${danger ? 'modal-icon-danger' : ''}`}>
          <MdWarning size={28} />
        </div>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onCancel}>Cancel</button>
          <button className={`modal-btn-confirm ${danger ? 'modal-btn-danger' : ''}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [data,           setData]           = useState(null);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [deleting,       setDeleting]       = useState(null);
  const [deletingAll,    setDeletingAll]    = useState(false);
  const [deleteModal,    setDeleteModal]    = useState(null);   // inv object | null
  const [deleteAllModal, setDeleteAllModal] = useState(false);

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

  /* ── Single delete ── */
  const openDeleteModal    = (inv) => { if (!inv.id) return; setDeleteModal(inv); };
  const cancelDeleteModal  = () => setDeleteModal(null);
  const confirmDelete      = async () => {
    const inv = deleteModal;
    setDeleteModal(null);
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
      setError(err.message || 'Failed to delete invitation.');
    } finally {
      setDeleting(null);
    }
  };

  /* ── Delete all ── */
  const openDeleteAllModal   = () => setDeleteAllModal(true);
  const cancelDeleteAllModal = () => setDeleteAllModal(false);
  const confirmDeleteAll     = async () => {
    setDeleteAllModal(false);
    setDeletingAll(true);
    try {
      const res  = await fetch(`${API_BASE}/invitations`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      setData(prev => ({ ...prev, recent: [], stats: { total: 0, used: 0, unused: 0 } }));
    } catch (err) {
      setError(err.message || 'Failed to delete all invitations.');
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
                onClick={openDeleteAllModal}
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
                          onClick={() => openDeleteModal(inv)}
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

      {/* ── Single delete modal ── */}
      {deleteModal && (
        <ConfirmModal
          title="Delete Invitation?"
          message={`Remove ${deleteModal.guest_name} (${deleteModal.code})? This cannot be undone.`}
          confirmLabel="Yes, Delete"
          onConfirm={confirmDelete}
          onCancel={cancelDeleteModal}
        />
      )}

      {/* ── Delete all modal ── */}
      {deleteAllModal && (
        <ConfirmModal
          title="Delete All Invitations?"
          message="Every invitation record will be permanently removed. This cannot be undone."
          confirmLabel="Delete All"
          onConfirm={confirmDeleteAll}
          onCancel={cancelDeleteAllModal}
        />
      )}
    </div>
  );
}
