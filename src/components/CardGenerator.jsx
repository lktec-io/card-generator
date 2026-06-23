import { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { generateCard, updateEvent, renderCard } from '../utils/api';
import {
  MdAutoAwesome, MdDownload, MdAddPhotoAlternate,
  MdExpandMore, MdExpandLess, MdDragIndicator,
} from 'react-icons/md';
import { FiRefreshCw } from 'react-icons/fi';
import '../styles/create.css';

// Preview font sizes mirror server defaults (150px name, 120px CN in 1080px canvas space)
const SERVER_NAME_FONT = 150;
const SERVER_CN_FONT   = 120;

export default function CardGenerator({ event = null }) {
  const eventId        = event?.id || null;
  const isContribution = event?.event_mode === 'contribution';

  // ── Upload ─────────────────────────────────────────────────────────
  const [imageFile,    setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imgSize,      setImgSize]     = useState(null);
  const [dragOver,     setDragOver]    = useState(false);

  // ── Form ────────────────────────────────────────────────────────────
  const [guestName,   setGuestName]  = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [amount,      setAmount]     = useState('');

  // ── Colors ──────────────────────────────────────────────────────────
  const [nameColor,   setNameColor]   = useState(event?.name_color   || '#111111');
  const [cnColor,     setCnColor]     = useState(event?.cn_color     || '#222222');
  const [amountColor, setAmountColor] = useState(event?.amount_color || '#222222');
  const [showColors,  setShowColors]  = useState(false);

  // ── Visibility toggles (BUG 7) ──────────────────────────────────────
  const [showQR, setShowQR] = useState(true);
  const [showCN, setShowCN] = useState(true);

  // ── Result / loading ─────────────────────────────────────────────────
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [error,       setError]       = useState('');

  // ── Drag overlay ─────────────────────────────────────────────────────
  const overlayRef = useRef(null);
  const [overlayW, setOverlayW] = useState(0);
  const [overlayH, setOverlayH] = useState(0);
  const [pos,      setPos]      = useState(null);

  const qrRef     = useRef(null);
  const nameRef   = useRef(null);
  const codeRef   = useRef(null);
  const amountRef = useRef(null);

  // ── Geometry ─────────────────────────────────────────────────────────
  const canvasH = imgSize ? Math.round((imgSize.h / imgSize.w) * 1080) : 1350;
  const scale   = overlayW > 0 ? overlayW / 1080 : 1;

  // Defaults: nameY/codeY/amountY are text TOP (dominant-baseline:hanging)
  // Visually equivalent to old baseline positions shifted up by ~font*0.72
  const getDefaults = useCallback(() => ({
    nameX:   540,
    nameY:   Math.round(canvasH * 0.70),
    codeX:   540,
    codeY:   Math.round(canvasH * 0.82),
    qrLeft:  Math.round((1080 - 202) / 2),
    qrTop:   Math.round(canvasH * 0.50),
    amountY: Math.round(canvasH * 0.90),
  }), [canvasH]);

  useEffect(() => {
    if (!imgSize) { setPos(null); return; }
    const lc = event?.layout_config;
    const defaults = getDefaults();
    setPos(lc && typeof lc === 'object' && lc.nameY != null ? { ...defaults, ...lc } : defaults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSize]);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setOverlayW(e.contentRect.width));
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

  const finishProgress = () => {
    setProgress(100);
    setTimeout(() => { setProgress(0); setLoading(false); }, 350);
  };

  const updatePos = (u) => setPos(p => ({ ...p, ...u }));
  const clamp     = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ── Generate ─────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!imageFile)        return setError('Please upload a card image first.');
    if (!guestName.trim()) return setError('Guest name is required.');
    setLoading(true); setError(''); setProgress(15);

    const fd = new FormData();
    fd.append('image',        imageFile);
    fd.append('guest_name',   guestName.trim());
    fd.append('phone_number', phoneNumber.trim() || '');
    fd.append('name_color',   nameColor);
    fd.append('cn_color',     cnColor);
    fd.append('amount_color', amountColor);
    fd.append('show_qr',      showQR ? '1' : '0');
    fd.append('show_cn',      showCN ? '1' : '0');
    if (eventId)                           fd.append('event_id',         String(eventId));
    if (isContribution && amount.trim())   fd.append('requested_amount', amount.trim());
    if (pos) {
      fd.append('pos_name_x', String(Math.round(pos.nameX ?? 540)));
      fd.append('pos_name_y', String(Math.round(pos.nameY)));
      if (!isContribution) {
        fd.append('pos_code_x',  String(Math.round(pos.codeX ?? 540)));
        fd.append('pos_code_y',  String(Math.round(pos.codeY)));
        fd.append('pos_qr_left', String(Math.round(pos.qrLeft)));
        fd.append('pos_qr_top',  String(Math.round(pos.qrTop)));
      }
    }

    try {
      setProgress(40);
      const { data } = await generateCard(fd);
      setProgress(90);
      if (!data.success) throw new Error(data.message || 'Generation failed.');
      setResult({ image_url: data.image_url, code: data.code, guest_name: data.guest_name });
      finishProgress();
      if (eventId && pos && event) updateEvent(eventId, { ...event, layout_config: pos }).catch(() => {});
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Generation failed. Please try again.');
      setProgress(0); setLoading(false);
    }
  };

  // ── Download via /render (WYSIWYG, no new tab) ────────────────────────
  const handleDownload = async () => {
    if (!result || !imageFile) return;
    setDownloading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('image',      imageFile);
      fd.append('code',       result.code);
      fd.append('guest_name', result.guest_name);
      fd.append('name_color', nameColor);
      fd.append('cn_color',   cnColor);
      fd.append('show_qr',    showQR ? '1' : '0');
      fd.append('show_cn',    showCN ? '1' : '0');
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
      a.href = url; a.download = `${result.code}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const handleReset = () => {
    setImageFile(null); setImagePreview(null); setImgSize(null);
    setGuestName(''); setPhoneNumber(''); setAmount('');
    setResult(null); setError(''); setProgress(0); setPos(null);
  };

  // ── Drag canvas always visible once image is loaded ───────────────────
  const showDragCanvas = !!(imagePreview && !loading);
  const dragReady      = showDragCanvas && pos && overlayW > 0 && overlayH > 0;

  // Scale proportional handle sizes to preview
  const qrBoxPx     = Math.max(24,  Math.round(202 * scale));
  const nameFontPx  = Math.max(10,  Math.round(SERVER_NAME_FONT * scale));
  const cnFontPx    = Math.max(8,   Math.round(SERVER_CN_FONT   * scale));
  const nameHandleW = Math.max(120, Math.round(560 * scale));
  const codeHandleW = Math.max(80,  Math.round(300 * scale));

  return (
    <>
      {progress > 0 && (
        <div className="top-loader" style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }} />
      )}

      <div className="create-page page-enter">
        <div className="create-header">
          <span className="create-ornament">— Card Generator —</span>
          <h1>{isContribution ? 'Create Contribution Card' : 'Create Invitation Card'}</h1>
          <p>Upload your design, generate, then drag elements to reposition before downloading.</p>
        </div>

        <div className="create-layout">

          {/* ── Left panel ── */}
          <div className="form-panel">

            <label
              className={`upload-box${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
              {imagePreview
                ? <img src={imagePreview} alt="Uploaded card" />
                : <>
                    <MdAddPhotoAlternate className="upload-icon" />
                    <span className="upload-title">Upload Card Design</span>
                    <span className="upload-sub">Click or drag &amp; drop — JPG, PNG, WebP</span>
                  </>
              }
            </label>

            <div className="form-group">
              <label htmlFor="cg-name">Guest Name</label>
              <input
                id="cg-name" type="text"
                placeholder="e.g. John &amp; Jane Doe"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && !result && guestName.trim() && handleGenerate()}
                maxLength={100}
              />
            </div>

            <div className="form-group">
              <label htmlFor="cg-phone">Phone Number <span style={{ fontWeight: 400, opacity: 0.6 }}>(optional)</span></label>
              <input
                id="cg-phone" type="tel"
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
                  id="cg-amount" type="text"
                  placeholder="e.g. TZS 50,000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  maxLength={50}
                />
              </div>
            )}

            {/* Element visibility toggles (BUG 7) */}
            {!isContribution && (
              <div className="color-section" style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox" checked={showQR}
                      onChange={(e) => setShowQR(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                    />
                    Show QR Code
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox" checked={showCN}
                      onChange={(e) => setShowCN(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: 'pointer' }}
                    />
                    Show Invitation Code
                  </label>
                </div>
              </div>
            )}

            {/* Colors — collapsible */}
            <div className="color-section">
              <button type="button" className="color-section-toggle" onClick={() => setShowColors(v => !v)}>
                Card Text Colors
                {showColors ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
              </button>
              {showColors && (
                <div className="color-pickers-grid">
                  <div className="color-picker-row">
                    <span className="color-picker-label">Name</span>
                    <input type="color" value={nameColor} onChange={(e) => setNameColor(e.target.value)} />
                    <span className="color-hex-sm">{nameColor}</span>
                  </div>
                  {!isContribution && (
                    <div className="color-picker-row">
                      <span className="color-picker-label">Code (CN)</span>
                      <input type="color" value={cnColor} onChange={(e) => setCnColor(e.target.value)} />
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
              <div className="inv-summary">
                <p className="inv-code">{result.code}</p>
                <p className="inv-name">{result.guest_name}</p>
                <p style={{ marginTop: '0.4rem', fontSize: '0.78rem', opacity: 0.7 }}>
                  Drag elements on the right to adjust position, then download.
                </p>
              </div>
            )}
          </div>

          {/* ── Right panel: drag canvas + download ── */}
          <div className="result-panel">
            {loading ? (
              <div className="generate-loading">
                <div className="generate-spinner" />
                <p>Creating your card…</p>
              </div>

            ) : showDragCanvas ? (
              <div className="drag-preview-wrap">
                <p className="drag-hint-label">
                  <MdDragIndicator size={14} />
                  {result
                    ? 'Reposition elements below, then download'
                    : isContribution
                      ? 'Drag Name to reposition · generates with these positions'
                      : 'Drag QR · Name · CN to reposition · generates with these positions'
                  }
                </p>

                {/* Drag canvas */}
                <div
                  ref={overlayRef}
                  className="drag-canvas-overlay"
                  style={{ position: 'relative', overflow: 'hidden', userSelect: 'none', touchAction: 'none' }}
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
                      {/* QR — free 2D drag */}
                      {!isContribution && showQR && (
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
                            style={{ position: 'absolute', top: 0, left: 0, width: qrBoxPx, height: qrBoxPx, touchAction: 'none', cursor: 'grab' }}
                          >
                            <span className="drag-el-qr-label">QR</span>
                          </div>
                        </Draggable>
                      )}

                      {/* Guest Name — free 2D drag, compact centered handle */}
                      <Draggable
                        nodeRef={nameRef}
                        position={{
                          x: clamp((pos.nameX ?? 540) * scale - nameHandleW / 2, 0, overlayW - nameHandleW),
                          y: clamp(pos.nameY * scale, 0, overlayH),
                        }}
                        bounds={{ top: 0, left: 0, right: overlayW - nameHandleW, bottom: overlayH }}
                        onStop={(_, d) => updatePos({
                          nameX: clamp(Math.round((d.x + nameHandleW / 2) / scale), 0, 1080),
                          nameY: clamp(Math.round(d.y / scale), 0, canvasH),
                        })}
                      >
                        <div
                          ref={nameRef}
                          style={{
                            position: 'absolute', top: 0, left: 0,
                            width: nameHandleW, touchAction: 'none', cursor: 'grab',
                          }}
                        >
                          <div style={{
                            background: 'rgba(0,0,0,0.45)',
                            border: '1px dashed rgba(255,255,255,0.7)',
                            borderRadius: 3,
                            padding: '1px 5px',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            maxWidth: '100%',
                          }}>
                            <MdDragIndicator size={Math.max(10, Math.round(14 * scale))} color="rgba(255,255,255,0.8)" />
                            <span style={{
                              fontFamily: 'Georgia, serif',
                              fontSize: nameFontPx,
                              color: nameColor,
                              lineHeight: 1.1,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}>
                              {guestName || 'Guest Name'}
                            </span>
                          </div>
                          <span style={{
                            display: 'block', fontSize: 8, color: 'rgba(255,255,255,0.7)',
                            marginTop: 1, paddingLeft: 2,
                          }}>NAME</span>
                        </div>
                      </Draggable>

                      {/* CN — free 2D drag (invitation only, when visible) */}
                      {!isContribution && showCN && (
                        <Draggable
                          nodeRef={codeRef}
                          position={{
                            x: clamp((pos.codeX ?? 540) * scale - codeHandleW / 2, 0, overlayW - codeHandleW),
                            y: clamp(pos.codeY * scale, 0, overlayH),
                          }}
                          bounds={{ top: 0, left: 0, right: overlayW - codeHandleW, bottom: overlayH }}
                          onStop={(_, d) => updatePos({
                            codeX: clamp(Math.round((d.x + codeHandleW / 2) / scale), 0, 1080),
                            codeY: clamp(Math.round(d.y / scale), 0, canvasH),
                          })}
                        >
                          <div
                            ref={codeRef}
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: codeHandleW, touchAction: 'none', cursor: 'grab',
                            }}
                          >
                            <div style={{
                              background: 'rgba(0,0,0,0.45)',
                              border: '1px dashed rgba(255,255,255,0.7)',
                              borderRadius: 3,
                              padding: '1px 5px',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              maxWidth: '100%',
                            }}>
                              <MdDragIndicator size={Math.max(10, Math.round(14 * scale))} color="rgba(255,255,255,0.8)" />
                              <span style={{
                                fontFamily: 'Georgia, serif',
                                fontSize: cnFontPx,
                                letterSpacing: '0.2em',
                                color: cnColor,
                                lineHeight: 1.1,
                                whiteSpace: 'nowrap',
                              }}>
                                CN-###
                              </span>
                            </div>
                            <span style={{
                              display: 'block', fontSize: 8, color: 'rgba(255,255,255,0.7)',
                              marginTop: 1, paddingLeft: 2,
                            }}>CODE</span>
                          </div>
                        </Draggable>
                      )}

                      {/* Amount — contribution only */}
                      {isContribution && (
                        <Draggable
                          nodeRef={amountRef}
                          position={{
                            x: clamp(540 * scale - nameHandleW / 2, 0, overlayW - nameHandleW),
                            y: clamp((pos.amountY ?? Math.round(canvasH * 0.90)) * scale, 0, overlayH),
                          }}
                          bounds={{ top: 0, left: 0, right: overlayW - nameHandleW, bottom: overlayH }}
                          onStop={(_, d) => updatePos({
                            amountY: clamp(Math.round(d.y / scale), 0, canvasH),
                          })}
                        >
                          <div
                            ref={amountRef}
                            style={{
                              position: 'absolute', top: 0, left: 0,
                              width: nameHandleW, touchAction: 'none', cursor: 'grab',
                            }}
                          >
                            <div style={{
                              background: 'rgba(0,0,0,0.45)',
                              border: '1px dashed rgba(255,255,255,0.7)',
                              borderRadius: 3, padding: '1px 5px',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                              <MdDragIndicator size={Math.max(10, Math.round(14 * scale))} color="rgba(255,255,255,0.8)" />
                              <span style={{ fontSize: cnFontPx, color: amountColor, lineHeight: 1.1 }}>
                                {amount || 'TZS 0'}
                              </span>
                            </div>
                            <span style={{ display: 'block', fontSize: 8, color: 'rgba(255,255,255,0.7)', marginTop: 1, paddingLeft: 2 }}>AMOUNT</span>
                          </div>
                        </Draggable>
                      )}
                    </>
                  )}
                </div>

                {/* Download below canvas (BUG 6) */}
                {result && (
                  <div className="result-actions" style={{ marginTop: '0.75rem' }}>
                    <button className="btn-gold" onClick={handleDownload} disabled={downloading}>
                      {downloading
                        ? <><div className="btn-spinner" /> Downloading…</>
                        : <><MdDownload size={17} /> Download PNG</>
                      }
                    </button>
                    <button className="btn-outline" onClick={handleReset}>
                      <FiRefreshCw size={15} /> New Card
                    </button>
                  </div>
                )}
              </div>

            ) : (
              <div className="result-placeholder">
                <div className="result-placeholder-icon">🎴</div>
                <p>Upload a card image to start</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
