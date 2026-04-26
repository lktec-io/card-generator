import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import { MdDashboard, MdQrCodeScanner, MdAdminPanelSettings, MdMenu, MdClose, MdAddPhotoAlternate } from 'react-icons/md';
import '../styles/components.css';

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo" onClick={close}>
        <GiDiamondRing className="logo-icon" />
        WeddingQR
      </Link>

      <button className="nav-hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
        {open ? <MdClose /> : <MdMenu />}
      </button>

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
      </ul>
    </nav>
  );
}
