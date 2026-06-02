import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MdArrowBack, MdCalendarToday, MdLocationOn, MdPalette,
  MdMap, MdPeople, MdCheckCircle, MdHourglassEmpty,
  MdThumbUp, MdThumbDown, MdDownload, MdShare, MdDelete,
  MdQrCodeScanner, MdEdit, MdSave, MdClose,
} from 'react-icons/md';
import { getEvent, updateEvent, deleteInvitation, getAuthHeaders, API_BASE } from '../utils/api';
import '../styles/events.css';

const EVENT_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

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

export default function EventDetailPage() {
  const { id }    = useParams();
  const navigate  = useNavigate();

  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState(false);
  const [form,     setForm]     = useState({});
  const [saving,   setSaving]   = useState(false);
  const [delInvId, setDelInvId] = useState(null);

  const load = () => {
    setLoading(true);
    getEvent(id)
      .then(({ data: d }) => { setData(d); setForm(d.event); })
      .catch(() => setError('Failed to load event.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateEvent(id, form);
      setEditing(false);
      load();
    } catch {
      alert('Failed to update event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteInv = async () => {
    try {
      await deleteInvitation(delInvId);
      setData(prev => ({
        ...prev,
        invitations: prev.invitations.filter(i => i.id !== delInvId),
      }));
    } catch {
      alert('Failed to delete invitation.');
    } finally {
      setDelInvId(null);
    }
  };

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

  const handleShare = (inv) => {
    const inviteUrl = `${window.location.origin}/invite/${inv.code}`;
    const lines = [
      `🎉 Invitation: ${data?.event?.event_name}`,
      `👤 Guest: ${inv.guest_name}`,
      `🔖 Code: ${inv.code}`,
      `🔗 ${inviteUrl}`,
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`, '_blank');
  };

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

  const ev   = data?.event;
  const invs = data?.invitations || [];
  const stats = data?.stats  || {};
  const rsvp  = data?.rsvp   || {};

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

        {/* ── Event info / edit ── */}
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
                    <span className="dress-swatch" style={{ background: ev.dress_code_main.toLowerCase() === 'royal blue' ? '#4169e1' : 'var(--gold)' }} />
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

        {/* ── Invitations table ── */}
        <div className="ev-inv-section">
          <div className="ev-inv-head">
            <h2>Invitations ({invs.length})</h2>
            <button className="btn-gold" onClick={() => navigate('/create')}>
              <MdQrCodeScanner size={15} /> Add Invitations
            </button>
          </div>

          {invs.length === 0 ? (
            <div className="events-empty" style={{ padding: '2rem' }}>
              <p>No invitations for this event yet.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Card</th><th>Code</th><th>Guest Name</th>
                    <th>Status</th><th>Created</th><th>Checked In</th><th></th>
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
                      <td>{inv.guest_name}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="date-cell">{formatDateTime(inv.created_at)}</td>
                      <td className="date-cell">{formatDateTime(inv.used_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn-action btn-download" onClick={() => handleDownload(inv)} disabled={!inv.image_url} title="Download"><MdDownload size={14}/></button>
                          <button className="btn-action btn-share"    onClick={() => handleShare(inv)}    title="Share via WhatsApp"><MdShare size={14}/></button>
                          <button className="btn-action btn-delete"   onClick={() => setDelInvId(inv.id)} title="Delete"><MdDelete size={14}/></button>
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

      {/* Delete invitation modal */}
      {delInvId && (
        <div className="modal-overlay" onClick={() => setDelInvId(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Delete Invitation?</h3>
            <p className="modal-message">This cannot be undone.</p>
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setDelInvId(null)}>Cancel</button>
              <button className="modal-btn-confirm modal-btn-danger" onClick={handleDeleteInv}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
