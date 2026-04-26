import { useState, useCallback } from 'react';
import QRScanner from '../components/QRScanner';
import Popup     from '../components/Popup';
import { verifyCode } from '../utils/api';
import { playSuccess, playError } from '../utils/sounds';
import '../styles/verifier.css';

export default function VerifyPage() {
  const [scannerActive, setScannerActive] = useState(true);
  const [popup,  setPopup]  = useState(null);  // { type, name, message }
  const [loading, setLoading] = useState(false);

  // Use the last generated card image (if any) as background
  const bgUrl = localStorage.getItem('lastCardUrl');

  const handleResult = useCallback(async (code) => {
    setScannerActive(false);
    setLoading(true);

    try {
      const { data } = await verifyCode(code);

      if (data.success) {
        playSuccess();
        setPopup({ type: 'success', name: data.name, message: data.message });
      } else if (data.type === 'used') {
        playError();
        setPopup({ type: 'error', name: data.name, message: data.message });
      } else {
        playError();
        setPopup({ type: 'invalid', name: '', message: data.message });
      }
    } catch {
      playError();
      setPopup({ type: 'error', name: '', message: 'Network error — check server connection.' });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setPopup(null);
    setScannerActive(true);
  }, []);

  return (
    <div className="verify-page">
      {/* Blurred background */}
      <div
        className="verify-bg"
        style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : {}}
        aria-hidden="true"
      />

      <div className="verify-center">
        <div className="scanner-card">
          <h2>📷 Scan Invitation</h2>
          <p>Point camera at the QR code on the invitation card</p>

          {loading ? (
            <div className="verify-checking">
              <div className="verify-spinner" />
              <p>Verifying…</p>
            </div>
          ) : (
            <QRScanner onResult={handleResult} active={scannerActive} />
          )}
        </div>
      </div>

      {popup && (
        <Popup
          type={popup.type}
          name={popup.name}
          message={popup.message}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
