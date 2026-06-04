import { useState, useEffect } from 'react';
import { MdRefresh, MdDelete, MdDeleteSweep, MdWarning, MdDownload, MdShare, MdContentCopy, MdOpenInNew, MdVisibility } from 'react-icons/md';
import { API_BASE, getAuthHeaders } from '../utils/api';
import '../styles/admin.css';

function inviteUrl(inv) {
  const base = window.location.origin;
  return inv.invitation_uuid
    ? `${base}/invite/${inv.invitation_uuid}`
    : `${base}/invite/${inv.code}`;
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
  const [deleteModal,    setDeleteModal]    = useState(null);
  const [deleteAllModal, setDeleteAllModal] = useState(false);
  const [copiedCode,     setCopiedCode]     = useState(null);

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${API_BASE}/admin/dashboard`, { headers: getAuthHeaders() });
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

  /* ── Download ── */
  const handleDownload = (inv) => {
    if (!inv.image_url) return;
    const a = document.createElement('a');
    a.href = inv.image_url;
    a.download = `${inv.code} - ${inv.guest_name}.jpg`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* ── Share (native → WhatsApp fallback) with improved Swahili template ── */
  const handleShare = async (inv) => {
    const link      = inviteUrl(inv);
    const eventName = inv.event_name || 'tukio letu';
    const lines = [
      `Habari ${inv.guest_name},`,
      ``,
      `Kwa furaha kubwa tunakukaribisha kushiriki nasi katika hafla yetu ya:`,
      ``,
      `🎉 ${eventName}`,
      ``,
      `Tafadhali fungua kiungo kilicho hapa chini kuona mwaliko wako rasmi, QR Code ya kuingilia na kuthibitisha mahudhurio yako.`,
      ``,
      link,
      ``,
      `Asante sana kwa kuwa sehemu ya siku yetu muhimu.`,
      ``,
      `Karibu sana.`,
    ];
    const fullMessage = lines.join('\n');

    if (navigator.share) {
      try {
        // Remove URL from text to avoid duplication when browser appends url param
        const textOnly = lines.filter(l => l !== link).join('\n');
        await navigator.share({ title: `Mwaliko — ${eventName}`, text: textOnly, url: link });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, '_blank');
  };

  /* ── Copy invitation link (UUID-based) ── */
  const handleCopyLink = (inv) => {
    navigator.clipboard.writeText(inviteUrl(inv)).then(() => setCopiedCode(inv.code));
    setTimeout(() => setCopiedCode(null), 2000);
  };

  /* ── Open guest view ── */
  const handleOpenInvite = (inv) => {
    window.open(inviteUrl(inv), '_blank');
  };

  /* ── Admin preview (with banner) ── */
  const handlePreview = (inv) => {
    const base = window.location.origin;
    const url  = inv.invitation_uuid
      ? `${base}/display/${inv.invitation_uuid}`
      : inviteUrl(inv);
    window.open(url, '_blank');
  };

  /* ── Single delete ── */
  const openDeleteModal   = (inv) => { if (!inv.id) return; setDeleteModal(inv); };
  const cancelDeleteModal = () => setDeleteModal(null);
  const confirmDelete     = async () => {
    const inv = deleteModal;
    setDeleteModal(null);
    setDeleting(inv.id);
    try {
      const res  = await fetch(`${API_BASE}/invitations/${inv.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
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
      const res  = await fetch(`${API_BASE}/invitations`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
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
              <p className="stat-label">Total</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value">{data.stats.used ?? '—'}</p>
              <p className="stat-label">Checked In</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value">{data.stats.unused ?? '—'}</p>
              <p className="stat-label">Pending Entry</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value" style={{ color: '#4ade80' }}>{data.stats.rsvp_attending ?? '—'}</p>
              <p className="stat-label">RSVP Yes</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value" style={{ color: '#fca5a5' }}>{data.stats.rsvp_declined ?? '—'}</p>
              <p className="stat-label">RSVP No</p>
            </div>
            <div className="admin-stat-card">
              <p className="stat-value" style={{ color: '#fbbf24' }}>{data.stats.rsvp_pending ?? '—'}</p>
              <p className="stat-label">No Response</p>
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
                    <th>Phone</th>
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
                      <td className="date-cell">{inv.phone_number || '—'}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="date-cell">{formatDate(inv.created_at)}</td>
                      <td className="date-cell">{formatDate(inv.used_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn-action btn-download"
                            onClick={() => handleDownload(inv)}
                            disabled={!inv.image_url}
                            title="Download card"
                          >
                            <MdDownload size={14} />
                          </button>
                          <button
                            className="btn-action btn-share"
                            onClick={() => handleShare(inv)}
                            title="Share via WhatsApp"
                          >
                            <MdShare size={14} />
                          </button>
                          <button
                            className={`btn-action btn-copy${copiedCode === inv.code ? ' btn-copied' : ''}`}
                            onClick={() => handleCopyLink(inv)}
                            title={copiedCode === inv.code ? 'Copied!' : 'Copy invite link'}
                          >
                            <MdContentCopy size={14} />
                          </button>
                          <button
                            className="btn-action btn-open"
                            onClick={() => handleOpenInvite(inv)}
                            title="Open guest view"
                          >
                            <MdOpenInNew size={14} />
                          </button>
                          <button
                            className="btn-action btn-preview"
                            onClick={() => handlePreview(inv)}
                            title="Admin preview"
                          >
                            <MdVisibility size={14} />
                          </button>
                          <button
                            className="btn-action btn-delete"
                            onClick={() => openDeleteModal(inv)}
                            disabled={deleting === inv.id}
                            title="Delete invitation"
                          >
                            <MdDelete size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {deleteModal && (
        <ConfirmModal
          title="Delete Invitation?"
          message={`Remove ${deleteModal.guest_name} (${deleteModal.code})? This cannot be undone.`}
          confirmLabel="Yes, Delete"
          onConfirm={confirmDelete}
          onCancel={cancelDeleteModal}
        />
      )}

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
