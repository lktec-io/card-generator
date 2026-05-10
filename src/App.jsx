import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Navbar        from './components/Navbar';
import DashboardPage from './pages/DashboardPage';
import CreatePage    from './pages/CreatePage';
import VerifyPage    from './pages/VerifyPage';
import AdminPage     from './pages/AdminPage';
import LoginPage     from './pages/LoginPage';
import './styles/global.css';
import './App.css';

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('wqr_token');
  return token ? children : <Navigate to="/login" replace />;
}

function AppShell() {
  const { pathname } = useLocation();
  const isLogin = pathname === '/login';

  return (
    <>
      <div className="bg" aria-hidden="true" />
      {!isLogin && <Navbar />}
      <main>
        <Routes>
          <Route path="/login"  element={<LoginPage />} />
          <Route path="/"       element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/create" element={<ProtectedRoute><CreatePage /></ProtectedRoute>} />
          <Route path="/verify" element={<ProtectedRoute><VerifyPage /></ProtectedRoute>} />
          <Route path="/admin"  element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return <AppShell />;
}
