import { useEffect } from 'react';

/**
 * Popup — full-screen overlay for scan results.
 * Props:
 *   type    {'success'|'error'|'invalid'}
 *   name    {string}   guest name (for success)
 *   message {string}
 *   onClose {Function} called when user clicks "Scan Again"
 */
export default function Popup({ type, name, message, onClose }) {
  // Auto-dismiss after 6 seconds
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

  const isSuccess = type === 'success';

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true">
      <div className={`popup-card ${isSuccess ? 'success' : 'error'}`}>
        <div className="popup-icon">{isSuccess ? '✅' : '❌'}</div>

        <h2 className="popup-title">
          {isSuccess ? `Welcome, ${name}!` : 'Access Denied'}
        </h2>

        <p className="popup-message">{message}</p>

        <button className="btn-gold popup-btn" onClick={onClose}>
          Scan Again
        </button>
      </div>
    </div>
  );
}
