import { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { generateCard, updateEvent } from '../utils/api';
import {
  MdAutoAwesome, MdDownload, MdAddPhotoAlternate,
  MdExpandMore, MdExpandLess, MdDragIndicator,
  MdFormatAlignLeft, MdFormatAlignCenter, MdFormatAlignRight,
} from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

export default function CardGenerator({ event = null }) {
  const eventId = event?.id || null;

  // ── Upload ─────────────────────────────────────────────────────────
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imgSize,      setImgSize]      = useState(null);
  const [dragOver,     setDragOver]     = useState(false);

  // ── Form fields ──────────────────────────────────────────────────────
  const [guestName,   setGuestName]   = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // ── Text style ───────────────────────────────────────────────────────
  const [nameColor,      setNameColor]      = useState(event?.name_color || '#111111');
  const [cnColor,        setCnColor]        = useState(event?.cn_color   || '#222222');
  const [nameFontSize,   setNameFontSize]   = useState(120);
  const [nameFontWeight, setNameFontWeight] = useState('700');
  const [nameTextAlign,  setNameTextAlign]  = useState('center');
  const [showStyle,      setShowStyle]      = useState(false);

  // ── Result ──────────────────────────────────────────────────────────
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState('');

  // ── Drag-and-drop overlay ────────────────────────────────────────────
  const overlayRef = useRef(null);
  const [overlayW, setOverlayW] = useState(0);
  const [overlayH, setOverlayH] = useState(0);
  const [pos,      setPos]      = useState(null);

  const qrRef   = useRef(null);
  const nameRef = useRef(null);
  const codeRef = useRef(null);

  // ── Derived geometry ─────────────────────────────────────────────────
  const canvasH = imgSize ? Math.round((imgSize.h / imgSize.w) * 1080) : 1350;
  const scale   = overlayW > 0 ? overlayW / 1080 : 1;

  const getDefaults = useCallback(() => ({
    nameX:  540,
    nameY:  Math.round(canvasH * 0.78),
    codeX:  540,
    codeY:  Math.round(canvasH * 0.86),
    qrLeft: Math.round((1080 - 202) / 2),
    qrTop:  Math.round(canvasH * 0.54),
  }), [canvasH]);

  useEffect(() => {
    if (!imgSize) { setPos(null); return; }
    const lc       = event?.layout_config;
    const defaults = getDefaults();
    setPos(lc && typeof lc === 'object' && lc.nameY != null ? { ...defaults, ...lc } : defaults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSize]);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setOverlayW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePreview]);

  useEffect(() => {
    if (overlayW > 0 && imgSize) setOverlayH(Math.round(overlayW * (imgSize.h / imgSize.w)));
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
  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]); };
  const onImgLoad  = (e) => setImgSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });

  // ── Progress ─────────────────────────────────────────────────────────
  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  // ── Drag helpers ─────────────────────────────────────────────────────
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
    fd.append('image',            imageFile);
    fd.append('guest_name',       guestName.trim());
    fd.append('phone_number',     phoneNumber.trim() || '');
    fd.append('name_color',       nameColor);
    fd.append('cn_color',         cnColor);
    fd.append('name_font_size',   String(nameFontSize));
    fd.append('name_font_weight', nameFontWeight);
    fd.append('name_text_align',  nameTextAlign);
    if (eventId) fd.append('event_id', String(eventId));

    if (pos) {
      fd.append('pos_name_x',  String(Math.round(pos.nameX)));
      fd.append('pos_name_y',  String(Math.round(pos.nameY)));
      fd.append('pos_code_x',  String(Math.round(pos.codeX)));
      fd.append('pos_code_y',  String(Math.round(pos.codeY)));
      fd.append('pos_qr_left', String(Math.round(pos.qrLeft)));
      fd.append('pos_qr_top',  String(Math.round(pos.qrTop)));
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

  // Blob download — works cross-origin (Cloudinary URLs ignore the `download` attr)
  const handleDownload = async () => {
    if (!result?.image_url) return;
    try {
      const res  = await fetch(result.image_url);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${result.code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(result.image_url, '_blank');
    }
  };

  const handleReset = () => {
    setImageFile(null);
    setImagePreview(null);
    setImgSize(null);
    setGuestName('');
    setPhoneNumber('');
    setResult(null);
    setError('');
    setProgress(0);
    setPos(null);
  };

  // ── Canvas visibility ─────────────────────────────────────────────────
  const showDragCanvas = !!(imagePreview && !result && !loading);
  const dragReady      = showDragCanvas && pos && overlayW > 0 && overlayH > 0;

  // Scaled element sizes for overlay
  const qrBoxPx    = Math.max(24, Math.round(202 * scale));
  const nameFontPx = Math.max(8,  Math.round(nameFontSize * scale));
  const codeFontPx = Math.max(8,  Math.round(96 * scale));

  return (
    <>
      {progress > 0 && (
        <div className="top-loader" style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }} />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>Create Invitation Card</h1>
          <p>Upload your card design, drag to position, then generate.</p>
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
                onKeyDown={(e) => e.key === 'Enter' && !loading && guestName.trim() && handleGenerate()}
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

            {/* Text style — collapsible */}
            <div className="color-section">
              <button
                type="button"
                className="color-section-toggle"
                onClick={() => setShowStyle(v => !v)}
              >
                Text Style
                {showStyle ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
              </button>

              {showStyle && (
                <div className="color-pickers-grid">

                  {/* Name Color */}
                  <div className="color-picker-row">
                    <span className="color-picker-label">Name Color</span>
                    <input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} />
                    <span className="color-hex-sm">{nameColor}</span>
                  </div>

                  {/* CN Color */}
                  <div className="color-picker-row">
                    <span className="color-picker-label">Code (CN)</span>
                    <input type="color" value={cnColor} onChange={(e) => setCnColor(e.target.value)} />
                    <span className="color-hex-sm">{cnColor}</span>
                  </div>

                  {/* Font Size */}
                  <div className="color-picker-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
                    <span className="color-picker-label">Size</span>
                    <input
                      type="range"
                      min="60" max="200" step="10"
                      value={nameFontSize}
                      onChange={(e) => setNameFontSize(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span className="color-hex-sm" style={{ minWidth: '3ch', textAlign: 'right' }}>{nameFontSize}</span>
                  </div>

                  {/* Font Weight */}
                  <div className="color-picker-row" style={{ gap: '0.5rem' }}>
                    <span className="color-picker-label">Weight</span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {[['normal', 'Normal'], ['700', 'Bold']].map(([val, lbl]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setNameFontWeight(val)}
                          className={`style-chip${nameFontWeight === val ? ' active' : ''}`}
                          style={{ fontWeight: val === '700' ? 700 : 400 }}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Alignment */}
                  <div className="color-picker-row" style={{ gap: '0.5rem' }}>
                    <span className="color-picker-label">Align</span>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {[
                        ['left',   <MdFormatAlignLeft   key="l" size={16} />],
                        ['center', <MdFormatAlignCenter key="c" size={16} />],
                        ['right',  <MdFormatAlignRight  key="r" size={16} />],
                      ].map(([val, icon]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setNameTextAlign(val)}
                          className={`style-chip style-chip--icon${nameTextAlign === val ? ' active' : ''}`}
                          title={val}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              )}
            </div>

            {error && <p className="form-error">{error}</p>}

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

            {result && (
              <div className="inv-summary">
                <p className="inv-code">{result.code}</p>
                <p className="inv-name">{result.guest_name}</p>
              </div>
            )}
          </div>

          {/* ── Right: drag canvas / result / placeholder ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your card…</p>
              </div>

            ) : result ? (
              <div className="result-card fade">
                <img
                  src={result.image_url}
                  alt={result.guest_name}
                  style={{ width: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
                />
                <div className="result-actions">
                  <button className="btn-gold" onClick={handleDownload}>
                    <MdDownload size={17} /> Download PNG
                  </button>
                  <button className="btn-outline" onClick={handleReset}>
                    <FiRefreshCw size={15} /> New Card
                  </button>
                </div>
              </div>

            ) : showDragCanvas ? (
              <div className="drag-preview-wrap">
                <p className="drag-hint-label">
                  <MdDragIndicator size={14} />
                  Drag QR, Name &amp; Code freely — mouse or finger
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
                      {/* QR placeholder — free 2D drag */}
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
                          style={{ position: 'absolute', top: 0, left: 0, width: qrBoxPx, height: qrBoxPx }}
                        >
                          <span className="drag-el-qr-label">QR</span>
                        </div>
                      </Draggable>

                      {/* Guest Name — free X+Y drag */}
                      <Draggable
                        nodeRef={nameRef}
                        position={{ x: pos.nameX * scale, y: pos.nameY * scale }}
                        bounds={{ top: 0, left: 0, right: overlayW, bottom: overlayH - 24 }}
                        onStop={(_, d) => updatePos({
                          nameX: clamp(Math.round(d.x / scale), 0, 1080),
                          nameY: clamp(Math.round(d.y / scale), 0, canvasH),
                        })}
                      >
                        <div
                          ref={nameRef}
                          className="drag-el drag-el--text"
                          style={{ position: 'absolute', top: 0, left: 0 }}
                        >
                          <MdDragIndicator size={Math.max(10, Math.round(14 * scale))} className="drag-el-icon" />
                          <span className="drag-el-badge">Name</span>
                          <span
                            className="drag-el-text-preview"
                            style={{ fontSize: nameFontPx, fontWeight: nameFontWeight, color: nameColor }}
                          >
                            {guestName || 'Guest Name'}
                          </span>
                        </div>
                      </Draggable>

                      {/* Code (CN) — free X+Y drag */}
                      <Draggable
                        nodeRef={codeRef}
                        position={{ x: pos.codeX * scale, y: pos.codeY * scale }}
                        bounds={{ top: 0, left: 0, right: overlayW, bottom: overlayH - 24 }}
                        onStop={(_, d) => updatePos({
                          codeX: clamp(Math.round(d.x / scale), 0, 1080),
                          codeY: clamp(Math.round(d.y / scale), 0, canvasH),
                        })}
                      >
                        <div
                          ref={codeRef}
                          className="drag-el drag-el--text"
                          style={{ position: 'absolute', top: 0, left: 0 }}
                        >
                          <MdDragIndicator size={Math.max(10, Math.round(14 * scale))} className="drag-el-icon" />
                          <span className="drag-el-badge">CN</span>
                          <span className="drag-el-text-preview" style={{ fontSize: codeFontPx, letterSpacing: '0.2em', color: cnColor }}>
                            CN-###
                          </span>
                        </div>
                      </Draggable>
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
