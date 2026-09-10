import { useEffect, useRef } from 'react';
import { MdCheck, MdCancel, MdWarning, MdInfo } from 'react-icons/md';
import { celebrateVerification } from '../utils/confettiCelebration';

// Non-success states — rendered exactly as before
const CONFIG = {
  error:   { Icon: MdCancel,  title: () => 'Already Scanned'     },
  invalid: { Icon: MdWarning, title: () => 'Invalid Code'        },
  info:    { Icon: MdInfo,    title: () => 'Not a Check-in Code' },
};

export default function Popup({ type, name, message, onClose, cardType, code }) {
  const isSuccess     = type === 'success';
  const celebratedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

  // Decorative only — fires once per success popup, after paint, never blocks.
  // The ref guard keeps StrictMode's double effect invocation from firing twice.
  useEffect(() => {
    if (!isSuccess || celebratedRef.current) return;
    celebratedRef.current = true;
    celebrateVerification();
  }, [isSuccess]);

  if (isSuccess) {
    const isDouble = cardType === 'double';

    return (
      <div
        className="popup-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Valid guest"
        onClick={onClose}
      >
        <div
          className="popup-card success popup-valid"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="valid-check" aria-hidden="true">
            <span className="valid-check__ring" />
            <MdCheck className="valid-check__icon" />
          </div>

          <p className="valid-label">Valid Guest</p>

          <h2 className="valid-welcome">
            <span className="valid-welcome__prefix">Welcome</span>
            {name && <>{' '}<span className="valid-welcome__name">{name}</span></>}
          </h2>

          <p className="valid-subtitle">Invitation Verified Successfully</p>

          {(cardType || code) && (
            <div className="popup-details">
              {cardType && (
                <span className={`popup-type popup-type--${isDouble ? 'double' : 'single'}`}>
                  {isDouble ? 'DOUBLE' : 'SINGLE'}
                </span>
              )}
              {code && <span className="popup-code">{code}</span>}
            </div>
          )}

          <button className="btn-gold popup-btn" onClick={onClose}>
            Scan Again
          </button>
        </div>
      </div>
    );
  }

  const { Icon, title } = CONFIG[type] || CONFIG.invalid;

  return (
    <div className="popup-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className={`popup-card ${type}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-icon">
          <Icon size={32} />
        </div>

        <h2 className="popup-title">{title(name)}</h2>
        <p className="popup-message">{message}</p>

        <button className="btn-gold popup-btn" onClick={onClose}>
          Scan Again
        </button>
      </div>
    </div>
  );
}
