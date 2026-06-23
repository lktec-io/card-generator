import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  MdAddPhotoAlternate, MdQrCodeScanner, MdEvent,
  MdPeople, MdCheckCircle, MdHourglassEmpty,
  MdThumbUp, MdThumbDown, MdTrendingUp, MdArrowForward,
  MdHistory,
} from 'react-icons/md';
import { getGlobalStats, listEvents } from '../utils/api';
import { isAdmin } from '../utils/auth';
import '../styles/dashboard.css';

/* ── Reusable stat card ───────────────────────────────────────────────── */

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

/* ── Donut chart (SVG, zero dependencies) ────────────────────────────── */

function DonutChart({ segments, size = 136, thick = 18 }) {
  const r     = (size - thick) / 2;
  const cx    = size / 2;
  const cy    = size / 2;
  const circ  = 2 * Math.PI * r;
  const total = segments.reduce((s, d) => s + (d.value || 0), 0);

  let cumulative = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {/* Background ring */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={thick}
      />
      <g transform={`rotate(-90, ${cx}, ${cy})`}>
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thick} />
        ) : (
          segments.map((seg, i) => {
            if (!seg.value) return null;
            const len     = (seg.value / total) * circ;
            const offset  = circ - cumulative;
            cumulative   += len;
            return (
              <circle
                key={i}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={thick}
                strokeDasharray={`${len} ${circ}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
          })
        )}
      </g>
      {/* Centre label */}
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill="rgba(255,255,255,0.90)"
        fontSize={Math.round(size * 0.16)}
        fontWeight="700"
        fontFamily="Poppins, sans-serif"
      >
        {total}
      </text>
    </svg>
  );
}

/* ── Progress bar ────────────────────────────────────────────────────── */

function ProgressBar({ value, max, color = 'var(--gold)', label }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="dash-progress-row">
      <div className="dash-progress-labels">
        <span>{label}</span>
        <span className="dash-progress-pct" style={{ color }}>{pct}%</span>
      </div>
      <div className="dash-progress-track">
        <div
          className="dash-progress-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function EventTypeChip({ type }) {
  const colors = {
    'Wedding': '#d4af37', 'Birthday': '#a78bfa', 'Kitchen Party': '#fb923c',
    'Sendoff': '#34d399', 'Graduation': '#60a5fa', 'Conference': '#f87171',
    'Church Event': '#fbbf24', 'Corporate Event': '#94a3b8',
  };
  return (
    <span className="event-type-chip" style={{ '--chip-color': colors[type] || '#94a3b8' }}>
      {type}
    </span>
  );
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

  const rsvpSegments = [
    { label: 'Attending', value: stats?.rsvp_attending ?? 0, color: '#22c55e' },
    { label: 'Declined',  value: stats?.rsvp_declined  ?? 0, color: '#ef4444' },
    { label: 'Pending',   value: rsvpPending,                  color: 'rgba(255,255,255,0.12)' },
  ];

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
            <StatCard icon={<MdHourglassEmpty size={22}/>} label="Pending Entry"     value={stats?.pending}            color="#f59e0b" />
            <StatCard icon={<MdThumbUp size={22}/>}        label="RSVP Attending"    value={stats?.rsvp_attending}     color="#34d399" />
            <StatCard icon={<MdThumbDown size={22}/>}      label="RSVP Declined"     value={stats?.rsvp_declined}      color="#f87171" />
            <StatCard
              icon={<MdTrendingUp size={22}/>}
              label="Attendance Rate"
              value={`${attendanceRate}%`}
              color="#a78bfa"
              sub={`${stats?.checked_in ?? 0} of ${stats?.total_invitations ?? 0} attended`}
            />
            {isAdmin() && stats?.total_users !== undefined && (
              <StatCard icon={<MdPeople size={22}/>} label="Total Users" value={stats.total_users} color="#c084fc" />
            )}
          </div>

          {/* ── Charts row ── */}
          <div className="dash-charts-row">

            {/* RSVP donut */}
            <div className="dash-chart-card">
              <h3 className="dash-chart-title">RSVP Status</h3>
              <div className="dash-chart-inner">
                <DonutChart segments={rsvpSegments} size={136} thick={18} />
                <div className="dash-chart-legend">
                  {rsvpSegments.map(s => (
                    <div key={s.label} className="dash-legend-row">
                      <span className="dash-legend-dot" style={{ background: s.color }} />
                      <span className="dash-legend-label">{s.label}</span>
                      <span className="dash-legend-val">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Attendance progress */}
            <div className="dash-chart-card">
              <h3 className="dash-chart-title">Attendance</h3>
              <div className="dash-progress-list">
                <ProgressBar
                  label="Checked In"
                  value={stats?.checked_in ?? 0}
                  max={stats?.total_invitations ?? 1}
                  color="#22c55e"
                />
                <ProgressBar
                  label="RSVP Confirmed"
                  value={stats?.rsvp_attending ?? 0}
                  max={stats?.total_invitations ?? 1}
                  color="#d4af37"
                />
                <ProgressBar
                  label="RSVP Declined"
                  value={stats?.rsvp_declined ?? 0}
                  max={stats?.total_invitations ?? 1}
                  color="#ef4444"
                />
                <ProgressBar
                  label="Attendance Rate"
                  value={attendanceRate}
                  max={100}
                  color="#a78bfa"
                />
              </div>
            </div>

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

          {/* ── Recent activity row ── */}
          <div className="dash-activity-row">

            {/* Recent RSVP */}
            <div className="dash-section dash-activity-card">
              <div className="dash-section-head">
                <h2>Recent RSVPs</h2>
                <Link to="/history" className="dash-see-all">See all <MdArrowForward size={14}/></Link>
              </div>
              {recentRSVP.length === 0 ? (
                <div className="dash-empty" style={{ padding: '1.5rem 0' }}>
                  <p>No RSVP responses yet</p>
                </div>
              ) : (
                <ul className="dash-activity-list">
                  {recentRSVP.map((r, i) => (
                    <li key={i} className="dash-activity-item">
                      <span className={`dash-rsvp-dot dash-rsvp-dot--${r.response}`} />
                      <div className="dash-activity-body">
                        <strong>{r.guest_name}</strong>
                        <span className={`dash-rsvp-badge dash-rsvp-badge--${r.response}`}>
                          {r.response === 'attending' ? '✓ Attending' : '✗ Declined'}
                        </span>
                      </div>
                      <span className="dash-activity-time">{formatTime(r.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent check-ins */}
            <div className="dash-section dash-activity-card">
              <div className="dash-section-head">
                <h2>Recent Check-ins</h2>
                <Link to="/history" className="dash-see-all">
                  <MdHistory size={14}/> History
                </Link>
              </div>
              {recentCheckins.length === 0 ? (
                <div className="dash-empty" style={{ padding: '1.5rem 0' }}>
                  <p>No check-ins yet</p>
                </div>
              ) : (
                <ul className="dash-activity-list">
                  {recentCheckins.map((c, i) => (
                    <li key={i} className="dash-activity-item">
                      <MdCheckCircle size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                      <div className="dash-activity-body">
                        <strong>{c.guest_name}</strong>
                        <span className="dash-activity-code">{c.code}</span>
                      </div>
                      <span className="dash-activity-time">{formatTime(c.used_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
