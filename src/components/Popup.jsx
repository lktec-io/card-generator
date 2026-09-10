import { useEffect } from 'react';
import { MdCheckCircle, MdCancel, MdWarning, MdInfo } from 'react-icons/md';

const CONFIG = {
  success:       { Icon: MdCheckCircle, title: (name) => `Welcome, ${name}!`        },
  error:         { Icon: MdCancel,      title: ()     => 'Already Scanned'           },
  invalid:       { Icon: MdWarning,     title: ()     => 'Invalid Code'              },
  info:          { Icon: MdInfo,        title: ()     => 'Not a Check-in Code'       },
};

export default function Popup({ type, name, message, onClose, cardType, code }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

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

        {/* Invitation type + code — shown on successful verification only */}
        {type === 'success' && (cardType || code) && (
          <div className="popup-details">
            {cardType && (
              <span className={`popup-type popup-type--${cardType === 'double' ? 'double' : 'single'}`}>
                {cardType === 'double' ? 'DOUBLE' : 'SINGLE'}
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
