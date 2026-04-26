/**
 * StatCard — a single dashboard metric tile.
 * Props:
 *   label   {string}  e.g. "Total Generated"
 *   value   {number}
 *   icon    {string}  emoji or symbol
 *   color   {string}  CSS color for the value number
 */
export default function StatCard({ label, value, icon, color }) {
  return (
    <div className="stat-card">
      {icon && <div className="stat-icon">{icon}</div>}
      <p className="stat-number" style={{ color: color || 'var(--gold-dark)' }}>
        {value ?? '—'}
      </p>
      <p className="stat-label">{label}</p>
    </div>
  );
}
