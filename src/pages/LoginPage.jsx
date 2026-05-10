import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GiDiamondRing } from 'react-icons/gi';
import { MdLock, MdEmail, MdLogin } from 'react-icons/md';
import { login } from '../utils/api';
import '../styles/login.css';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await login(email.trim(), password);
      if (data.success) {
        localStorage.setItem('wqr_token', data.token);
        navigate('/', { replace: true });
      } else {
        setError(data.message || 'Login failed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Network error — try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <GiDiamondRing className="login-ring-icon" />
          <h1>Dating to Marriage talk</h1>
          <p>Wedding Invitation System</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="login-email">
              <MdEmail size={15} /> Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@wedding.com"
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">
              <MdLock size={15} /> Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button
            type="submit"
            className="login-btn"
            disabled={loading || !email || !password}
          >
            {loading ? (
              <><span className="login-spinner" /> Signing in…</>
            ) : (
              <><MdLogin size={18} /> Sign In</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
