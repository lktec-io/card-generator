import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import { getStats } from '../utils/api';
import { MdStyle, MdCheckCircle, MdPendingActions, MdAddPhotoAlternate, MdQrCodeScanner } from 'react-icons/md';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getStats()
      .then(({ data }) => setStats(data))
      .catch(() => setError('Could not reach the server. Check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="dashboard-page page-enter">
      <div className="dashboard-header">
        <span className="dash-ornament">— Wedding QR System —</span>
        <h1>Invitation <span>Dashboard</span></h1>
        <p>Real-time overview of your wedding invitation cards</p>
      </div>

      {error && <p className="dash-error">{error}</p>}

      {loading && !stats && (
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          Loading stats…
        </div>
      )}

      {stats && (
        <div className="stats-grid">
          <StatCard
            label="Total Generated"
            value={stats.total}
            icon={MdStyle}
            color="var(--gold)"
          />
          <StatCard
            label="Checked In"
            value={stats.used}
            icon={MdCheckCircle}
            color="#22c55e"
          />
          <StatCard
            label="Awaiting Arrival"
            value={stats.unused}
            icon={MdPendingActions}
            color="#60a5fa"
          />
        </div>
      )}

      <div className="quick-actions">
        <button className="btn-gold quick-btn" onClick={() => navigate('/create')}>
          <MdAddPhotoAlternate size={18} /> Create Invitation Cards
        </button>
        <button className="btn-outline quick-btn" onClick={() => navigate('/verify')}>
          <MdQrCodeScanner size={18} /> Scan &amp; Verify QR
        </button>
      </div>

      <p className="dash-footer">Stats update on each page load</p>
    </div>
  );
}
