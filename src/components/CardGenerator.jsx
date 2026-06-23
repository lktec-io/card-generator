import { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { generateCard, updateEvent, renderCard } from '../utils/api';
import {
  MdAutoAwesome, MdDownload, MdAddPhotoAlternate,
  MdExpandMore, MdExpandLess, MdDragIndicator,
} from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

export default function CardGenerator({ event = null }) {
  const eventId        = event?.id || null;
  const isContribution = event?.event_mode === 'contribution';

  // ── Upload ─────────────────────────────────────────────────────────
  const [imageFile,    setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imgSize,      setImgSize]     = useState(null); // { w, h } natural px
  const [dragOver,     setDragOver]    = useState(false);

  // ── Form ────────────────────────────────────────────────────────────
  const [guestName,    setGuestName]   = useState('');
  const [phoneNumber,  setPhoneNumber] = useState('');
  const [amount,       setAmount]      = useState('');

  // ── Colors ──────────────────────────────────────────────────────────
  const [nameColor,    setNameColor]   = useState(event?.name_color   || '#111111');
  const [cnColor,      setCnColor]     = useState(event?.cn_color     || '#222222');
  const [amountColor,  setAmountColor] = useState(event?.amount_color || '#222222');
  const [showColors,   setShowColors]  = useState(false);

  // ── Result / loading ─────────────────────────────────────────────────
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [error,       setError]       = useState('');

  // ── Drag-and-drop overlay ────────────────────────────────────────────
  const overlayRef = useRef(null);
  const [overlayW, setOverlayW] = useState(0);
  const [overlayH, setOverlayH] = useState(0);
  const [pos,      setPos]      = useState(null); // coords in 1080px canvas space

  // nodeRefs for react-draggable (React 18 StrictMode)
  const qrRef     = useRef(null);
  const nameRef   = useRef(null);
  const codeRef   = useRef(null);
  const amountRef = useRef(null);

  // ── Derived geometry ─────────────────────────────────────────────────
  const canvasH = imgSize ? Math.round((imgSize.h / imgSize.w) * 1080) : 1350;
  const scale   = overlayW > 0 ? overlayW / 1080 : 1;

  const getDefaults = useCallback(() => ({
    nameX:   540,
    nameY:   Math.round(canvasH * 0.80),
    codeX:   540,
    codeY:   Math.round(canvasH * 0.88),
    qrLeft:  Math.round((1080 - 202) / 2),
    qrTop:   Math.round(canvasH * 0.56),
    amountY: Math.round(canvasH * 0.94),
  }), [canvasH]);

  // Initialise positions when image natural size is known
  useEffect(() => {
    if (!imgSize) { setPos(null); return; }
    const lc = event?.layout_config;
    const defaults = getDefaults();
    if (lc && typeof lc === 'object' && lc.nameY != null) {
      setPos({ ...defaults, ...lc });
    } else {
      setPos(defaults);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSize]);

  // Track overlay container width
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setOverlayW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePreview]);

  useEffect(() => {
    if (overlayW > 0 && imgSize) {
      setOverlayH(Math.round(overlayW * (imgSize.h / imgSize.w)));
    }
  }, [overlayW, imgSize]);

  // ── File loading ─────────────────────────────────────────────────────
  const loadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setImgSize(null);
    setPos(null);
    setResult(null);
    setError('');
  };

  const handleFileChange = (e) => loadFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    loadFile(e.dataTransfer.files[0]);
  };

  const onImgLoad = (e) =>
    setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });

  // ── Progress helpers ─────────────────────────────────────────────────
  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  // ── Drag position helper ─────────────────────────────────────────────
  const updatePos = (updates) => setPos(p => ({ ...p, ...updates }));
  const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── Generate ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!imageFile)        return setError('Please upload a card image first.');
    if (!guestName.trim()) return setError('Guest name is required.');

    setLoading(true);
    setError('');
    setProgress(15);

    const fd = new FormData();
    fd.append('image',        imageFile);
    fd.append('guest_name',   guestName.trim());
    fd.append('phone_number', phoneNumber.trim() || '');
    fd.append('name_color',   nameColor);
    fd.append('cn_color',     cnColor);
    fd.append('amount_color', amountColor);
    if (eventId) fd.append('event_id', String(eventId));
    if (isContribution && amount.trim()) fd.append('requested_amount', amount.trim());

    // Positions from drag overlay (1080px canvas space)
    if (pos) {
      fd.append('pos_name_y', String(Math.round(pos.nameY)));
      if (!isContribution) {
        fd.append('pos_code_y',  String(Math.round(pos.codeY)));
        fd.append('pos_qr_left', String(Math.round(pos.qrLeft)));
        fd.append('pos_qr_top',  String(Math.round(pos.qrTop)));
      }
      if (pos.amountY != null) fd.append('pos_amount_y', String(Math.round(pos.amountY)));
    }

    try {
      setProgress(40);
      const { data } = await generateCard(fd);
      setProgress(90);
      if (!data.success) throw new Error(data.message || 'Generation failed.');
      setResult({ image_url: data.image_url, code: data.code, guest_name: data.guest_name });
      finishProgress();
      if (eventId && pos && event) {
        updateEvent(eventId, { ...event, layout_config: pos }).catch(() => {});
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Generation failed. Please try again.');
      setProgress(0);
      setLoading(false);
    }
  };

  // ── Download (re-render at current positions) ─────────────────────────
  const handleDownload = async () => {
    if (!result || !imageFile) return;
    setDownloading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image',      imageFile);
      fd.append('code',       result.code);
      fd.append('guest_name', result.guest_name);
      fd.append('name_color', nameColor);
      fd.append('cn_color',   cnColor);
      if (pos) {
        fd.append('pos_name_x',  String(Math.round(pos.nameX ?? 540)));
        fd.append('pos_name_y',  String(Math.round(pos.nameY)));
        fd.append('pos_code_x',  String(Math.round(pos.codeX ?? 540)));
        fd.append('pos_code_y',  String(Math.round(pos.codeY)));
        fd.append('pos_qr_left', String(Math.round(pos.qrLeft)));
        fd.append('pos_qr_top',  String(Math.round(pos.qrTop)));
      }
      const { data: blob } = await renderCard(fd);
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${result.code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setImgSize(null);
    setGuestName('');
    setPhoneNumber('');
    setAmount('');
    setResult(null);
    setError('');
    setProgress(0);
    setPos(null);
  };

  // ── Drag canvas: show whenever image is loaded and not generating ─────
  const showDragCanvas = !!(imagePreview && !loading);
  const dragReady      = showDragCanvas && pos && overlayW > 0 && overlayH > 0;

  // Scale proportional element sizes
  const qrBoxPx      = Math.max(24, Math.round(202 * scale));
  const nameHandleW  = Math.max(80, Math.round(300 * scale));
  const codeHandleW  = Math.max(60, Math.round(200 * scale));
  const nameFontPx   = Math.max(10, Math.round(50  * scale));
  const codeFontPx   = Math.max(8,  Math.round(40  * scale));
  const amtFontPx    = Math.max(8,  Math.round(40  * scale));

  return (
    <>
      {progress > 0 && (
        <div className="top-loader" style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }} />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>{isContribution ? 'Create Contribution Card' : 'Create Invitation Card'}</h1>
          <p>Upload your card design, generate, then drag elements to position them.</p>
        </div>

        <div className="create-layout">

          {/* ── Left: form panel ── */}
          <div className="form-panel">

            <label
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              {imagePreview ? (
                <img src={imagePreview} alt="Uploaded card" />
              ) : (
                <>
                  <MdAddPhotoAlternate className="upload-icon" />
                  <span className="upload-title">Upload Card Design</span>
                  <span className="upload-sub">Click or drag &amp; drop — JPG, PNG, WebP</span>
                </>
              )}
            </label>

            <div className="form-group">
              <label htmlFor="cg-name">Guest Name</label>
              <input
                id="cg-name"
                type="text"
                placeholder="e.g. John &amp; Jane Doe"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && !result && guestName.trim() && handleGenerate()}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label htmlFor="cg-phone">Phone Number</label>
              <input
                id="cg-phone"
                type="tel"
                placeholder="e.g. +255712345678"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                maxLength={30}
              />
            </div>

            {isContribution && (
              <div className="form-group">
                <label htmlFor="cg-amount">Contribution Amount</label>
                <input
                  id="cg-amount"
                  type="text"
                  placeholder="e.g. TZS 50,000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  maxLength={50}
                />
              </div>
            )}

            {/* Card text colors — collapsible */}
            <div className="color-section">
              <button
                type="button"
                className="color-section-toggle"
                onClick={() => setShowColors(v => !v)}
              >
                Card Text Colors
                {showColors ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
              </button>
              {showColors && (
                <div className="color-pickers-grid">
                  <div className="color-picker-row">
                    <span className="color-picker-label">Name</span>
                    <input type="color" value={nameColor}   onChange={(e) => setNameColor(e.target.value)}   />
                    <span className="color-hex-sm">{nameColor}</span>
                  </div>
                  {!isContribution && (
                    <div className="color-picker-row">
                      <span className="color-picker-label">Code (CN)</span>
                      <input type="color" value={cnColor}     onChange={(e) => setCnColor(e.target.value)}     />
                      <span className="color-hex-sm">{cnColor}</span>
                    </div>
                  )}
                  {isContribution && (
                    <div className="color-picker-row">
                      <span className="color-picker-label">Amount</span>
                      <input type="color" value={amountColor} onChange={(e) => setAmountColor(e.target.value)} />
                      <span className="color-hex-sm">{amountColor}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}

            {!result ? (
              <button
                className="btn-gold"
                onClick={handleGenerate}
                disabled={loading || !guestName.trim() || !imageFile}
              >
                {loading
                  ? <><div className="btn-spinner" /> Generating…</>
                  : <><MdAutoAwesome size={17} /> Generate Card</>
                }
              </button>
            ) : (
              <>
                <div className="inv-summary">
                  <p className="inv-code">{result.code}</p>
                  <p className="inv-name">{result.guest_name}</p>
                  <p className="drag-hint-label" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <MdDragIndicator size={13} /> Drag elements on the right to reposition, then download.
                  </p>
                </div>

                <button
                  className="btn-gold"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading
                    ? <><div className="btn-spinner" /> Downloading…</>
                    : <><MdDownload size={17} /> Download PNG</>
                  }
                </button>

                <button className="btn-outline" onClick={handleReset} style={{ marginTop: '0.5rem' }}>
                  <FiRefreshCw size={15} /> New Card
                </button>
              </>
            )}
          </div>

          {/* ── Right: drag canvas / placeholder ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your card…</p>
              </div>

            ) : showDragCanvas ? (
              /* ── Drag-and-drop positioning canvas ── */
              <div className="drag-preview-wrap">
                <p className="drag-hint-label">
                  <MdDragIndicator size={14} />
                  {isContribution
                    ? 'Drag Name anywhere to reposition'
                    : 'Drag QR · Name · CN anywhere to reposition'}
                </p>

                <div
                  ref={overlayRef}
                  className="drag-canvas-overlay"
                  style={{ position: 'relative', overflow: 'hidden', userSelect: 'none' }}
                >
                  <img
                    src={imagePreview}
                    alt="Card preview"
                    onLoad={onImgLoad}
                    style={{ width: '100%', display: 'block', borderRadius: 'var(--radius-md)' }}
                    draggable={false}
                  />

                  {dragReady && (
                    <>
                      {/* QR placeholder — free 2D drag (invitation only) */}
                      {!isContribution && (
                        <Draggable
                          nodeRef={qrRef}
                          position={{ x: pos.qrLeft * scale, y: pos.qrTop * scale }}
                          bounds={{ top: 0, left: 0, right: overlayW - qrBoxPx, bottom: overlayH - qrBoxPx }}
                          onStop={(_, d) => updatePos({
                            qrLeft: clamp(Math.round(d.x / scale), 0, 1080 - 202),
                            qrTop:  clamp(Math.round(d.y / scale), 0, canvasH - 202),
                          })}
                        >
                          <div
                            ref={qrRef}
                            className="drag-el drag-el--qr"
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: qrBoxPx, height: qrBoxPx,
                              touchAction: 'none',
                            }}
                          >
                            <span className="drag-el-qr-label">QR</span>
                          </div>
                        </Draggable>
                      )}

                      {/* Guest Name — compact handle, free 2D drag */}
                      <Draggable
                        nodeRef={nameRef}
                        position={{
                          x: (pos.nameX ?? 540) * scale - nameHandleW / 2,
                          y: pos.nameY * scale,
                        }}
                        bounds={{ top: 0, left: 0, right: overlayW - nameHandleW, bottom: overlayH }}
                        onStop={(_, d) => updatePos({
                          nameX: clamp(Math.round((d.x + nameHandleW / 2) / scale), 0, 1080),
                          nameY: clamp(Math.round(d.y / scale), 0, canvasH),
                        })}
                      >
                        <div
                          ref={nameRef}
                          className="drag-el drag-el--text drag-el--compact"
                          style={{
                            position: 'absolute', top: 0, left: 0,
                            width: nameHandleW,
                            touchAction: 'none',
                          }}
                        >
                          <span className="drag-el-badge">Name</span>
                          <span className="drag-el-text-preview" style={{ fontSize: nameFontPx, color: nameColor }}>
                            {guestName || 'Guest Name'}
                          </span>
                          <MdDragIndicator className="drag-el-arrow" size={Math.max(12, Math.round(18 * scale))} />
                        </div>
                      </Draggable>

                      {/* Code (CN) — compact handle, free 2D drag (invitation only) */}
                      {!isContribution && (
                        <Draggable
                          nodeRef={codeRef}
                          position={{
                            x: (pos.codeX ?? 540) * scale - codeHandleW / 2,
                            y: pos.codeY * scale,
                          }}
                          bounds={{ top: 0, left: 0, right: overlayW - codeHandleW, bottom: overlayH }}
                          onStop={(_, d) => updatePos({
                            codeX: clamp(Math.round((d.x + codeHandleW / 2) / scale), 0, 1080),
                            codeY: clamp(Math.round(d.y / scale), 0, canvasH),
                          })}
                        >
                          <div
                            ref={codeRef}
                            className="drag-el drag-el--text drag-el--compact"
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: codeHandleW,
                              touchAction: 'none',
                            }}
                          >
                            <span className="drag-el-badge">CN</span>
                            <span className="drag-el-text-preview" style={{ fontSize: codeFontPx, letterSpacing: '0.2em', color: cnColor }}>
                              CN-###
                            </span>
                            <MdDragIndicator className="drag-el-arrow" size={Math.max(12, Math.round(18 * scale))} />
                          </div>
                        </Draggable>
                      )}

                      {/* Amount — contribution only, free 2D drag */}
                      {isContribution && (
                        <Draggable
                          nodeRef={amountRef}
                          position={{
                            x: 540 * scale - nameHandleW / 2,
                            y: (pos.amountY ?? Math.round(canvasH * 0.94)) * scale,
                          }}
                          bounds={{ top: 0, left: 0, right: overlayW - nameHandleW, bottom: overlayH }}
                          onStop={(_, d) => updatePos({
                            amountY: clamp(Math.round(d.y / scale), 0, canvasH),
                          })}
                        >
                          <div
                            ref={amountRef}
                            className="drag-el drag-el--text drag-el--compact"
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: nameHandleW,
                              touchAction: 'none',
                            }}
                          >
                            <span className="drag-el-badge">Amt</span>
                            <span className="drag-el-text-preview" style={{ fontSize: amtFontPx, letterSpacing: '0.1em', color: amountColor }}>
                              {amount || 'TZS 0'}
                            </span>
                            <MdDragIndicator className="drag-el-arrow" size={Math.max(12, Math.round(18 * scale))} />
                          </div>
                        </Draggable>
                      )}
                    </>
                  )}
                </div>
              </div>

            ) : (
              <div className="result-placeholder">
                <div className="result-placeholder-icon">🎴</div>
                <p>Upload a card image to start positioning elements</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
