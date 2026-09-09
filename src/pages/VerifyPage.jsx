import { useState, useCallback, useRef, useEffect } from 'react';
import { MdQrCodeScanner, MdKeyboard, MdVerified, MdPersonSearch, MdClose } from 'react-icons/md';
import QRScanner from '../components/QRScanner';
import Popup     from '../components/Popup';
import { verifyCode, verifyManual, searchGuests } from '../utils/api';
import { playSuccess, playError } from '../utils/sounds';
import '../styles/verifier.css';

const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE  = 350;

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

  // ── Guest name search state ───────────────────────────────────────────
  const [searchTerm,     setSearchTerm]     = useState('');
  const [searchResults,  setSearchResults]  = useState([]);
  const [searching,      setSearching]      = useState(false);
  const [searched,       setSearched]       = useState(false);
  const [selectedGuest,  setSelectedGuest]  = useState(null);
  const [searchVerifying, setSearchVerifying] = useState(false);
  const [searchPopup,    setSearchPopup]    = useState(null);

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

  // ── Guest name search ─────────────────────────────────────────────────
  // Debounced backend lookup. Stale in-flight requests are aborted so a slow
  // response for an earlier keystroke can never overwrite newer results.

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < SEARCH_MIN_CHARS) {
      setSearchResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const { data } = await searchGuests(term, { signal: controller.signal });
        setSearchResults(data.guests || []);
        setSearched(true);
      } catch (err) {
        if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') return;
        setSearchResults([]);
        setSearched(true);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, SEARCH_DEBOUNCE);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchTerm]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setSearchResults([]);
    setSearched(false);
    setSelectedGuest(null);
  }, []);

  // Reuses the EXISTING manual check-in endpoint — no separate check-in path.
  const handleSearchVerify = async () => {
    if (!selectedGuest || searchVerifying) return;
    setSearchVerifying(true);
    try {
      const { data } = await verifyManual(selectedGuest.invitation_code);
      if (data.success) {
        playSuccess();
        setSearchPopup({ type: 'success', name: data.name, message: data.message });
      } else if (data.type === 'not_applicable') {
        setSearchPopup({
          type: 'info', name: data.name || '',
          message: data.message || 'Tukio hili ni kampeni ya michango — uthibitishaji wa QR haupatikani.',
        });
      } else if (data.type === 'used') {
        playError();
        setSearchPopup({ type: 'error', name: data.name || '', message: data.message });
      } else {
        playError();
        setSearchPopup({ type: 'invalid', name: '', message: data.message });
      }
    } catch {
      playError();
      setSearchPopup({ type: 'invalid', name: '', message: 'Network error — check server connection.' });
    } finally {
      setSearchVerifying(false);
    }
  };

  const handleSearchClose = useCallback(() => {
    setSearchPopup(null);
    clearSearch();
  }, [clearSearch]);

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

        {/* ── Search guest by name card ── */}
        <div className="manual-card">
          <span className="scanner-ornament">— Lost the Card? —</span>
          <h2>
            <MdPersonSearch style={{ verticalAlign: 'middle', marginRight: '0.3rem', fontSize: '1.5rem' }} />
            Search Guest by Name
          </h2>
          <p>Find the guest, confirm the details, then verify</p>

          <div className="guest-search-wrap">
            <input
              type="text"
              className="guest-search-input"
              placeholder="Enter guest name…"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setSelectedGuest(null); }}
              autoComplete="off"
              spellCheck={false}
              disabled={searchVerifying}
            />
            {searchTerm && (
              <button className="guest-search-clear" onClick={clearSearch} aria-label="Clear search">
                <MdClose size={16} />
              </button>
            )}
          </div>

          {/* Results — hidden once a guest is selected */}
          {!selectedGuest && (
            <>
              {searching && (
                <div className="guest-search-status">
                  <div className="verify-spinner manual-spinner" /> Searching…
                </div>
              )}
              {!searching && searchTerm.trim().length > 0 &&
               searchTerm.trim().length < SEARCH_MIN_CHARS && (
                <div className="guest-search-status">
                  Type at least {SEARCH_MIN_CHARS} characters
                </div>
              )}
              {!searching && searched && searchResults.length === 0 && (
                <div className="guest-search-status">No guest found</div>
              )}
              {!searching && searchResults.length > 0 && (
                <ul className="guest-result-list">
                  {searchResults.map((g) => (
                    <li key={g.id}>
                      <button
                        className="guest-result-item"
                        onClick={() => setSelectedGuest(g)}
                      >
                        <span className="guest-result-name">{g.guest_name}</span>
                        <span className="guest-result-meta">
                          <span className="guest-result-code">{g.invitation_code}</span>
                          {g.status === 'used' && (
                            <span className="guest-result-used">Already used</span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {/* Confirmation — make sure staff picked the right person */}
          {selectedGuest && (
            <div className="guest-confirm">
              <div className="guest-confirm-row">
                <span className="guest-confirm-label">Guest Name</span>
                <span className="guest-confirm-value">{selectedGuest.guest_name}</span>
              </div>
              <div className="guest-confirm-row">
                <span className="guest-confirm-label">Invitation Code</span>
                <span className="guest-confirm-value guest-confirm-code">
                  {selectedGuest.invitation_code}
                </span>
              </div>

              <button
                className="btn-gold manual-btn"
                onClick={handleSearchVerify}
                disabled={searchVerifying}
              >
                {searchVerifying ? (
                  <><div className="verify-spinner manual-spinner" /> Verifying…</>
                ) : (
                  <><MdVerified size={17} /> Verify Guest</>
                )}
              </button>
              <button
                className="guest-confirm-back"
                onClick={() => setSelectedGuest(null)}
                disabled={searchVerifying}
              >
                Choose a different guest
              </button>
            </div>
          )}
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

      {/* Name search popup */}
      {searchPopup && (
        <Popup
          type={searchPopup.type}
          name={searchPopup.name}
          message={searchPopup.message}
          onClose={handleSearchClose}
        />
      )}
    </div>
  );
}
