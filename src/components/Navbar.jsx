import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import { MdDashboard, MdQrCodeScanner, MdAdminPanelSettings, MdMenu, MdClose, MdAddPhotoAlternate, MdLogout } from 'react-icons/md';
import '../styles/components.css';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const close = () => setOpen(false);

  const handleLogout = () => {
    close();
    localStorage.removeItem('wqr_token');
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo" onClick={close}>
        <GiDiamondRing className="logo-icon" />
        Tmcs tia mbeya ( Graduation )
      </Link>

      <button className="nav-hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
        {open ? <MdClose /> : <MdMenu />}
      </button>

      {open && <div className="nav-overlay" onClick={close} aria-hidden="true" />}

      <ul className={`navbar-links${open ? ' open' : ''}`}>
        <li>
          <NavLink to="/" end onClick={close} className={({ isActive }) => isActive ? 'active' : ''}>
            <MdDashboard size={16} /> Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink to="/create" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}>
            <MdAddPhotoAlternate size={16} /> Create Cards
          </NavLink>
        </li>
        <li>
          <NavLink to="/verify" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}>
            <MdQrCodeScanner size={16} /> Scan &amp; Verify
          </NavLink>
        </li>
        <li>
          <NavLink to="/admin" onClick={close} className={({ isActive }) => isActive ? 'active' : ''}>
            <MdAdminPanelSettings size={16} /> Admin
          </NavLink>
        </li>
        <li>
          <button className="nav-logout" onClick={handleLogout} aria-label="Sign out">
            <MdLogout size={16} /> Logout
          </button>
        </li>
      </ul>
    </nav>
  );
}
