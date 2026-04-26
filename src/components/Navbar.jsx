import { NavLink, Link } from 'react-router-dom';
import '../styles/components.css';

export default function Navbar() {
  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo">💍 WeddingQR</Link>

      <ul className="navbar-links">
        <li>
          <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
            Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink to="/create" className={({ isActive }) => isActive ? 'active' : ''}>
            Create Cards
          </NavLink>
        </li>
        <li>
          <NavLink to="/verify" className={({ isActive }) => isActive ? 'active' : ''}>
            Scan &amp; Verify
          </NavLink>
        </li>
        <li>
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
            Admin
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
