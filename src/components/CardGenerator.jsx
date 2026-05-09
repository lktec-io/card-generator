import { useState, useRef } from 'react';
import QRCode     from 'qrcode';
import html2canvas from 'html2canvas';
import { reserveCard } from '../utils/api';
import { MdAutoAwesome, MdDownload } from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

export default function CardGenerator() {
  const cardRef  = useRef(null);

  const [guestName,   setGuestName]   = useState('');
  const [invitation,  setInvitation]  = useState(null); // { guest_name, invitation_code, qr_data_url }
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [error,       setError]       = useState('');

  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  const handleGenerate = async () => {
    const name = guestName.trim();
    if (!name) return setError('Guest name is required.');

    setLoading(true);
    setError('');
    setProgress(10);
    await new Promise((r) => setTimeout(r, 0)); // yield → UI repaints instantly

    try {
      // 1 — Reserve a unique CN code from backend
      setProgress(30);
      const { data } = await reserveCard(name);

      // 2 — Generate QR client-side (once, stored in state, reused for download)
      setProgress(65);
      const qrDataUrl = await QRCode.toDataURL(
        JSON.stringify({ code: data.code, name: data.guest_name }),
        { errorCorrectionLevel: 'L', margin: 1, width: 160 }
      );

      setProgress(90);
      setInvitation({
        guest_name:      data.guest_name,
        invitation_code: data.code,
        qr_data_url:     qrDataUrl,
      });
      finishProgress();
    } catch (err) {
      setError(err.response?.data?.message || 'Generation failed. Please try again.');
      setProgress(0);
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!cardRef.current || !invitation) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale:      2,          // 2× resolution for print quality
        useCORS:    true,
        allowTaint: false,
        logging:    false,
      });
      const link      = document.createElement('a');
      link.download   = `${invitation.invitation_code}.png`;
      link.href       = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('[html2canvas]', err);
      setError('Download failed — please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setGuestName('');
    setInvitation(null);
    setError('');
    setProgress(0);
  };

  return (
    <>
      {/* YouTube-style top progress bar */}
      {progress > 0 && (
        <div
          className="top-loader"
          style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
        />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>Create Invitation Card</h1>
          <p>Enter the guest name — QR code and invitation number are generated automatically.</p>
        </div>

        <div className="create-layout">

          {/* ── Left: form ── */}
          <div className="form-panel">
            <div className="form-group">
              <label htmlFor="guestName">Guest Name</label>
              <input
                id="guestName"
                type="text"
                placeholder="e.g. John & Jane Doe"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && guestName.trim() && handleGenerate()}
                maxLength={100}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button
              className="btn-gold"
              onClick={handleGenerate}
              disabled={loading || !guestName.trim()}
            >
              {loading
                ? <><div className="btn-spinner" /> Generating…</>
                : <><MdAutoAwesome size={17} /> Generate Card</>
              }
            </button>

            {invitation && (
              <div className="inv-summary">
                <p className="inv-code">{invitation.invitation_code}</p>
                <p className="inv-name">{invitation.guest_name}</p>
              </div>
            )}
          </div>

          {/* ── Right: card preview + download ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your invitation…</p>
              </div>
            ) : !invitation ? (
              <div className="result-placeholder">
                <div className="result-placeholder-icon">🎴</div>
                <p>Card preview will appear here</p>
              </div>
            ) : (
              <div className="result-card fade">

                {/* ── Card template with overlaid dynamic elements ── */}
                <div className="card-template" ref={cardRef}>
                  {/* Background template image — place your final design at /card-template.jpg */}
                  <img
                    src="/card-template.jpg"
                    className="template-bg"
                    alt="Invitation card template"
                    crossOrigin="anonymous"
                  />

                  {/* Guest name — position matches placeholder on your template */}
                  <div className="guest-name">
                    {invitation.guest_name}
                  </div>

                  {/* Invitation code — position matches placeholder on your template */}
                  <div className="invitation-code">
                    {invitation.invitation_code}
                  </div>

                  {/* QR code — fits inside the QR box on your template */}
                  <div className="qr-wrapper">
                    <img src={invitation.qr_data_url} alt="QR Code" />
                  </div>
                </div>

                {/* ── Actions ── */}
                <div className="result-actions">
                  <button
                    className="btn-gold"
                    onClick={handleDownload}
                    disabled={downloading}
                  >
                    <MdDownload size={17} />
                    {downloading ? 'Saving…' : 'Download PNG'}
                  </button>
                  <button className="btn-outline" onClick={handleReset}>
                    <FiRefreshCw size={15} /> New Card
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
