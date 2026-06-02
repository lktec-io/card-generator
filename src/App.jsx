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
import { isLoggedIn, isAdmin }  from './utils/auth';
import './styles/global.css';
import './App.css';

// Any logged-in user
function ProtectedRoute({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

// Admin-only: gate staff gets redirected to /verify
function AdminRoute({ children }) {
  if (!isLoggedIn())  return <Navigate to="/login"  replace />;
  if (!isAdmin())     return <Navigate to="/verify" replace />;
  return children;
}

function AppShell() {
  const { pathname } = useLocation();
  const noNav = pathname === '/login' || pathname.startsWith('/invite/');

  return (
    <>
      <div className="bg" aria-hidden="true" />
      {!noNav && <Navbar />}
      <main>
        <Routes>
          {/* Public — no auth */}
          <Route path="/login"        element={<LoginPage />} />
          <Route path="/invite/:code" element={<PublicInvitePage />} />

          {/* Any authenticated user */}
          <Route path="/verify" element={<ProtectedRoute><VerifyPage /></ProtectedRoute>} />

          {/* Admin only */}
          <Route path="/"           element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/events"     element={<AdminRoute><EventsPage /></AdminRoute>} />
          <Route path="/events/:id" element={<AdminRoute><EventDetailPage /></AdminRoute>} />
          <Route path="/create"     element={<AdminRoute><CreatePage /></AdminRoute>} />
          <Route path="/history"    element={<AdminRoute><VerificationHistoryPage /></AdminRoute>} />
          <Route path="/admin"      element={<AdminRoute><AdminPage /></AdminRoute>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return <AppShell />;
}
