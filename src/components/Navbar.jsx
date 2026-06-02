import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import {
  MdDashboard, MdQrCodeScanner, MdAdminPanelSettings,
  MdMenu, MdClose, MdAddPhotoAlternate, MdLogout,
  MdEvent, MdHistory,
} from 'react-icons/md';
import '../styles/components.css';

const NAV_LINKS = [
  { to: '/',        end: true,  icon: <MdDashboard size={16} />,          label: 'Dashboard'   },
  { to: '/events',  end: false, icon: <MdEvent size={16} />,              label: 'Events'      },
  { to: '/create',  end: false, icon: <MdAddPhotoAlternate size={16} />,  label: 'Create Cards'},
  { to: '/verify',  end: false, icon: <MdQrCodeScanner size={16} />,      label: 'Verify'      },
  { to: '/history', end: false, icon: <MdHistory size={16} />,            label: 'History'     },
  { to: '/admin',   end: false, icon: <MdAdminPanelSettings size={16} />, label: 'Admin'       },
];

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
        Cardhub Digital Invitation
      </Link>

      <button className="nav-hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
        {open ? <MdClose /> : <MdMenu />}
      </button>

      {open && <div className="nav-overlay" onClick={close} aria-hidden="true" />}

      <ul className={`navbar-links${open ? ' open' : ''}`}>
        {NAV_LINKS.map(({ to, end, icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={close}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {icon} {label}
            </NavLink>
          </li>
        ))}
        <li>
          <button className="nav-logout" onClick={handleLogout} aria-label="Sign out">
            <MdLogout size={16} /> Logout
          </button>
        </li>
      </ul>
    </nav>
  );
}
