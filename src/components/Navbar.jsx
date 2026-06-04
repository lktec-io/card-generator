import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import {
  MdDashboard, MdQrCodeScanner, MdAdminPanelSettings,
  MdMenu, MdClose, MdAddPhotoAlternate, MdLogout,
  MdEvent, MdHistory, MdShield, MdUploadFile, MdPhotoLibrary,
} from 'react-icons/md';
import { isAdmin, getRole } from '../utils/auth';
import '../styles/components.css';

const ADMIN_LINKS = [
  { to: '/',        end: true,  icon: <MdDashboard size={16} />,          label: 'Dashboard'    },
  { to: '/events',  end: false, icon: <MdEvent size={16} />,              label: 'Events'       },
  { to: '/create',  end: false, icon: <MdAddPhotoAlternate size={16} />,  label: 'Create Cards' },
  { to: '/import',  end: false, icon: <MdUploadFile size={16} />,         label: 'Import'       },
  { to: '/verify',  end: false, icon: <MdQrCodeScanner size={16} />,      label: 'Verify'       },
  { to: '/history', end: false, icon: <MdHistory size={16} />,            label: 'History'      },
  { to: '/templates', end: false, icon: <MdPhotoLibrary size={16} />,      label: 'Templates'    },
  { to: '/admin',     end: false, icon: <MdAdminPanelSettings size={16} />, label: 'Admin'        },
];

const STAFF_LINKS = [
  { to: '/verify', end: false, icon: <MdQrCodeScanner size={16} />, label: 'Scan & Verify' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const close = () => setOpen(false);

  const role  = getRole();
  const links = isAdmin() ? ADMIN_LINKS : STAFF_LINKS;

  const handleLogout = () => {
    close();
    localStorage.removeItem('wqr_token');
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar">
      <Link to={isAdmin() ? '/' : '/verify'} className="navbar-logo" onClick={close}>
        <GiDiamondRing className="logo-icon" />
        Cardhub Digital Invitation
      </Link>

      {/* Role chip */}
      {role && (
        <span className={`nav-role-chip nav-role-chip--${role}`}>
          {role === 'admin' ? <MdAdminPanelSettings size={12}/> : <MdShield size={12}/>}
          {role === 'admin' ? 'Admin' : 'Gate Staff'}
        </span>
      )}

      <button className="nav-hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
        {open ? <MdClose /> : <MdMenu />}
      </button>

      {open && <div className="nav-overlay" onClick={close} aria-hidden="true" />}

      <ul className={`navbar-links${open ? ' open' : ''}`}>
        {links.map(({ to, end, icon, label }) => (
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
