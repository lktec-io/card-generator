import { useState, useRef, useEffect, useCallback } from 'react';
import Draggable   from 'react-draggable';
import QRCode      from 'qrcode';
import html2canvas from 'html2canvas';
import { reserveCard } from '../utils/api';
import { MdAutoAwesome, MdDownload, MdAddPhotoAlternate } from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

const DESIGN_W = 1080; // internal canvas width (px) — never changes

export default function CardGenerator() {
  // cardRef   → the unscaled 1080px canvas — what html2canvas captures
  // scaleRef  → the wrapper that receives CSS transform: scale()
  // wrapperRef → the outer div that measures available width + sets explicit height
  const cardRef    = useRef(null);
  const scaleRef   = useRef(null);
  const wrapperRef = useRef(null);

  const qrNodeRef   = useRef(null);
  const nameNodeRef = useRef(null);
  const codeNodeRef = useRef(null);

  const [uploadedImage, setUploadedImage] = useState(null);
  const [dragOver,      setDragOver]      = useState(false);
  const [guestName,     setGuestName]     = useState('');
  const [invitation,    setInvitation]    = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [downloading,   setDownloading]   = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [error,         setError]         = useState('');

  const [canvasScale, setCanvasScale] = useState(1);

  const [qrPos,   setQrPos]   = useState({ x: 0, y: 0 });
  const [namePos, setNamePos] = useState({ x: 0, y: 0 });
  const [codePos, setCodePos] = useState({ x: 0, y: 0 });

  // ── Responsive scale ──────────────────────────────────────────────────
  // The CSS transform is applied to scaleRef (parent of cardRef).
  // cardRef itself has NO transform — html2canvas always captures at full
  // DESIGN_W resolution without any special reset needed.

  const updateScale = useCallback(() => {
    if (!wrapperRef.current || !cardRef.current) return;
    const avail = wrapperRef.current.offsetWidth;
    const scale = avail < DESIGN_W ? avail / DESIGN_W : 1;
    setCanvasScale(scale);
    // Set wrapper height to the visual (scaled) height so no dead space below
    wrapperRef.current.style.height = scale < 1
      ? `${cardRef.current.offsetHeight * scale}px`
      : '';
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);

  const handleBgLoad = () => updateScale();

  // ── Image upload ──────────────────────────────────────────────────────

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setUploadedImage(e.target.result);
    reader.readAsDataURL(file);
    setInvitation(null);
    setError('');
    resetPositions();
  };

  const handleFileChange = (e) => loadFile(e.target.files[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  };

  // ── Generate ──────────────────────────────────────────────────────────

  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  const handleGenerate = async () => {
    if (!uploadedImage) return setError('Please upload a card image first.');
    const name = guestName.trim();
    if (!name) return setError('Guest name is required.');

    setLoading(true);
    setError('');
    setProgress(10);
    resetPositions();
    await new Promise((r) => setTimeout(r, 0));

    try {
      setProgress(30);
      const { data } = await reserveCard(name);

      setProgress(65);
      const qrDataUrl = await QRCode.toDataURL(
        JSON.stringify({ code: data.code, name: data.guest_name }),
        {
          errorCorrectionLevel: 'L', // low density = easier to scan
          margin:               4,   // quiet zone
          width:                400, // generate large, display at CSS size
        }
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

  // ── Download ──────────────────────────────────────────────────────────
  // cardRef has no CSS transform on it — html2canvas always reads the full
  // 1080px canvas, producing a clean high-resolution PNG.

  const handleDownload = async () => {
    if (!cardRef.current || !invitation) return;
    setDownloading(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale:           2,    // 2× → ~2160px wide output
        useCORS:         true,
        allowTaint:      false,
        logging:         false,
        backgroundColor: null,
      });
      const link    = document.createElement('a');
      link.download = `${invitation.invitation_code}.png`;
      link.href     = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('[html2canvas]', err);
      setError('Download failed — please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // ── Reset ─────────────────────────────────────────────────────────────

  const resetPositions = () => {
    setQrPos({ x: 0, y: 0 });
    setNamePos({ x: 0, y: 0 });
    setCodePos({ x: 0, y: 0 });
  };

  const handleReset = () => {
    setUploadedImage(null);
    setGuestName('');
    setInvitation(null);
    setError('');
    setProgress(0);
    resetPositions();
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
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
          <p>Upload your card design, enter the guest name — QR code and invitation number are added automatically.</p>
        </div>

        <div className="create-layout">

          {/* ── Left: form ── */}
          <div className="form-panel">

            <label
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {uploadedImage ? (
                <img src={uploadedImage} alt="Uploaded card" />
              ) : (
                <>
                  <MdAddPhotoAlternate className="upload-icon" />
                  <span className="upload-title">Upload Card Design</span>
                  <span className="upload-sub">Click or drag &amp; drop — JPG, PNG, WebP</span>
                </>
              )}
            </label>

            <div className="form-group">
              <label htmlFor="guestName">Guest Name</label>
              <input
                id="guestName"
                type="text"
                placeholder="e.g. John &amp; Jane Doe"
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
              disabled={loading || !guestName.trim() || !uploadedImage}
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
                <p className="inv-drag-hint">Drag QR, name, or code to fine-tune position</p>
              </div>
            )}
          </div>

          {/* ── Right: card preview ── */}
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

                {/*
                  wrapperRef — measures available width, holds explicit visual height.
                  scaleRef   — receives CSS transform: scale() (visual only).
                  cardRef    — 1080px unscaled canvas; html2canvas target.
                  Because cardRef has no transform, html2canvas always exports
                  at full 1080px resolution with no pre-capture hacks needed.
                */}
                <div className="card-canvas-wrapper" ref={wrapperRef}>
                  <div
                    className="card-scale-container"
                    ref={scaleRef}
                    style={{
                      transform:       `scale(${canvasScale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <div className="card-template" ref={cardRef}>
                      <img
                        src={uploadedImage}
                        className="template-bg"
                        alt="Invitation card"
                        crossOrigin="anonymous"
                        onLoad={handleBgLoad}
                      />

                      {/* scale prop corrects drag speed to match visual canvas size */}
                      <Draggable
                        nodeRef={nameNodeRef}
                        position={namePos}
                        scale={canvasScale}
                        onStop={(_, d) => setNamePos({ x: d.x, y: d.y })}
                      >
                        <div className="guest-name" ref={nameNodeRef}>
                          {invitation.guest_name}
                        </div>
                      </Draggable>

                      <Draggable
                        nodeRef={codeNodeRef}
                        position={codePos}
                        scale={canvasScale}
                        onStop={(_, d) => setCodePos({ x: d.x, y: d.y })}
                      >
                        <div className="invitation-code" ref={codeNodeRef}>
                          {invitation.invitation_code}
                        </div>
                      </Draggable>

                      <Draggable
                        nodeRef={qrNodeRef}
                        position={qrPos}
                        scale={canvasScale}
                        onStop={(_, d) => setQrPos({ x: d.x, y: d.y })}
                      >
                        <div className="qr-wrapper" ref={qrNodeRef}>
                          <img src={invitation.qr_data_url} alt="QR Code" />
                        </div>
                      </Draggable>

                    </div>
                  </div>
                </div>

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
