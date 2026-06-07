import { useState, useCallback, useRef } from 'react';
import { MdQrCodeScanner, MdKeyboard, MdVerified } from 'react-icons/md';
import QRScanner from '../components/QRScanner';
import Popup     from '../components/Popup';
import { verifyCode, verifyManual } from '../utils/api';
import { playSuccess, playError } from '../utils/sounds';
import '../styles/verifier.css';

export default function VerifyPage() {
  // ── QR scanner state (unchanged) ─────────────────────────────────────
  const [scannerActive, setScannerActive] = useState(true);
  const [popup,         setPopup]         = useState(null);
  const [loading,       setLoading]       = useState(false);

  // ── Manual verification state ─────────────────────────────────────────
  const [manualCode,    setManualCode]    = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualPopup,   setManualPopup]   = useState(null);
  const inputRef = useRef(null);

  // ── QR handlers (unchanged) ───────────────────────────────────────────

  const handleResult = useCallback(async (code) => {
    setScannerActive(false);
    setLoading(true);
    try {
      const { data } = await verifyCode(code);
      if (data.success) {
        playSuccess();
        setPopup({ type: 'success', name: data.name, message: data.message });
      } else if (data.type === 'not_applicable') {
        setPopup({
          type: 'info', name: data.name || '',
          message: data.message || 'Tukio hili ni kampeni ya michango — uthibitishaji wa QR haupatikani.',
        });
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

  // ── Manual handlers ───────────────────────────────────────────────────

  const handleManualVerify = async () => {
    if (!manualCode.trim()) return;
    const fullCode = `CN-${manualCode.padStart(3, '0')}`;
    setManualLoading(true);
    try {
      const { data } = await verifyManual(fullCode);
      if (data.success) {
        playSuccess();
        setManualPopup({ type: 'success', name: data.name, message: data.message });
      } else if (data.type === 'not_applicable') {
        setManualPopup({
          type: 'info', name: data.name || '',
          message: data.message || 'Tukio hili ni kampeni ya michango — uthibitishaji wa QR haupatikani.',
        });
      } else if (data.type === 'used') {
        playError();
        setManualPopup({ type: 'error', name: data.name || '', message: data.message });
      } else {
        playError();
        setManualPopup({ type: 'invalid', name: '', message: data.message });
      }
    } catch {
      playError();
      setManualPopup({ type: 'invalid', name: '', message: 'Network error — check server connection.' });
    } finally {
      setManualLoading(false);
      setManualCode('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleManualClose = useCallback(() => setManualPopup(null), []);

  const handleManualKey = (e) => {
    if (e.key === 'Enter' && !manualLoading && manualCode.trim()) handleManualVerify();
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="verify-page">
      <div className="verify-center">

        {/* ── QR Scanner card (unchanged) ── */}
        <div className="scanner-card">
          <span className="scanner-ornament">— Guest Verification —</span>
          <h2>
            <MdQrCodeScanner style={{ verticalAlign: 'middle', marginRight: '0.3rem', fontSize: '1.6rem' }} />
            Scan Invitation
          </h2>
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

        {/* ── Manual CN verification card ── */}
        <div className="manual-card">
          <span className="scanner-ornament">— No Smartphone? —</span>
          <h2>
            <MdKeyboard style={{ verticalAlign: 'middle', marginRight: '0.3rem', fontSize: '1.5rem' }} />
            Manual Verification
          </h2>
          <p>Type the invitation code printed on the card</p>

          <div className="manual-input-group">
            <div className="cn-input-wrap">
              <span className="cn-prefix">CN-</span>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="manual-input cn-number-input"
                placeholder="001"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={handleManualKey}
                autoComplete="off"
                spellCheck={false}
                disabled={manualLoading}
              />
            </div>
            <button
              className="btn-gold manual-btn"
              onClick={handleManualVerify}
              disabled={manualLoading || !manualCode.trim()}
            >
              {manualLoading ? (
                <><div className="verify-spinner manual-spinner" /> Verifying…</>
              ) : (
                <><MdVerified size={17} /> Verify Guest</>
              )}
            </button>
          </div>
        </div>

      </div>

      {/* QR popup */}
      {popup && (
        <Popup
          type={popup.type}
          name={popup.name}
          message={popup.message}
          onClose={handleClose}
        />
      )}

      {/* Manual popup */}
      {manualPopup && (
        <Popup
          type={manualPopup.type}
          name={manualPopup.name}
          message={manualPopup.message}
          onClose={handleManualClose}
        />
      )}
    </div>
  );
}
