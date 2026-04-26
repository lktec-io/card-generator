import { useState, useCallback } from 'react';
import { MdQrCodeScanner } from 'react-icons/md';
import QRScanner from '../components/QRScanner';
import Popup     from '../components/Popup';
import { verifyCode } from '../utils/api';
import { playSuccess, playError } from '../utils/sounds';
import '../styles/verifier.css';

export default function VerifyPage() {
  const [scannerActive, setScannerActive] = useState(true);
  const [popup,  setPopup]  = useState(null);
  const [loading, setLoading] = useState(false);

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
      setPopup({ type: 'invalid', name: '', message: 'Network error — check server connection.' });
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
      <div className="verify-center">
        <div className="scanner-card">
          <span className="scanner-ornament">— Guest Verification —</span>
          <h2><MdQrCodeScanner style={{ verticalAlign: 'middle', marginRight: '0.3rem', fontSize: '1.6rem' }} />Scan Invitation</h2>
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
