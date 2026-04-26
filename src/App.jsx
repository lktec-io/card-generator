import { Routes, Route } from 'react-router-dom';
import Navbar         from './components/Navbar';
import DashboardPage  from './pages/DashboardPage';
import CreatePage     from './pages/CreatePage';
import VerifyPage     from './pages/VerifyPage';
import AdminPage      from './pages/AdminPage';      // legacy full-table view
import './styles/global.css';
import './App.css';

export default function App() {
  return (
    <>
      <Navbar />
      <main>
        <Routes>
          <Route path="/"        element={<DashboardPage />} />
          <Route path="/create"  element={<CreatePage />} />
          <Route path="/verify"  element={<VerifyPage />} />
          <Route path="/admin"   element={<AdminPage />} />
        </Routes>
      </main>
    </>
  );
}
