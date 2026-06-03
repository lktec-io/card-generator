import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  MdArrowBack, MdCalendarToday, MdLocationOn, MdPalette,
  MdMap, MdPeople, MdCheckCircle, MdHourglassEmpty,
  MdThumbUp, MdThumbDown, MdDownload, MdShare, MdDelete,
  MdQrCodeScanner, MdEdit, MdSave, MdClose, MdContentCopy,
  MdOpenInNew, MdVisibility, MdGridView, MdViewList, MdAddPhotoAlternate,
} from 'react-icons/md';
import { getEvent, updateEvent, deleteInvitation } from '../utils/api';
import { useToast } from '../context/ToastContext';
import '../styles/events.css';

const EVENT_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

const TYPE_COLORS = {
  'Wedding': '#d4af37', 'Birthday': '#a78bfa', 'Kitchen Party': '#fb923c',
  'Sendoff': '#34d399', 'Graduation': '#60a5fa', 'Conference': '#f87171',
  'Church Event': '#fbbf24', 'Corporate Event': '#94a3b8',
};

function formatDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${status === 'used' ? 'badge-used' : 'badge-unused'}`}>
      {status === 'used' ? 'Checked In' : 'Pending'}
    </span>
  );
}

function inviteLink(inv) {
  const base = window.location.origin;
  return inv.invitation_uuid
    ? `${base}/invite/${inv.invitation_uuid}`
    : `${base}/invite/${inv.code}`;
}

export default function EventDetailPage() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const { showToast } = useToast();

  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [delInvId, setDelInvId] = useState(null);
  const [delInv,   setDelInv]   = useState(null);  // full inv object for modal
  const [invView,  setInvView]  = useState(() => localStorage.getItem('invView') || 'list');

  const load = () => {
    setLoading(true);
    getEvent(id)
      .then(({ data: d }) => { setData(d); setForm(d.event); })
      .catch(() => setError('Failed to load event.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const switchInvView = (v) => {
    setInvView(v);
    localStorage.setItem('invView', v);
  };

  /* ── Save event edits ── */
  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEvent(id, form);
      setEditing(false);
      load();
      showToast('Event updated.', 'success');
    } catch {
      showToast('Failed to update event.', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* ── Blob download — direct file, not new tab ── */
  const handleDownload = async (inv) => {
    if (!inv.image_url) { showToast('No card image available.', 'info'); return; }
    try {
      const res  = await fetch(inv.image_url);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${inv.code}-${(inv.guest_name || '').replace(/\s+/g, '-')}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(inv.image_url, '_blank');
    }
  };

  /* ── Native share → WhatsApp fallback ── */
  const handleShare = async (inv) => {
    const url       = inviteLink(inv);
    const eventName = data?.event?.event_name || 'tukio letu';
    const message   = [
      `Habari ${inv.guest_name},`,
      ``,
      `Tunafurahi kukualika kwenye ${eventName}.`,
      ``,
      `Tafadhali bofya link hapa kuthibitisha mahudhurio yako:`,
      ``,
      url,
      ``,
      `Asante.`,
    ].join('\n');

    if (navigator.share) {
      try {
        await navigator.share({ title: `Mwaliko wa ${inv.guest_name}`, text: message, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  /* ── Copy invite link ── */
  const handleCopyLink = (inv) => {
    const url = inviteLink(inv);
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied successfully!', 'success'))
      .catch(() => showToast('Failed to copy.', 'error'));
  };

  /* ── Open guest view ── */
  const handleOpen = (inv) => window.open(inviteLink(inv), '_blank');

  /* ── Admin preview (with banner) ── */
  const handlePreview = (inv) => {
    const base = window.location.origin;
    const url  = inv.invitation_uuid
      ? `${base}/display/${inv.invitation_uuid}`
      : inviteLink(inv);
    window.open(url, '_blank');
  };

  /* ── Delete invitation ── */
  const openDelModal  = (inv) => { setDelInvId(inv.id); setDelInv(inv); };
  const closeDelModal = () => { setDelInvId(null); setDelInv(null); };

  const handleDeleteInv = async () => {
    try {
      await deleteInvitation(delInvId);
      setData(prev => ({
        ...prev,
        invitations: prev.invitations.filter(i => i.id !== delInvId),
      }));
      showToast('Invitation deleted.', 'success');
    } catch {
      showToast('Failed to delete invitation.', 'error');
    } finally {
      closeDelModal();
    }
  };

  /* ── Action buttons shared between list and grid ── */
  const ActionButtons = ({ inv }) => (
    <div className="row-actions">
      <button className="btn-action btn-download" onClick={() => handleDownload(inv)} disabled={!inv.image_url} title="Download card">
        <MdDownload size={14} />
      </button>
      <button className="btn-action btn-share"   onClick={() => handleShare(inv)}   title="Share">
        <MdShare size={14} />
      </button>
      <button className="btn-action btn-copy"    onClick={() => handleCopyLink(inv)} title="Copy invite link">
        <MdContentCopy size={14} />
      </button>
      <button className="btn-action btn-open"    onClick={() => handleOpen(inv)}    title="Open guest view">
        <MdOpenInNew size={14} />
      </button>
      <button className="btn-action btn-preview" onClick={() => handlePreview(inv)} title="Admin preview">
        <MdVisibility size={14} />
      </button>
      <button className="btn-action btn-delete"  onClick={() => openDelModal(inv)}  title="Delete">
        <MdDelete size={14} />
      </button>
    </div>
  );

  /* ── Loading / error states ── */
  if (loading) return (
    <div className="events-page page-enter">
      <div className="events-container">
        <div className="events-loading"><div className="ev-spinner" /> Loading…</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="events-page page-enter">
      <div className="events-container">
        <p className="ef-error">{error}</p>
        <button className="btn-outline" onClick={() => navigate('/events')}>Back to Events</button>
      </div>
    </div>
  );

  const ev    = data?.event;
  const invs  = data?.invitations || [];
  const stats = data?.stats || {};
  const rsvp  = data?.rsvp  || {};

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        {/* ── Breadcrumb ── */}
        <button className="ev-back" onClick={() => navigate('/events')}>
          <MdArrowBack size={16} /> Events
        </button>

        {/* ── Event header ── */}
        <div className="ev-detail-header">
          <div className="ev-detail-title">
            <span className="events-ornament">— {ev?.event_type} —</span>
            {editing ? (
              <input
                className="ev-name-edit"
                value={form.event_name || ''}
                onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))}
              />
            ) : (
              <h1>{ev?.event_name}</h1>
            )}
          </div>
          <div className="ev-detail-actions">
            {editing ? (
              <>
                <button className="btn-gold" onClick={handleSave} disabled={saving}>
                  <MdSave size={15} /> {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-outline" onClick={() => { setEditing(false); setForm(ev); }}>
                  <MdClose size={15} /> Cancel
                </button>
              </>
            ) : (
              <button className="btn-outline" onClick={() => setEditing(true)}>
                <MdEdit size={15} /> Edit Event
              </button>
            )}
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="ev-stats-row">
          <div className="ev-mini-stat"><MdPeople size={18}/><span>{stats.total ?? 0}</span><label>Invited</label></div>
          <div className="ev-mini-stat ev-mini--green"><MdCheckCircle size={18}/><span>{stats.checked_in ?? 0}</span><label>Checked In</label></div>
          <div className="ev-mini-stat"><MdHourglassEmpty size={18}/><span>{stats.pending ?? 0}</span><label>Pending</label></div>
          <div className="ev-mini-stat ev-mini--green"><MdThumbUp size={18}/><span>{rsvp.attending ?? 0}</span><label>RSVP Yes</label></div>
          <div className="ev-mini-stat ev-mini--red"><MdThumbDown size={18}/><span>{rsvp.declined ?? 0}</span><label>RSVP No</label></div>
        </div>

        {/* ── Event info ── */}
        <div className="ev-info-grid">
          <div className="ev-info-card">
            <h3>Event Details</h3>
            <div className="ev-info-rows">
              {editing ? (
                <>
                  <div className="ev-info-edit-row">
                    <label>Type</label>
                    <select value={form.event_type || ''} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                      {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Date</label>
                    <input type="date" value={(form.event_date || '').split('T')[0]} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Venue</label>
                    <input value={form.venue || ''} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} placeholder="Venue" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Maps Link</label>
                    <input value={form.maps_link || ''} onChange={e => setForm(f => ({ ...f, maps_link: e.target.value }))} placeholder="Google Maps URL" />
                  </div>
                </>
              ) : (
                <>
                  {ev?.event_date && <div className="ev-info-row"><MdCalendarToday size={15}/><span>{formatDate(ev.event_date)}</span></div>}
                  {ev?.venue      && <div className="ev-info-row"><MdLocationOn size={15}/><span>{ev.venue}</span></div>}
                  {ev?.maps_link  && (
                    <div className="ev-info-row">
                      <MdMap size={15}/>
                      <a href={ev.maps_link} target="_blank" rel="noreferrer" className="ev-maps-link">
                        Open Directions
                      </a>
                    </div>
                  )}
                  {!ev?.event_date && !ev?.venue && <p className="ev-info-empty">No details added</p>}
                </>
              )}
            </div>
          </div>

          <div className="ev-info-card">
            <h3>Dress Code</h3>
            {editing ? (
              <div className="ev-info-rows">
                <div className="ev-info-edit-row">
                  <label>Main Color</label>
                  <input value={form.dress_code_main || ''} onChange={e => setForm(f => ({ ...f, dress_code_main: e.target.value }))} placeholder="e.g. Royal Blue" />
                </div>
                <div className="ev-info-edit-row">
                  <label>Secondary</label>
                  <input value={form.dress_code_secondary || ''} onChange={e => setForm(f => ({ ...f, dress_code_secondary: e.target.value }))} placeholder="e.g. Gold" />
                </div>
                <div className="ev-info-edit-row">
                  <label>Notes</label>
                  <textarea value={form.dress_code_notes || ''} onChange={e => setForm(f => ({ ...f, dress_code_notes: e.target.value }))} rows={3} />
                </div>
              </div>
            ) : (
              <div className="dress-code-display">
                {ev?.dress_code_main && (
                  <div className="dress-color-row">
                    <span className="dress-swatch" />
                    <span>{ev.dress_code_main}</span>
                  </div>
                )}
                {ev?.dress_code_secondary && (
                  <div className="dress-color-row">
                    <span className="dress-swatch dress-swatch--secondary" />
                    <span>{ev.dress_code_secondary}</span>
                  </div>
                )}
                {ev?.dress_code_notes && <p className="dress-notes">{ev.dress_code_notes}</p>}
                {!ev?.dress_code_main && !ev?.dress_code_notes && (
                  <p className="ev-info-empty">No dress code specified</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Invitations section ── */}
        <div className="ev-inv-section">
          <div className="ev-inv-head">
            <h2>Invitations ({invs.length})</h2>
            <div className="ev-inv-toolbar">
              {/* View toggle */}
              <div className="view-toggle">
                <button
                  className={`view-toggle-btn${invView === 'list' ? ' active' : ''}`}
                  onClick={() => switchInvView('list')}
                  title="List view"
                >
                  <MdViewList size={18} />
                </button>
                <button
                  className={`view-toggle-btn${invView === 'grid' ? ' active' : ''}`}
                  onClick={() => switchInvView('grid')}
                  title="Grid view"
                >
                  <MdGridView size={18} />
                </button>
              </div>
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <MdAddPhotoAlternate size={15} /> Add Invitations
              </button>
            </div>
          </div>

          {invs.length === 0 ? (
            <div className="events-empty" style={{ padding: '3rem 1rem' }}>
              <MdPeople size={48} style={{ opacity: 0.25 }} />
              <h3>No Invitations Yet</h3>
              <p>Add invitations to start tracking guests.</p>
              <button className="btn-gold" onClick={() => navigate(`/create?event=${id}`)}>
                <MdAddPhotoAlternate size={15} /> Create First Invitation
              </button>
            </div>
          ) : invView === 'list' ? (
            /* ── LIST VIEW ── */
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Card</th><th>Code</th><th>Guest Name</th>
                    <th>RSVP</th><th>Status</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invs.map(inv => (
                    <tr key={inv.id}>
                      <td>
                        {inv.image_url
                          ? <a href={inv.image_url} target="_blank" rel="noreferrer"><img src={inv.image_url} alt={inv.code} className="thumb" /></a>
                          : <span className="no-thumb">—</span>}
                      </td>
                      <td><span className="code-cell">{inv.code}</span></td>
                      <td><strong>{inv.guest_name}</strong></td>
                      <td>
                        {inv.rsvp_response ? (
                          <span className={`rsvp-mini rsvp-mini--${inv.rsvp_response}`}>
                            {inv.rsvp_response === 'attending' ? '✓ Yes' : '✗ No'}
                          </span>
                        ) : <span className="rsvp-mini rsvp-mini--none">—</span>}
                      </td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="date-cell">{formatDateTime(inv.created_at)}</td>
                      <td><ActionButtons inv={inv} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── GRID VIEW ── */
            <div className="inv-grid">
              {invs.map(inv => (
                <div key={inv.id} className="inv-grid-card">
                  {/* Card image */}
                  <div className="inv-grid-img">
                    {inv.image_url
                      ? <img src={inv.image_url} alt={inv.code} />
                      : <div className="inv-grid-no-img"><MdAddPhotoAlternate size={28} /></div>
                    }
                  </div>
                  {/* Info */}
                  <div className="inv-grid-body">
                    <p className="inv-grid-name">{inv.guest_name}</p>
                    <div className="inv-grid-meta">
                      <span className="code-cell">{inv.code}</span>
                      <StatusBadge status={inv.status} />
                      {inv.rsvp_response && (
                        <span className={`rsvp-mini rsvp-mini--${inv.rsvp_response}`}>
                          {inv.rsvp_response === 'attending' ? '✓ RSVP Yes' : '✗ RSVP No'}
                        </span>
                      )}
                    </div>
                    <ActionButtons inv={inv} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* ── Delete invitation modal ── */}
      {delInvId && delInv && (
        <div className="modal-overlay" onClick={closeDelModal}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-icon modal-icon-danger">
              <MdDelete size={26} />
            </div>
            <h3 className="modal-title">Delete Invitation?</h3>
            <p className="modal-message">
              Remove <strong>{delInv.guest_name}</strong> ({delInv.code})?
              <br />This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={closeDelModal}>Cancel</button>
              <button className="modal-btn-confirm modal-btn-danger" onClick={handleDeleteInv}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
