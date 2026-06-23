import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MdAdd, MdEvent, MdClose, MdCalendarToday,
  MdLocationOn, MdPeople, MdCheckCircle, MdArrowForward, MdDelete,
  MdGridView, MdViewList,
} from 'react-icons/md';
import { listEvents, createEvent, deleteEvent, listUsersDropdown } from '../utils/api';
import { isAdmin } from '../utils/auth';
import ConfirmModal from '../components/ConfirmModal';
import '../styles/events.css';

const EVENT_MODES = [
  { key: 'invitation',   label: 'Invitation Event',     hint: 'RSVP, QR Check-in & Attendance Statistics' },
  { key: 'contribution', label: 'Contribution Campaign', hint: 'Personalised card generation — name printed per guest' },
];

const EVENT_TYPES = [
  'Wedding', 'Kitchen Party', 'Birthday', 'Sendoff',
  'Graduation', 'Conference', 'Church Event', 'Corporate Event',
];

const TYPE_COLORS = {
  'Wedding':        '#d4af37',
  'Birthday':       '#a78bfa',
  'Kitchen Party':  '#fb923c',
  'Sendoff':        '#34d399',
  'Graduation':     '#60a5fa',
  'Conference':     '#f87171',
  'Church Event':   '#fbbf24',
  'Corporate Event':'#94a3b8',
};

function formatDate(raw) {
  if (!raw) return null;
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const EMPTY_FORM = {
  event_name: '', event_type: 'Wedding', event_mode: 'invitation', event_date: '', event_time: '',
  venue: '', maps_link: '', contact_name: '', contact_phone: '',
  dress_code_main: '#d4af37', dress_code_secondary: '#1a1a2e', dress_code_accent: '#ffffff',
  dress_code_notes: '', template_id: null, assigned_to: '',
  name_color: '#111111', cn_color: '#222222',
};

export default function EventsPage() {
  const [events,     setEvents]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showForm,   setShowForm]   = useState(false);
  const [viewMode,   setViewMode]   = useState(() => localStorage.getItem('eventsView') || 'grid');

  const switchView = (v) => { setViewMode(v); localStorage.setItem('eventsView', v); };
  const [form,       setForm]       = useState(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState('');
  const [deleteId,   setDeleteId]   = useState(null);
  const [usersList,  setUsersList]  = useState([]);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    listEvents()
      .then(({ data }) => setEvents(data.events || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (isAdmin()) {
      listUsersDropdown().then(({ data }) => setUsersList(data.users || [])).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.event_name.trim()) { setFormError('Event name is required.'); return; }
    setSaving(true);
    setFormError('');
    try {
      const { data } = await createEvent(form);
      setEvents(prev => [data.event, ...prev]);
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteEvent(id);
      setEvents(prev => prev.filter(e => e.id !== id));
    } catch {
      alert('Failed to delete event.');
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="events-page page-enter">
      <div className="events-container">

        {/* ── Header ── */}
        <div className="events-header">
          <div>
            <span className="events-ornament">— Nardio Events —</span>
            <h1>Events</h1>
            <p>Manage weddings, parties, conferences & more</p>
          </div>
          <div className="events-header-right">
            <div className="view-toggle">
              <button className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`} onClick={() => switchView('list')} title="List view">
                <MdViewList size={18} />
              </button>
              <button className={`view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`} onClick={() => switchView('grid')} title="Grid view">
                <MdGridView size={18} />
              </button>
            </div>
            <button className="btn-gold" onClick={() => { setShowForm(true); setFormError(''); }}>
              <MdAdd size={18} /> Create Event
            </button>
          </div>
        </div>

        {/* ── Create form ── */}
        {showForm && (
          <div className="event-form-card">
            <div className="event-form-head">
              <h2>New Event</h2>
              <button className="event-form-close" onClick={() => setShowForm(false)}><MdClose /></button>
            </div>
            <form onSubmit={handleCreate} className="event-form">

              {/* ── Mode selector ── */}
              <div className="ef-field ef-field--full">
                <label>Event Category *</label>
                <div className="tg-cats">
                  {EVENT_MODES.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={`tg-cat-btn${form.event_mode === m.key ? ' active' : ''}`}
                      onClick={() => setForm(f => ({ ...f, event_mode: m.key }))}
                      title={m.hint}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="cte-hint" style={{ marginTop: '0.35rem' }}>
                  {EVENT_MODES.find(m => m.key === form.event_mode)?.hint}
                </p>
              </div>

              {/* ── Name + type (both modes) ── */}
              <div className="ef-row">
                <div className="ef-field ef-field--wide">
                  <label>{form.event_mode === 'contribution' ? 'Campaign Name *' : 'Event Name *'}</label>
                  <input name="event_name" value={form.event_name} onChange={handleChange}
                    placeholder={form.event_mode === 'contribution' ? 'e.g. Harusi ya Amina & Juma' : 'e.g. John & Jane Wedding'}
                    required />
                </div>
                <div className="ef-field">
                  <label>Category</label>
                  <select name="event_type" value={form.event_type} onChange={handleChange}>
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* ── Date (both modes) ── */}
              <div className="ef-row">
                <div className="ef-field">
                  <label>Date</label>
                  <input name="event_date" type="date" value={form.event_date} onChange={handleChange} />
                </div>
                {form.event_mode === 'invitation' && (
                  <div className="ef-field">
                    <label>Time</label>
                    <input name="event_time" type="text" value={form.event_time} onChange={handleChange} placeholder="e.g. 5:00 PM" />
                  </div>
                )}
              </div>

              {/* ── Invitation-only: venue + maps ── */}
              {form.event_mode === 'invitation' && (
                <div className="ef-row">
                  <div className="ef-field ef-field--wide">
                    <label>Venue</label>
                    <input name="venue" value={form.venue} onChange={handleChange} placeholder="Venue name or address" />
                  </div>
                  <div className="ef-field ef-field--full">
                    <label>Google Maps Link</label>
                    <input name="maps_link" value={form.maps_link} onChange={handleChange} placeholder="https://maps.google.com/..." />
                  </div>
                </div>
              )}

              {/* ── Contact (both modes) ── */}
              <div className="ef-row">
                <div className="ef-field">
                  <label>Contact Name</label>
                  <input name="contact_name" value={form.contact_name} onChange={handleChange} placeholder="e.g. Event Coordinator" />
                </div>
                <div className="ef-field">
                  <label>Contact Phone</label>
                  <input name="contact_phone" type="tel" value={form.contact_phone} onChange={handleChange} placeholder="e.g. +255754123456" />
                </div>
              </div>

              {/* ── Invitation-only: dress code ── */}
              {form.event_mode === 'invitation' && (
                <>
                  <div className="ef-row ef-row--3">
                    <div className="ef-field">
                      <label>Primary Color</label>
                      <div className="color-picker-wrap">
                        <input type="color" name="dress_code_main" value={form.dress_code_main || '#d4af37'} onChange={handleChange} />
                        <span className="color-swatch" style={{ background: form.dress_code_main || '#d4af37' }} />
                        <span className="color-hex">{form.dress_code_main || '#d4af37'}</span>
                      </div>
                    </div>
                    <div className="ef-field">
                      <label>Secondary Color</label>
                      <div className="color-picker-wrap">
                        <input type="color" name="dress_code_secondary" value={form.dress_code_secondary || '#1a1a2e'} onChange={handleChange} />
                        <span className="color-swatch" style={{ background: form.dress_code_secondary || '#1a1a2e' }} />
                        <span className="color-hex">{form.dress_code_secondary || '#1a1a2e'}</span>
                      </div>
                    </div>
                    <div className="ef-field">
                      <label>Accent Color</label>
                      <div className="color-picker-wrap">
                        <input type="color" name="dress_code_accent" value={form.dress_code_accent || '#ffffff'} onChange={handleChange} />
                        <span className="color-swatch" style={{ background: form.dress_code_accent || '#ffffff' }} />
                        <span className="color-hex">{form.dress_code_accent || '#ffffff'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="ef-field ef-field--full">
                    <label>Dress Code Notes</label>
                    <textarea name="dress_code_notes" value={form.dress_code_notes} onChange={handleChange} rows={2}
                      placeholder="e.g. Ladies: Royal Blue gowns. Gentlemen: Black suit." />
                  </div>
                </>
              )}

              {/* ── Assign (admin only, both modes) ── */}
              {isAdmin() && usersList.length > 0 && (
                <div className="ef-field ef-field--full">
                  <label>Assign To (optional)</label>
                  <select name="assigned_to" value={form.assigned_to} onChange={handleChange}>
                    <option value="">— No assignment —</option>
                    {usersList.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role === 'event_manager' ? 'Manager' : u.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {formError && <p className="ef-error">{formError}</p>}
              <div className="ef-actions">
                <button type="button" className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={saving}>
                  {saving ? 'Creating…' : form.event_mode === 'contribution' ? 'Create Campaign' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Events list ── */}
        {loading ? (
          <div className="events-loading"><div className="ev-spinner" /> Loading events…</div>
        ) : events.length === 0 ? (
          <div className="events-empty">
            <MdEvent size={52} />
            <h3>No Events Yet</h3>
            <p>Create your first event to start managing invitations.</p>
            <button className="btn-gold" onClick={() => setShowForm(true)}>
              <MdAdd size={16} /> Create Event
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── GRID VIEW ── */
          <div className="events-grid">
            {events.map(ev => (
              <div key={ev.id} className="event-card" onClick={() => navigate(`/events/${ev.id}`)}>
                <div className="event-card-accent" style={{ background: TYPE_COLORS[ev.event_type] || '#94a3b8' }} />
                <div className="event-card-body">
                  <div className="event-card-top">
                    <span className="event-card-type" style={{ color: TYPE_COLORS[ev.event_type] || '#94a3b8' }}>{ev.event_type}</span>
                    <button className="event-delete-btn" onClick={e => { e.stopPropagation(); setDeleteId(ev.id); }} title="Delete"><MdDelete size={15} /></button>
                  </div>
                  <h3 className="event-card-name">{ev.event_name}</h3>
                  <div className="event-card-meta">
                    {ev.event_date && <span><MdCalendarToday size={13} /> {formatDate(ev.event_date)}</span>}
                    {ev.venue      && <span><MdLocationOn size={13} /> {ev.venue}</span>}
                  </div>
                  <div className="event-card-stats">
                    <div className="ev-stat"><MdPeople size={15}/><strong>{ev.total_invitations ?? 0}</strong><span>Invited</span></div>
                    <div className="ev-stat ev-stat--green"><MdCheckCircle size={15}/><strong>{ev.checked_in ?? 0}</strong><span>In</span></div>
                    <div className="ev-stat ev-stat--gold"><MdPeople size={15}/><strong>{ev.rsvp_attending ?? 0}</strong><span>RSVP</span></div>
                  </div>
                </div>
                <div className="event-card-footer"><span>View Details</span><MdArrowForward size={15} /></div>
              </div>
            ))}
          </div>
        ) : (
          /* ── LIST VIEW ── */
          <div className="events-list-view">
            {events.map(ev => (
              <div key={ev.id} className="events-list-row" onClick={() => navigate(`/events/${ev.id}`)}>
                <div className="events-list-accent" style={{ background: TYPE_COLORS[ev.event_type] || '#94a3b8' }} />
                <div className="events-list-main">
                  <div className="events-list-name-row">
                    <span className="events-list-type" style={{ color: TYPE_COLORS[ev.event_type] || '#94a3b8' }}>{ev.event_type}</span>
                    <h3 className="events-list-name">{ev.event_name}</h3>
                  </div>
                  <div className="events-list-meta">
                    {ev.event_date && <span><MdCalendarToday size={13} /> {formatDate(ev.event_date)}</span>}
                    {ev.venue      && <span><MdLocationOn size={13} /> {ev.venue}</span>}
                  </div>
                </div>
                <div className="events-list-stats">
                  <span className="ev-stat"><MdPeople size={14}/><strong>{ev.total_invitations ?? 0}</strong></span>
                  <span className="ev-stat ev-stat--green"><MdCheckCircle size={14}/><strong>{ev.checked_in ?? 0}</strong></span>
                  <span className="ev-stat ev-stat--gold"><MdPeople size={14}/><strong>{ev.rsvp_attending ?? 0}</strong></span>
                </div>
                <div className="events-list-actions">
                  <button className="event-delete-btn" onClick={e => { e.stopPropagation(); setDeleteId(ev.id); }} title="Delete"><MdDelete size={15} /></button>
                  <MdArrowForward size={16} className="events-list-arrow" />
                </div>
              </div>
            ))}
          </div>
        )}

        <ConfirmModal
          open={!!deleteId}
          title="Delete Event?"
          message="All invitations for this event will be unlinked. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      </div>
    </div>
  );
}
