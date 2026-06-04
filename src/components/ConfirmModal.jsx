import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdWarning, MdClose } from 'react-icons/md';
import '../styles/modal.css';

/**
 * Reusable delete / confirm modal.
 * Renders via createPortal directly at document.body so position:fixed
 * is always relative to the viewport — no parent transform can break it.
 *
 * Props:
 *   open          boolean            — controls visibility
 *   title         string             — modal heading
 *   message       string | ReactNode — body text / JSX
 *   confirmLabel  string             — confirm button text  (default: "Delete")
 *   cancelLabel   string             — cancel button text   (default: "Cancel")
 *   danger        boolean            — red confirm button   (default: true)
 *   onConfirm     () => void
 *   onCancel      () => void
 *   icon          ReactNode          — optional custom icon
 */
export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel  = 'Cancel',
  danger       = true,
  onConfirm,
  onCancel,
  icon,
}) {
  // Scroll lock — prevent body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev || ''; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="cm-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cm-title"
    >
      <div
        className="cm-box"
        onClick={e => e.stopPropagation()}
      >
        {/* Close X */}
        <button className="cm-close" onClick={onCancel} aria-label="Close">
          <MdClose size={18} />
        </button>

        {/* Icon */}
        <div className={`cm-icon${danger ? ' cm-icon--danger' : ''}`}>
          {icon ?? <MdWarning size={28} />}
        </div>

        {/* Content */}
        <h3 className="cm-title" id="cm-title">{title}</h3>
        {message && (
          typeof message === 'string'
            ? <p className="cm-message">{message}</p>
            : <div className="cm-message">{message}</div>
        )}

        {/* Actions */}
        <div className="cm-actions">
          <button className="cm-btn-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`cm-btn-confirm${danger ? ' cm-btn-confirm--danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
