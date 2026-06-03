import { createContext, useContext, useState, useCallback } from 'react';
import { MdCheckCircle, MdError, MdInfo, MdClose } from 'react-icons/md';
import '../styles/toast.css';

const ToastContext = createContext(null);

let _idCounter = 0;

function ToastItem({ toast, onRemove }) {
  const icons = {
    success: <MdCheckCircle size={18} />,
    error:   <MdError size={18} />,
    info:    <MdInfo size={18} />,
  };
  return (
    <div className={`toast toast--${toast.type}`} role="alert">
      <span className="toast-icon">{icons[toast.type] || icons.info}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={() => onRemove(toast.id)} aria-label="Close">
        <MdClose size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'success', duration = 3000) => {
    const id = ++_idCounter;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]); // max 5 visible
    setTimeout(() => remove(id), duration);
  }, [remove]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
