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
import './styles/global.css';
import './App.css';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('wqr_token');
  return token ? children : <Navigate to="/login" replace />;
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

          {/* Protected */}
          <Route path="/"        element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/events"  element={<ProtectedRoute><EventsPage /></ProtectedRoute>} />
          <Route path="/events/:id" element={<ProtectedRoute><EventDetailPage /></ProtectedRoute>} />
          <Route path="/create"  element={<ProtectedRoute><CreatePage /></ProtectedRoute>} />
          <Route path="/verify"  element={<ProtectedRoute><VerifyPage /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><VerificationHistoryPage /></ProtectedRoute>} />
          <Route path="/admin"   element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return <AppShell />;
}
