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
import { isLoggedIn, isAdmin, canManage } from './utils/auth';
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

function ManagerRoute({ children }) {
  if (!isLoggedIn())  return <Navigate to="/login"  replace />;
  if (!canManage())   return <Navigate to="/verify" replace />;
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
          <Route path="/display/:uuid" element={<ManagerRoute><PublicInvitePage isPreview /></ManagerRoute>} />

          {/* Manager+ */}
          <Route path="/verify"  element={<ManagerRoute><VerifyPage /></ManagerRoute>} />
          <Route path="/history" element={<ManagerRoute><VerificationHistoryPage /></ManagerRoute>} />

          {/* Admin only */}
          <Route path="/"       element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/admin"  element={<AdminRoute><AdminPage /></AdminRoute>} />
          <Route path="/users"  element={<AdminRoute><UsersPage /></AdminRoute>} />

          {/* Manager+ (admin or event_manager) */}
          <Route path="/events"     element={<ManagerRoute><EventsPage /></ManagerRoute>} />
          <Route path="/events/:id" element={<ManagerRoute><EventDetailPage /></ManagerRoute>} />
          <Route path="/create"     element={<ManagerRoute><CreatePage /></ManagerRoute>} />
          <Route path="/import"     element={<ManagerRoute><ImportPage /></ManagerRoute>} />
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
