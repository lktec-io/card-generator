export default function StatCard({ label, value, color }) {
  return (
    <div className="stat-card" style={{ '--accent': color || 'var(--gold)' }}>
      <p className="stat-number">{value ?? '—'}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
