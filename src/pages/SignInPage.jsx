import { useState } from 'react';
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight } from 'react-icons/fi';
import '../styles/sign-in.css';

/**
 * Sign-in screen — presentation only.
 *
 * Holds just enough state for the form to feel alive (values, reveal toggle, remember,
 * a short pretend submit). There is no auth here by design: to put this live, keep your
 * existing handleSubmit from LoginPage.jsx and swap the markup in.
 */
export default function SignInPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember]         = useState(true);
  const [loading, setLoading]           = useState(false);
  const [logoFailed, setLogoFailed]     = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const canSubmit = form.email.trim() && form.password && !loading;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    // Placeholder only — replace with your real sign-in call
    setTimeout(() => setLoading(false), 1400);
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
            The monogram is rendered only if that file is genuinely missing. */}
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
                value={form.email}
                onChange={update('email')}
                placeholder="you@example.com"
                autoComplete="email"
                disabled={loading}
              />
            </div>
          </div>

          <div className="si-field">
            <label htmlFor="si-password">Password</label>
            <div className="si-input-wrap">
              <FiLock className="si-input-icon" aria-hidden="true" />
              <input
                id="si-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={update('password')}
                placeholder="••••••••"
                autoComplete="current-password"
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

            <a className="si-forgot" href="#forgot">Forgot password?</a>
          </div>

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
