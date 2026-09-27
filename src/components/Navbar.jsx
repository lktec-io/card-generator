import { useState, useEffect } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import {
  MdDashboard, MdQrCodeScanner, MdAdminPanelSettings,
  MdMenu, MdClose, MdAddPhotoAlternate, MdLogout,
  MdEvent, MdHistory, MdShield, MdUploadFile,
  MdPeople,
} from 'react-icons/md';
import { isAdmin, isSuperAdmin, isEventManager, canManage, getRole, getUserName } from '../utils/auth';
import '../styles/components.css';

// Super admin: platform owner — no operational access
const SUPER_ADMIN_LINKS = [
  { to: '/',      end: true,  icon: <MdDashboard size={16} />,          label: 'Dashboard' },
  { to: '/users', end: false, icon: <MdPeople size={16} />,             label: 'Users'     },
  { to: '/history', end: false, icon: <MdHistory size={16} />,          label: 'History'   },
  { to: '/admin', end: false, icon: <MdAdminPanelSettings size={16} />, label: 'Admin'     },
];

const ADMIN_LINKS = [
  { to: '/',        end: true,  icon: <MdDashboard size={16} />,          label: 'Dashboard'    },
  { to: '/events',  end: false, icon: <MdEvent size={16} />,              label: 'Events'       },
  { to: '/create',  end: false, icon: <MdAddPhotoAlternate size={16} />,  label: 'Create Cards' },
  { to: '/import',  end: false, icon: <MdUploadFile size={16} />,         label: 'Import'       },
  { to: '/verify',  end: false, icon: <MdQrCodeScanner size={16} />,      label: 'Verify'       },
  { to: '/history', end: false, icon: <MdHistory size={16} />,            label: 'History'      },
  { to: '/users',   end: false, icon: <MdPeople size={16} />,             label: 'Users'        },
  { to: '/admin',   end: false, icon: <MdAdminPanelSettings size={16} />, label: 'Admin'        },
];

const MANAGER_LINKS = [
  { to: '/events',  end: false, icon: <MdEvent size={16} />,             label: 'Events'       },
  { to: '/create',  end: false, icon: <MdAddPhotoAlternate size={16} />, label: 'Create Cards' },
  { to: '/import',  end: false, icon: <MdUploadFile size={16} />,        label: 'Import'       },
  { to: '/verify',  end: false, icon: <MdQrCodeScanner size={16} />,     label: 'Verify'       },
  { to: '/history', end: false, icon: <MdHistory size={16} />,           label: 'History'      },
];

const VERIFIER_LINKS = [
  { to: '/verify',  end: false, icon: <MdQrCodeScanner size={16} />, label: 'Scan & Verify'   },
  { to: '/history', end: false, icon: <MdHistory size={16} />,       label: 'My Scan History' },
];

function getRoleLabel(role) {
  if (role === 'super_admin')   return 'Super Admin';
  if (role === 'admin')         return 'Admin';
  if (role === 'event_manager') return 'Manager';
  return 'Verifier';
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const close = () => setOpen(false);

  // Close on navigation, so the menu never stays open behind a new page
  useEffect(close, [location.pathname]);

  // Escape closes it; lock page scroll while it covers the screen
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    // If the viewport grows past the collapse breakpoint the row layout returns,
    // so drop the open state to keep it consistent.
    const onResize = () => { if (window.innerWidth >= 1280) close(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prev || '';
    };
  }, [open]);

  const role   = getRole();
  const name   = getUserName();
  const links  = isSuperAdmin() ? SUPER_ADMIN_LINKS : isAdmin() ? ADMIN_LINKS : isEventManager() ? MANAGER_LINKS : VERIFIER_LINKS;
  const logoTo = isSuperAdmin() || isAdmin() ? '/' : canManage() ? '/events' : '/verify';

  const handleLogout = () => {
    close();
    localStorage.removeItem('wqr_token');
    navigate('/login', { replace: true });
  };

  return (
    <nav className="navbar">
      <Link to={logoTo} className="navbar-logo" onClick={close}>
        <GiDiamondRing className="logo-icon" />
        Cardhub Digital Invitation
      </Link>

      {/* Role chip */}
      {role && (
        <span className={`nav-role-chip nav-role-chip--${role}`}>
          {(role === 'admin' || role === 'super_admin')
            ? <MdAdminPanelSettings size={12}/>
            : role === 'event_manager'
              ? <MdPeople size={12}/>
              : <MdShield size={12}/>
          }
          {name ? `${getRoleLabel(role)}: ${name}` : getRoleLabel(role)}
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
