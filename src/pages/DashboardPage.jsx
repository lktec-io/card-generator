import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  MdAddPhotoAlternate, MdQrCodeScanner, MdEvent, MdPeople, MdCheckCircle,
  MdHourglassEmpty, MdCancel, MdSchedule, MdArrowForward, MdHistory,
} from 'react-icons/md';
import { getGlobalStats, listEvents } from '../utils/api';
import { isAdmin } from '../utils/auth';
import '../styles/dashboard.css';

/* ── Formatting ──────────────────────────────────────────────────────── */

const plainNumber   = new Intl.NumberFormat('en-US');
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// 1,284 · 12.9K — and '—' while a value is unavailable
function fmt(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Math.abs(n) >= 10000 ? compactNumber.format(n) : plainNumber.format(n);
}

function percentOf(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function formatDate(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(raw) {
  if (!raw) return '—';
  return new Date(raw).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/* ── Building blocks ─────────────────────────────────────────────────── */

function Kpi({ icon, label, value }) {
  return (
    <div className="dash-kpi">
      <p className="dash-kpi-label">
        <span className="dash-kpi-icon" aria-hidden="true">{icon}</span>
        <span className="dash-kpi-label-text">{label}</span>
      </p>
      <p className="dash-kpi-value">{fmt(value)}</p>
    </div>
  );
}

function Meter({ value, label, small = false }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      className={`dash-meter${small ? ' dash-meter--sm' : ''}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
    >
      <div className="dash-meter-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

const EVENT_TYPE_COLORS = {
  'Wedding': '#d4af37', 'Birthday': '#a78bfa', 'Kitchen Party': '#fb923c',
  'Sendoff': '#34d399', 'Graduation': '#60a5fa', 'Conference': '#f87171',
  'Church Event': '#fbbf24', 'Corporate Event': '#94a3b8',
};

function EventType({ type }) {
  if (!type) return null;
  return (
    <span className="dash-event-type">
      <i style={{ background: EVENT_TYPE_COLORS[type] || '#94a3b8' }} aria-hidden="true" />
      {type}
    </span>
  );
}

// Fixed order: good → neutral → bad. The neutral gray sits between green and red because
// those two are hard to tell apart side by side for red-green colour-blind readers.
// Each status pairs its colour with an icon and a text label, never colour alone.
const RSVP_STATUSES = [
  { key: 'attending', label: 'Attending',      color: '#16a34a', Icon: MdCheckCircle },
  { key: 'awaiting',  label: 'Awaiting reply', color: '#6b7280', Icon: MdSchedule },
  { key: 'declined',  label: 'Declined',       color: '#ef4444', Icon: MdCancel },
];

function RsvpBreakdown({ attending, declined, awaiting }) {
  const [active, setActive] = useState(null);
  const counts = { attending, declined, awaiting };
  const total  = attending + declined + awaiting;

  let start = 0;
  const rows = RSVP_STATUSES.map((status) => {
    const value = counts[status.key];
    const pct   = total > 0 ? (value / total) * 100 : 0;
    const row   = { ...status, value, pct, start };
    start += pct;
    return row;
  });
  const shown = rows.filter((r) => r.value > 0);
  const tip   = shown.find((r) => r.key === active);

  const hover = (row) => (row.value > 0
    ? { onMouseEnter: () => setActive(row.key), onMouseLeave: () => setActive(null) }
    : {});

  return (
    <>
      <div className="dash-rsvp-bar-wrap">
        {tip && (
          <div
            className="dash-tooltip"
            style={{ left: `${Math.min(85, Math.max(15, tip.start + tip.pct / 2))}%` }}
          >
            <strong>{fmt(tip.value)}</strong>
            <span>
              <i className="dash-tooltip-key" style={{ background: tip.color }} aria-hidden="true" />
              {tip.label} · {Math.round(tip.pct)}%
            </span>
          </div>
        )}
        <div className="dash-rsvp-bar" role="group" aria-label="RSVP responses by status">
          {shown.length === 0 ? (
            <div className="dash-rsvp-track" />
          ) : shown.map((r) => (
            <div
              key={r.key}
              className={`dash-rsvp-seg${active && active !== r.key ? ' is-dim' : ''}`}
              style={{ flexGrow: r.value, '--seg-color': r.color }}
              tabIndex={0}
              role="img"
              aria-label={`${r.label}: ${plainNumber.format(r.value)} (${Math.round(r.pct)}%)`}
              onFocus={() => setActive(r.key)}
              onBlur={() => setActive(null)}
              {...hover(r)}
            />
          ))}
        </div>
      </div>

      <ul className="dash-rsvp-legend">
        {rows.map((r) => (
          <li
            key={r.key}
            className={`dash-rsvp-legend-row${active === r.key ? ' is-active' : ''}`}
            {...hover(r)}
          >
            <r.Icon className="dash-rsvp-legend-icon" style={{ color: r.color }} aria-hidden="true" />
            <span className="dash-rsvp-legend-label">{r.label}</span>
            <span className="dash-rsvp-legend-val">{fmt(r.value)}</span>
            <span className="dash-rsvp-legend-share">{total > 0 ? `${Math.round(r.pct)}%` : '—'}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ── Page component ──────────────────────────────────────────────────── */

export default function DashboardPage() {
  const [stats,         setStats]         = useState(null);
  const [recentCheckins, setRecentCheckins] = useState([]);
  const [recentRSVP,    setRecentRSVP]    = useState([]);
  const [events,        setEvents]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([getGlobalStats(), listEvents()])
      .then(([statsRes, eventsRes]) => {
        setStats(statsRes.data.stats);
        setRecentCheckins(statsRes.data.recent_checkins || []);
        setRecentRSVP(statsRes.data.recent_rsvp || []);
        setEvents(eventsRes.data.events?.slice(0, 5) || []);
      })
      .catch(() => setError('Could not load dashboard. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  const attendanceRate = stats?.attendance_rate ?? 0;
  const rsvpTotal = (stats?.rsvp_attending ?? 0) + (stats?.rsvp_declined ?? 0);
  const rsvpPending = Math.max(0, (stats?.total_invitations ?? 0) - rsvpTotal);

  return (
    <div className="dashboard-page page-enter">

      {/* ── Header ── */}
      <header className="dash-header">
        <div className="dash-header-text">
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
      </header>

      {error && <p className="dash-error">{error}</p>}

      {loading ? (
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          Loading…
        </div>
      ) : (
        <>
          {/* ── Overview: the headline figure first, then the key counts ── */}
          <div className="dash-overview">
            <section className="dash-card dash-hero" aria-labelledby="dash-attendance-title">
              <div className="dash-card-head">
                <h2 id="dash-attendance-title" className="dash-card-title">Attendance rate</h2>
                <span className="dash-card-hint">Checked in ÷ invitations</span>
              </div>
              <p className="dash-hero-value">
                {attendanceRate}<span className="dash-hero-unit">%</span>
              </p>
              <Meter value={attendanceRate} label="Attendance rate" />
              <div className="dash-hero-meta">
                <span><strong>{fmt(stats?.checked_in)}</strong> of {fmt(stats?.total_invitations)} checked in</span>
                <span><strong>{fmt(stats?.pending)}</strong> pending entry</span>
              </div>
            </section>

            <section className="dash-kpis" aria-label="Key figures">
              <Kpi icon={<MdEvent />}          label="Total events"      value={stats?.total_events} />
              <Kpi icon={<MdPeople />}         label="Total invitations" value={stats?.total_invitations} />
              <Kpi icon={<MdCheckCircle />}    label="Checked in"        value={stats?.checked_in} />
              <Kpi icon={<MdHourglassEmpty />} label="Pending entry"     value={stats?.pending} />
              {isAdmin() && stats?.total_users !== undefined && (
                <Kpi icon={<MdPeople />} label="Total users" value={stats.total_users} />
              )}
              {isAdmin() && stats?.total_campaigns !== undefined && (
                <Kpi icon={<MdEvent />} label="Campaigns" value={stats.total_campaigns} />
              )}
            </section>
          </div>

          {/* ── RSVP breakdown + recent events ── */}
          <div className="dash-panels">
            <section className="dash-card" aria-labelledby="dash-rsvp-title">
              <div className="dash-card-head">
                <h2 id="dash-rsvp-title" className="dash-card-title">RSVP responses</h2>
                <span className="dash-card-hint">
                  {fmt(rsvpTotal)} of {fmt(stats?.total_invitations)} replied
                </span>
              </div>
              <RsvpBreakdown
                attending={stats?.rsvp_attending ?? 0}
                declined={stats?.rsvp_declined ?? 0}
                awaiting={rsvpPending}
              />
            </section>

            <section className="dash-card" aria-labelledby="dash-events-title">
              <div className="dash-card-head">
                <h2 id="dash-events-title" className="dash-card-title">Recent events</h2>
                <Link to="/events" className="dash-see-all">See all <MdArrowForward size={14} /></Link>
              </div>
              {events.length === 0 ? (
                <div className="dash-empty">
                  <MdEvent size={32} />
                  <p>No events yet. <button className="dash-link-btn" onClick={() => navigate('/events')}>Create your first event</button></p>
                </div>
              ) : (
                <ul className="dash-events-list">
                  {events.map((ev) => {
                    const invited   = Number(ev.total_invitations ?? 0);
                    const checkedIn = Number(ev.checked_in ?? 0);
                    return (
                      <li key={ev.id}>
                        <Link to={`/events/${ev.id}`} className="dash-event-row">
                          <div className="dash-event-main">
                            <p className="dash-event-name">{ev.event_name}</p>
                            <div className="dash-event-meta">
                              <EventType type={ev.event_type} />
                              {ev.event_date && <span>{formatDate(ev.event_date)}</span>}
                              {ev.venue && <span className="dash-event-venue">{ev.venue}</span>}
                            </div>
                          </div>
                          <div className="dash-event-figures">
                            <span className="dash-event-count">
                              <strong>{fmt(checkedIn)}</strong> of {fmt(invited)} in
                            </span>
                            <Meter small value={percentOf(checkedIn, invited)} label={`${ev.event_name} check-in progress`} />
                          </div>
                          <MdArrowForward size={16} className="dash-event-arrow" aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* ── Recent activity ── */}
          <div className="dash-activity-row">

            <section className="dash-card" aria-labelledby="dash-recent-rsvp-title">
              <div className="dash-card-head">
                <h2 id="dash-recent-rsvp-title" className="dash-card-title">Recent RSVPs</h2>
                <Link to="/history" className="dash-see-all">See all <MdArrowForward size={14} /></Link>
              </div>
              {recentRSVP.length === 0 ? (
                <p className="dash-empty-line">No RSVP responses yet</p>
              ) : (
                <ul className="dash-activity-list">
                  {recentRSVP.map((r, i) => {
                    const attending = r.response === 'attending';
                    return (
                      <li key={i} className="dash-activity-item">
                        <div className="dash-activity-body">
                          <strong>{r.guest_name}</strong>
                          {r.event_name && <span>{r.event_name}</span>}
                        </div>
                        <div className="dash-activity-side">
                          <span className={`dash-status dash-status--${attending ? 'attending' : 'declined'}`}>
                            {attending ? <MdCheckCircle aria-hidden="true" /> : <MdCancel aria-hidden="true" />}
                            {attending ? 'Attending' : 'Declined'}
                          </span>
                          <span className="dash-activity-time">{formatTime(r.created_at)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="dash-card" aria-labelledby="dash-recent-checkin-title">
              <div className="dash-card-head">
                <h2 id="dash-recent-checkin-title" className="dash-card-title">Recent check-ins</h2>
                <Link to="/history" className="dash-see-all">
                  <MdHistory size={14} /> History
                </Link>
              </div>
              {recentCheckins.length === 0 ? (
                <p className="dash-empty-line">No check-ins yet</p>
              ) : (
                <ul className="dash-activity-list">
                  {recentCheckins.map((c, i) => (
                    <li key={i} className="dash-activity-item">
                      <div className="dash-activity-body">
                        <strong>{c.guest_name}</strong>
                        {c.event_name && <span>{c.event_name}</span>}
                      </div>
                      <div className="dash-activity-side">
                        <span className="dash-code">{c.code}</span>
                        <span className="dash-activity-time">{formatTime(c.used_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </div>

          {/* ── Quick actions ── */}
          <nav className="dash-quick-actions" aria-label="Quick actions">
            <button className="dash-quick-btn" onClick={() => navigate('/create')}>
              <MdAddPhotoAlternate size={18} />
              <span>Create Invitation</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/verify')}>
              <MdQrCodeScanner size={18} />
              <span>Scan &amp; Verify</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/history')}>
              <MdCheckCircle size={18} />
              <span>Check-in History</span>
            </button>
            <button className="dash-quick-btn" onClick={() => navigate('/events')}>
              <MdEvent size={18} />
              <span>Manage Events</span>
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
