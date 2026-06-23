import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar                   from './components/Navbar';
import DashboardPage            from './pages/DashboardPage';
import CreatePage               from './pages/CreatePage';
import VerifyPage               from './pages/VerifyPage';
import AdminPage                from './pages/AdminPage';
import LoginPage                from './pages/LoginPage';
import EventsPage               from './pages/EventsPage';
import EventDetailPage          from './pages/EventDetailPage';
import VerificationHistoryPage  from './pages/VerificationHistoryPage';
import PublicInvitePage         from './pages/PublicInvitePage';
import ImportPage               from './pages/ImportPage';
import UsersPage                from './pages/UsersPage';
import { ToastProvider }        from './context/ToastContext';
import { isLoggedIn, isAdmin, canManage, getRole } from './utils/auth';
import './styles/global.css';
import './App.css';

function ProtectedRoute({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  if (!isLoggedIn()) return <Navigate to="/login"  replace />;
  if (!isAdmin())    return <Navigate to="/verify" replace />;
  return children;
}

// Operational routes: admin or event_manager only; super_admin → dashboard
function OperationalRoute({ children }) {
  if (!isLoggedIn())               return <Navigate to="/login" replace />;
  if (getRole() === 'super_admin') return <Navigate to="/"      replace />;
  if (!canManage())                return <Navigate to="/verify" replace />;
  return children;
}

// Field routes: any logged-in non-super_admin user (managers, verifiers)
function FieldRoute({ children }) {
  if (!isLoggedIn())               return <Navigate to="/login" replace />;
  if (getRole() === 'super_admin') return <Navigate to="/"      replace />;
  return children;
}

function AppShell() {
  const { pathname } = useLocation();
  const noNav = pathname === '/login'
    || pathname.startsWith('/invite/')
    || pathname.startsWith('/display/');

  return (
    <>
      <div className="bg" aria-hidden="true" />
      {!noNav && <Navbar />}
      <main>
        <Routes>
          {/* Public */}
          <Route path="/login"         element={<LoginPage />} />
          <Route path="/invite/:uuid"  element={<PublicInvitePage />} />
          <Route path="/display/:uuid" element={<FieldRoute><PublicInvitePage isPreview /></FieldRoute>} />

          {/* Field routes — logged-in non-super_admin (admin, event_manager, verifier) */}
          <Route path="/verify"  element={<FieldRoute><VerifyPage /></FieldRoute>} />
          <Route path="/history" element={<FieldRoute><VerificationHistoryPage /></FieldRoute>} />

          {/* Admin only (admin + super_admin) */}
          <Route path="/"       element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/admin"  element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/users"  element={<AdminRoute><UsersPage /></AdminRoute>} />

          {/* Operational routes — admin or event_manager only (NOT super_admin) */}
          <Route path="/events"     element={<OperationalRoute><EventsPage /></OperationalRoute>} />
          <Route path="/events/:id" element={<OperationalRoute><EventDetailPage /></OperationalRoute>} />
          <Route path="/create"     element={<OperationalRoute><CreatePage /></OperationalRoute>} />
          <Route path="/import"     element={<OperationalRoute><ImportPage /></OperationalRoute>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
