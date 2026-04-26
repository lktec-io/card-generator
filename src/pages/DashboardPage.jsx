import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../components/StatCard';
import { getStats } from '../utils/api';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getStats()
      .then(({ data }) => setStats(data))
      .catch(() => setError('Failed to load stats. Is the server running?'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>💍 Wedding Invitation System</h1>
        <p>Manage and track your wedding invitations</p>
      </div>

      {error && <p className="dash-error">{error}</p>}

      {loading && !stats && (
        <div className="dash-loading">Loading stats…</div>
      )}

      {stats && (
        <div className="stats-grid">
          <StatCard
            label="Total Generated"
            value={stats.total}
            icon="📋"
            color="var(--gold-dark)"
          />
          <StatCard
            label="Used"
            value={stats.used}
            icon="✅"
            color="#2D7D46"
          />
          <StatCard
            label="Unused"
            value={stats.unused}
            icon="🔖"
            color="#2C5282"
          />
        </div>
      )}

      <div className="quick-actions">
        <button className="btn-gold quick-btn" onClick={() => navigate('/create')}>
          🎨 Create Invitation Cards
        </button>
        <button className="btn-outline quick-btn" onClick={() => navigate('/verify')}>
          📷 Scan &amp; Verify QR
        </button>
      </div>

      <p className="dash-footer">Real-time stats from database</p>
    </div>
  );
}
