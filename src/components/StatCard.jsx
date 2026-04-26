export default function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="stat-card" style={{ '--accent': color || 'var(--gold)' }}>
      <div className="stat-icon" style={{ color: color || 'var(--gold)' }}>
        <Icon size={26} />
      </div>
      <p className="stat-number">{value ?? '—'}</p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
