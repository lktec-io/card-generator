import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MdAdd, MdEvent, MdClose, MdCalendarToday,
  MdLocationOn, MdPeople, MdCheckCircle, MdArrowForward, MdDelete,
  MdGridView, MdViewList,
} from 'react-icons/md';
import { listEvents, createEvent, deleteEvent } from '../utils/api';
import '../styles/events.css';

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
  event_name: '', event_type: 'Wedding', event_date: '',
  venue: '', dress_code_main: '', dress_code_secondary: '',
  dress_code_notes: '', maps_link: '',
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
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    listEvents()
      .then(({ data }) => setEvents(data.events || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

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
              <div className="ef-row">
                <div className="ef-field ef-field--wide">
                  <label>Event Name *</label>
                  <input name="event_name" value={form.event_name} onChange={handleChange} placeholder="e.g. John & Jane Wedding" required />
                </div>
                <div className="ef-field">
                  <label>Event Type</label>
                  <select name="event_type" value={form.event_type} onChange={handleChange}>
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="ef-row">
                <div className="ef-field">
                  <label>Date</label>
                  <input name="event_date" type="date" value={form.event_date} onChange={handleChange} />
                </div>
                <div className="ef-field ef-field--wide">
                  <label>Venue</label>
                  <input name="venue" value={form.venue} onChange={handleChange} placeholder="Venue name or address" />
                </div>
              </div>
              <div className="ef-row">
                <div className="ef-field">
                  <label>Dress Code — Main Color</label>
                  <input name="dress_code_main" value={form.dress_code_main} onChange={handleChange} placeholder="e.g. Royal Blue" />
                </div>
                <div className="ef-field">
                  <label>Dress Code — Secondary</label>
                  <input name="dress_code_secondary" value={form.dress_code_secondary} onChange={handleChange} placeholder="e.g. Gold" />
                </div>
              </div>
              <div className="ef-field ef-field--full">
                <label>Dress Code Notes</label>
                <textarea name="dress_code_notes" value={form.dress_code_notes} onChange={handleChange} rows={2} placeholder="e.g. Ladies: Royal Blue gowns. Gentlemen: Black suit." />
              </div>
              <div className="ef-field ef-field--full">
                <label>Google Maps Link</label>
                <input name="maps_link" value={form.maps_link} onChange={handleChange} placeholder="https://maps.google.com/..." />
              </div>
              {formError && <p className="ef-error">{formError}</p>}
              <div className="ef-actions">
                <button type="button" className="btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-gold" disabled={saving}>
                  {saving ? 'Creating…' : 'Create Event'}
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

        {/* ── Delete confirm ── */}
        {deleteId && (
          <div className="modal-overlay" onClick={() => setDeleteId(null)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <h3 className="modal-title">Delete Event?</h3>
              <p className="modal-message">All invitations for this event will be unlinked. This cannot be undone.</p>
              <div className="modal-actions">
                <button className="modal-btn-cancel" onClick={() => setDeleteId(null)}>Cancel</button>
                <button className="modal-btn-confirm modal-btn-danger" onClick={() => handleDelete(deleteId)}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
