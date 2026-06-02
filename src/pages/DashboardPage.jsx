import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  MdAddPhotoAlternate, MdQrCodeScanner, MdEvent,
  MdPeople, MdCheckCircle, MdHourglassEmpty,
  MdThumbUp, MdThumbDown, MdTrendingUp, MdArrowForward,
} from 'react-icons/md';
import { getGlobalStats, listEvents } from '../utils/api';
import '../styles/dashboard.css';

function StatCard({ icon, label, value, color, sub }) {
  return (
    <div className="dash-stat-card" style={{ '--card-accent': color }}>
      <div className="dash-stat-icon">{icon}</div>
      <div className="dash-stat-body">
        <p className="dash-stat-value">{value ?? '—'}</p>
        <p className="dash-stat-label">{label}</p>
        {sub && <p className="dash-stat-sub">{sub}</p>}
      </div>
    </div>
  );
}

function EventTypeChip({ type }) {
  const colors = {
    'Wedding':        '#d4af37',
    'Birthday':       '#a78bfa',
    'Kitchen Party':  '#fb923c',
    'Sendoff':        '#34d399',
    'Graduation':     '#60a5fa',
    'Conference':     '#f87171',
    'Church Event':   '#fbbf24',
    'Corporate Event':'#94a3b8',
  };
  return (
    <span className="event-type-chip" style={{ '--chip-color': colors[type] || '#94a3b8' }}>
      {type}
    </span>
  );
}

function formatDate(raw) {
  if (!raw) return null;
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null);
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([getGlobalStats(), listEvents()])
      .then(([statsRes, eventsRes]) => {
        setStats(statsRes.data.stats);
        setEvents(eventsRes.data.events?.slice(0, 5) || []);
      })
      .catch(() => setError('Could not load dashboard. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  const attendanceRate = stats?.attendance_rate ?? 0;

  return (
    <div className="dashboard-page page-enter">

      {/* ── Header ── */}
      <div className="dash-header">
        <div>
          <span className="dash-ornament">— Nardio Events —</span>
          <h1>Dashboard</h1>
          <p>Live overview across all events</p>
        </div>
        <div className="dash-header-actions">
          <button className="btn-gold" onClick={() => navigate('/events')}>
            <MdEvent size={16} /> New Event
          </button>
          <button className="btn-outline" onClick={() => navigate('/create')}>
            <MdAddPhotoAlternate size={16} /> Create Cards
          </button>
        </div>
      </div>

      {error && <p className="dash-error">{error}</p>}

      {loading ? (
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          Loading…
        </div>
      ) : (
        <>
          {/* ── Stats grid ── */}
          <div className="dash-stats-grid">
            <StatCard icon={<MdEvent size={22}/>}          label="Total Events"      value={stats?.total_events}      color="#d4af37" />
            <StatCard icon={<MdPeople size={22}/>}         label="Total Invitations" value={stats?.total_invitations}  color="#60a5fa" />
            <StatCard icon={<MdCheckCircle size={22}/>}    label="Checked In"        value={stats?.checked_in}         color="#22c55e" />
            <StatCard icon={<MdHourglassEmpty size={22}/>} label="Pending"           value={stats?.pending}            color="#f59e0b" />
            <StatCard icon={<MdThumbUp size={22}/>}        label="RSVP Attending"    value={stats?.rsvp_attending}     color="#34d399" />
            <StatCard icon={<MdThumbDown size={22}/>}      label="RSVP Declined"     value={stats?.rsvp_declined}      color="#f87171" />
            <StatCard
              icon={<MdTrendingUp size={22}/>}
              label="Attendance Rate"
              value={`${attendanceRate}%`}
              color="#a78bfa"
              sub={`${stats?.checked_in ?? 0} of ${stats?.total_invitations ?? 0} attended`}
            />
          </div>

          {/* ── Recent events ── */}
          <div className="dash-section">
            <div className="dash-section-head">
              <h2>Recent Events</h2>
              <Link to="/events" className="dash-see-all">See all <MdArrowForward size={14}/></Link>
            </div>

            {events.length === 0 ? (
              <div className="dash-empty">
                <MdEvent size={40} />
                <p>No events yet. <button className="dash-link-btn" onClick={() => navigate('/events')}>Create your first event</button></p>
              </div>
            ) : (
              <div className="dash-events-list">
                {events.map(ev => (
                  <Link to={`/events/${ev.id}`} key={ev.id} className="dash-event-row">
                    <div className="dash-event-main">
                      <p className="dash-event-name">{ev.event_name}</p>
                      <div className="dash-event-meta">
                        <EventTypeChip type={ev.event_type} />
                        {ev.event_date && <span className="dash-event-date">{formatDate(ev.event_date)}</span>}
                        {ev.venue && <span className="dash-event-venue">{ev.venue}</span>}
                      </div>
                    </div>
                    <div className="dash-event-stats">
                      <span className="dash-ev-stat"><strong>{ev.total_invitations ?? 0}</strong> invites</span>
                      <span className="dash-ev-stat dash-ev-checkin"><strong>{ev.checked_in ?? 0}</strong> in</span>
                      <MdArrowForward size={16} className="dash-event-arrow" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* ── Quick actions ── */}
          <div className="dash-quick-actions">
            <button className="dash-quick-btn" onClick={() => navigate('/create')}>
              <MdAddPhotoAlternate size={24} />
              <span>Create Invitation</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/verify')}>
              <MdQrCodeScanner size={24} />
              <span>Scan &amp; Verify</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/history')}>
              <MdCheckCircle size={24} />
              <span>Check-in History</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/events')}>
              <MdEvent size={24} />
              <span>Manage Events</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
