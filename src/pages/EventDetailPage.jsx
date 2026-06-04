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
import VoicePlayerMini from '../components/VoicePlayerMini';
import '../styles/events.css';
import '../styles/voice-recorder.css';

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

  // Provide color defaults so the pickers always save a value, even for old events
  function initForm(ev) {
    return {
      ...ev,
      dress_code_main:      ev.dress_code_main      || '#d4af37',
      dress_code_secondary: ev.dress_code_secondary || '#1a1a2e',
      dress_code_accent:    ev.dress_code_accent     || '#ffffff',
    };
  }

  const load = () => {
    setLoading(true);
    getEvent(id)
      .then(({ data: d }) => { setData(d); setForm(initForm(d.event)); })
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
    const url   = inviteLink(inv);
    const ev    = data?.event;
    const name  = ev?.event_name || 'tukio letu';
    const date  = ev?.event_date ? new Date(ev.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const time  = ev?.event_time || null;
    const venue = ev?.venue      || null;

    const TYPE_EMOJI = {
      'Wedding': '💍', 'Kitchen Party': '🍽️', 'Birthday': '🎂',
      'Sendoff': '✈️', 'Graduation': '🎓', 'Conference': '💼',
      'Church Event': '⛪', 'Corporate Event': '🏢',
    };
    const emoji = TYPE_EMOJI[ev?.event_type || ''] || '🎉';

    // Build compact details line (no empty lines between date/time/venue)
    const details = [
      date  ? `📅 ${date}`  : null,
      time  ? `🕒 ${time}`  : null,
      venue ? `📍 ${venue}` : null,
    ].filter(Boolean).join('\n');

    const fullMessage = [
      `Habari ${inv.guest_name},`,
      `Tunafurahi kukualika kuhudhuria:`,
      `${emoji} ${name}`,
      details ? `\n${details}` : '',
      `\nFungua link hapa chini kuona mwaliko wako rasmi, QR Code ya kuingilia na kuthibitisha uwepo wako:`,
      url,
      `Karibu sana.`,
    ].filter(Boolean).join('\n');

    if (navigator.share) {
      try {
        // Strip URL from text to prevent duplication (browser appends url param separately)
        const textOnly = fullMessage.replace(url, '').trimEnd();
        await navigator.share({ title: `Mwaliko — ${name}`, text: textOnly, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, '_blank');
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
                <button className="btn-outline" onClick={() => { setEditing(false); setForm(initForm(ev)); }}>
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
                    <select value={form.event_type || 'Wedding'} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
                      {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Date</label>
                    <input type="date" value={(form.event_date || '').split('T')[0]} onChange={e => setForm(f => ({ ...f, event_date: e.target.value }))} />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Time</label>
                    <input value={form.event_time || ''} onChange={e => setForm(f => ({ ...f, event_time: e.target.value }))} placeholder="e.g. 5:00 PM" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Venue</label>
                    <input value={form.venue || ''} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} placeholder="Venue" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Maps Link</label>
                    <input value={form.maps_link || ''} onChange={e => setForm(f => ({ ...f, maps_link: e.target.value }))} placeholder="Google Maps URL" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Contact Name</label>
                    <input value={form.contact_name || ''} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="Event Coordinator" />
                  </div>
                  <div className="ev-info-edit-row">
                    <label>Contact Phone</label>
                    <input type="tel" value={form.contact_phone || ''} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+255754123456" />
                  </div>
                </>
              ) : (
                <>
                  {ev?.event_date && <div className="ev-info-row"><MdCalendarToday size={15}/><span>{formatDate(ev.event_date)}</span></div>}
                  {ev?.event_time && <div className="ev-info-row"><span style={{width:15,textAlign:'center'}}>🕒</span><span>{ev.event_time}</span></div>}
                  {ev?.venue      && <div className="ev-info-row"><MdLocationOn size={15}/><span>{ev.venue}</span></div>}
                  {ev?.maps_link  && (
                    <div className="ev-info-row">
                      <MdMap size={15}/>
                      <a href={ev.maps_link} target="_blank" rel="noreferrer" className="ev-maps-link">Open Directions</a>
                    </div>
                  )}
                  {ev?.contact_phone && (
                    <div className="ev-info-row">
                      <span style={{width:15,textAlign:'center'}}>📞</span>
                      <a href={`tel:${ev.contact_phone}`} className="ev-maps-link">{ev.contact_name || ev.contact_phone}</a>
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
                  <label>Primary Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_main || '#d4af37'} onChange={e => setForm(f => ({ ...f, dress_code_main: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_main || '#d4af37' }} />
                    <span className="color-hex">{form.dress_code_main || '#d4af37'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Secondary Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_secondary || '#1a1a2e'} onChange={e => setForm(f => ({ ...f, dress_code_secondary: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_secondary || '#1a1a2e' }} />
                    <span className="color-hex">{form.dress_code_secondary || '#1a1a2e'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Accent Color</label>
                  <div className="color-picker-wrap">
                    <input type="color" value={form.dress_code_accent || '#ffffff'} onChange={e => setForm(f => ({ ...f, dress_code_accent: e.target.value }))} />
                    <span className="color-swatch" style={{ background: form.dress_code_accent || '#ffffff' }} />
                    <span className="color-hex">{form.dress_code_accent || '#ffffff'}</span>
                  </div>
                </div>
                <div className="ev-info-edit-row">
                  <label>Notes</label>
                  <textarea value={form.dress_code_notes || ''} onChange={e => setForm(f => ({ ...f, dress_code_notes: e.target.value }))} rows={3} />
                </div>
              </div>
            ) : (
              <div className="dress-code-display">
                {(ev?.dress_code_main || ev?.dress_code_secondary || ev?.dress_code_accent || ev?.dress_code_notes) ? (
                  <>
                    <div className="dress-swatches-row">
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_main || '#d4af37' }} />
                        <span>Primary</span>
                      </div>
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_secondary || '#1a1a2e' }} />
                        <span>Secondary</span>
                      </div>
                      <div className="dress-swatch-chip">
                        <span className="dress-swatch-circle" style={{ background: ev.dress_code_accent || '#ffffff', border: '2px solid rgba(255,255,255,0.22)' }} />
                        <span>Accent</span>
                      </div>
                    </div>
                    {ev?.dress_code_notes && <p className="dress-notes">{ev.dress_code_notes}</p>}
                  </>
                ) : (
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
                    <th>Card</th><th>Code</th><th>Guest Name</th><th>Phone</th>
                    <th>RSVP</th><th>Voice</th><th>Status</th><th>Created</th><th>Actions</th>
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
                      <td className="date-cell">{inv.phone_number || '—'}</td>
                      <td>
                        {inv.rsvp_response ? (
                          <span className={`rsvp-mini rsvp-mini--${inv.rsvp_response}`}>
                            {inv.rsvp_response === 'attending' ? '✓ Yes' : '✗ No'}
                          </span>
                        ) : <span className="rsvp-mini rsvp-mini--none">—</span>}
                      </td>
                      <td><VoicePlayerMini url={inv.rsvp_voice_url} /></td>
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
