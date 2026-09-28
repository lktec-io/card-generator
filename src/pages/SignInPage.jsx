import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight, FiAlertCircle } from 'react-icons/fi';
import { login } from '../utils/api';
import '../styles/sign-in.css';

// Remembered email only — a password is never stored
const REMEMBER_KEY = 'cardhub_remember_email';

const readRemembered = () => {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; }
};

export default function SignInPage() {
  const [email,        setEmail]        = useState(readRemembered);
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember,     setRemember]     = useState(true);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [hint,         setHint]         = useState('');
  const [logoFailed,   setLogoFailed]   = useState(false);
  const navigate = useNavigate();
  // State updates are async, so rapid repeat clicks can all pass a state-based check —
  // this ref blocks a second request synchronously.
  const submitting = useRef(false);

  const canSubmit = email.trim() && password && !loading;

  /* Authentication — carried over unchanged from the previous login page:
     same API call, same token key, same role-based redirects, same error handling. */
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting.current) return;          // guards against a double submit
    submitting.current = true;
    setError('');
    setHint('');
    setLoading(true);
    try {
      const { data } = await login(email.trim(), password);
      if (data.success) {
        localStorage.setItem('wqr_token', data.token);
        // Remember the address only, never the password
        try {
          if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
          else localStorage.removeItem(REMEMBER_KEY);
        } catch { /* private mode — not worth failing the sign-in over */ }

        if (data.role === 'verifier' || data.role === 'gate_staff') {
          navigate('/verify', { replace: true });
        } else if (data.role === 'event_manager') {
          navigate('/events', { replace: true });
        } else {
          // admin and super_admin both go to dashboard
          navigate('/', { replace: true });
        }
      } else {
        setError(data.message || 'Login failed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Network error — try again.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="si-page">
      {/* Decorative layers: warm light, soft bokeh, a faint monogram ring */}
      <div className="si-glow" aria-hidden="true" />
      <div className="si-bokeh" aria-hidden="true" />
      <div className="si-ring" aria-hidden="true" />

      <main className="si-card">
        {/* ── Logo ─────────────────────────────────────────────────────────
            File lives at  public/logo.png  →  served by Vite at  /logo.png
            The monogram renders only if that file is genuinely missing. */}
        <div className="logo-container">
          {logoFailed ? (
            <span className="logo-fallback" aria-hidden="true">C</span>
          ) : (
            <img
              src="/logo.png"
              alt="Cardhub"
              className="logo-image"
              onError={() => setLogoFailed(true)}
            />
          )}
        </div>

        <header className="si-head">
          <h1 className="si-title">Cardhub</h1>
          <p className="si-kicker">Digital Invitations</p>
          <span className="si-rule" aria-hidden="true" />
          <p className="si-welcome">Welcome back</p>
          <p className="si-sub">Sign in to manage your events and guest lists</p>
        </header>

        <form className="si-form" onSubmit={handleSubmit} noValidate>
          <div className="si-field">
            <label htmlFor="si-email">Email address</label>
            <div className="si-input-wrap">
              <FiMail className="si-input-icon" aria-hidden="true" />
              <input
                id="si-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="si-field">
            <label htmlFor="si-password">Password</label>
            {/* spellCheck/autoCorrect off: once revealed as text, the password must not
                be sent to spellcheck or autocorrect */}
            <div className="si-input-wrap">
              <FiLock className="si-input-icon" aria-hidden="true" />
              <input
                id="si-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={loading}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <button
                type="button"
                className="si-reveal"
                onClick={() => setShowPassword((v) => !v)}
                onMouseDown={(e) => e.preventDefault()}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls="si-password"
                disabled={loading}
              >
                {showPassword ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className="si-row">
            <label className="si-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={loading}
              />
              <span className="si-box" aria-hidden="true" />
              <span>Remember me</span>
            </label>

            {/* No self-service reset exists yet — point this at a real route when it does */}
            <button
              type="button"
              className="si-forgot"
              onClick={() => setHint('Ask your administrator to reset your password.')}
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <p className="si-error" role="alert">
              <FiAlertCircle aria-hidden="true" /> {error}
            </p>
          )}
          {hint && !error && <p className="si-hint">{hint}</p>}

          <button type="submit" className="si-submit" disabled={!canSubmit}>
            {loading ? (
              <><span className="si-spinner" aria-hidden="true" /> Signing in…</>
            ) : (
              <>Sign In <FiArrowRight className="si-submit-arrow" aria-hidden="true" /></>
            )}
          </button>
        </form>

        <p className="si-foot">Crafted for unforgettable celebrations</p>
      </main>
    </div>
  );
}
