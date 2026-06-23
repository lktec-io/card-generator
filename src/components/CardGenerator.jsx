import { useState, useEffect, useRef, useCallback } from 'react';
import Draggable from 'react-draggable';
import { generateCard, renderCard } from '../utils/api';
import '../styles/create.css';

// QR block: 170px core + 16px padding each side = 202 canvas units (positions only)
const QR_BLOCK  = 202;
const ANCHOR_R  = 7;   // half of 14px anchor dot


export default function CardGenerator({ event }) {
  const isContribution = event?.event_mode === 'contribution';

  // ── Upload ─────────────────────────────────────────────────────────────────
  const [imageFile,    setImageFile]    = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [dragOver,     setDragOver]     = useState(false);
  const fileInputRef = useRef(null);

  // ── Form ───────────────────────────────────────────────────────────────────
  const [guestName,    setGuestName]    = useState('');
  const [phone,        setPhone]        = useState('');
  const [nameColor,    setNameColor]    = useState('#111111');
  const [cnColor,      setCnColor]      = useState('#222222');
  // Font sizes are ABSOLUTE OUTPUT PIXELS — same value used in downloaded PNG
  const [nameFontSize, setNameFontSize] = useState(150);
  const [cnFontSize,   setCnFontSize]   = useState(100);
  const [showQR,       setShowQR]       = useState(true);
  const [showCN,       setShowCN]       = useState(true);

  // ── Status ─────────────────────────────────────────────────────────────────
  const [loading,     setLoading]     = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result,      setResult]      = useState(null);
  const [error,       setError]       = useState(null);

  // ── Canvas geometry ────────────────────────────────────────────────────────
  // canvasH: image height in 1080-canvas space (1080 × naturalH/naturalW)
  // Used ONLY for position proportions — not for font sizing.
  const [canvasH,      setCanvasH]      = useState(1350);
  // outputCardW: the actual pixel width the server will produce (max(naturalW, 1200))
  // This drives preview font scaling to be pixel-accurate.
  const [outputCardW,  setOutputCardW]  = useState(1200);
  // overlayW: screen-pixel width of the drag container
  const [overlayW,     setOverlayW]     = useState(400);
  // pos: all coordinates in 1080-canvas space (proportional); Y = text baseline
  const [pos, setPos] = useState(null);

  const overlayRef    = useRef(null);
  const nameAnchorRef = useRef(null);
  const cnAnchorRef   = useRef(null);
  const qrBoxRef      = useRef(null);

  // posScale: converts 1080-canvas coords → screen pixels (for drag positions)
  const posScale   = overlayW / 1080;
  // fontScale: converts absolute output px → screen pixels (for preview text)
  // outputCardW is the real card width the server will produce → honest preview
  const fontScale  = overlayW / outputCardW;
  const overlayH   = Math.round(canvasH * posScale);
  const qrBoxPx    = Math.round(QR_BLOCK * posScale);

  // ── Track overlay width ────────────────────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setOverlayW(entry.contentRect.width));
    ro.observe(el);
    setOverlayW(el.offsetWidth || 400);
    return () => ro.disconnect();
  }, [imagePreview]);

  // ── Image file handler ─────────────────────────────────────────────────────
  const handleImageFile = useCallback((file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreview(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    setResult(null);
    setError(null);
    setPos(null);
  }, []);

  const onFileChange = (e) => { if (e.target.files?.[0]) handleImageFile(e.target.files[0]); };

  // ── Image natural dimensions → geometry ───────────────────────────────────
  const onImgLoad = (e) => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget;
    const ch  = Math.round(1080 * nh / nw);
    const ocw = Math.max(nw, 1200); // matches server min-1200 logic
    setCanvasH(ch);
    setOutputCardW(ocw);
    const ow = overlayRef.current?.offsetWidth || 400;
    setOverlayW(ow);
    // Default positions in 1080-canvas space (independent of font sizes)
    setPos(prev => {
      if (prev) return prev; // keep existing positions on re-render
      const qrTop  = Math.round(ch * 0.52);
      const qrLeft = Math.round((1080 - QR_BLOCK) / 2);
      const nameY  = Math.round(qrTop + QR_BLOCK + ch * 0.06);
      const codeY  = Math.round(nameY + ch * 0.07);
      return { nameX: 540, nameY, codeX: 540, codeY, qrLeft, qrTop };
    });
  };

  const updatePos = (patch) => setPos(p => ({ ...p, ...patch }));

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!imageFile)        { setError('Please upload an invitation image.'); return; }
    if (!guestName.trim()) { setError('Please enter the guest name.');       return; }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image',          imageFile);
      fd.append('guest_name',     guestName.trim());
      if (phone.trim())           fd.append('phone_number',   phone.trim());
      if (event?.id)              fd.append('event_id',       event.id);
      fd.append('name_color',     nameColor);
      fd.append('cn_color',       cnColor);
      fd.append('name_font_size', nameFontSize);  // absolute px
      fd.append('cn_font_size',   cnFontSize);    // absolute px
      fd.append('show_qr',        showQR ? '1' : '0');
      fd.append('show_cn',        showCN ? '1' : '0');
      if (pos) {
        fd.append('pos_name_x',  pos.nameX);
        fd.append('pos_name_y',  pos.nameY);
        fd.append('pos_code_x',  pos.codeX);
        fd.append('pos_code_y',  pos.codeY);
        fd.append('pos_qr_left', pos.qrLeft);
        fd.append('pos_qr_top',  pos.qrTop);
      }
      const { data } = await generateCard(fd);
      if (!data.success) throw new Error(data.message || 'Generation failed');
      setResult(data);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Generation failed. Please try again.';
      setError(msg);
      console.error('[CardGenerator] generate failed:', msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Download — re-render at adjusted positions ─────────────────────────────
  const handleDownload = async () => {
    if (!imageFile || !result) return;
    setDownloading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image',          imageFile);
      fd.append('code',           result.code);
      fd.append('guest_name',     guestName.trim());
      fd.append('name_color',     nameColor);
      fd.append('cn_color',       cnColor);
      fd.append('name_font_size', nameFontSize);  // absolute px
      fd.append('cn_font_size',   cnFontSize);    // absolute px
      fd.append('show_qr',        showQR ? '1' : '0');
      fd.append('show_cn',        showCN ? '1' : '0');
      if (pos) {
        fd.append('pos_name_x',  pos.nameX);
        fd.append('pos_name_y',  pos.nameY);
        fd.append('pos_code_x',  pos.codeX);
        fd.append('pos_code_y',  pos.codeY);
        fd.append('pos_qr_left', pos.qrLeft);
        fd.append('pos_qr_top',  pos.qrTop);
      }
      const resp = await renderCard(fd);
      const blob = resp.data instanceof Blob ? resp.data : new Blob([resp.data], { type: 'image/png' });
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement('a'), { href: url, download: `${result.code}.png` });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Download failed. Please try again.';
      setError(msg);
    } finally {
      setDownloading(false);
    }
  };

  // ── Drag stop handlers ─────────────────────────────────────────────────────
  // Anchor top-left at (d.x, d.y); center at (d.x + ANCHOR_R, d.y + ANCHOR_R)
  const onNameStop = (_, d) => updatePos({
    nameX: Math.round((d.x + ANCHOR_R) / posScale),
    nameY: Math.round((d.y + ANCHOR_R) / posScale),
  });
  const onCnStop = (_, d) => updatePos({
    codeX: Math.round((d.x + ANCHOR_R) / posScale),
    codeY: Math.round((d.y + ANCHOR_R) / posScale),
  });
  const onQrStop = (_, d) => updatePos({
    qrLeft: Math.max(0, Math.round(d.x / posScale)),
    qrTop:  Math.max(0, Math.round(d.y / posScale)),
  });

  const dragReady = !!(imagePreview && pos && overlayW > 50);

  // Preview font size in screen pixels (honest: same ratio as in output PNG)
  const previewNamePx = Math.max(4, Math.round(nameFontSize * fontScale));
  const previewCnPx   = Math.max(3, Math.round(cnFontSize   * fontScale));

  return (
    <div className="create-page">

      {/* Header */}
      <div className="create-header">
        <div className="create-ornament">✦ Invitation Studio ✦</div>
        <h1>Create Invitation Card</h1>
        {event && (
          <p style={{ color: 'var(--gold)', fontSize: '0.88rem', marginTop: '0.25rem' }}>
            {event.event_name}
            {event.event_date && ` — ${new Date(event.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
          </p>
        )}
      </div>

      <div className="create-layout">

        {/* ══ LEFT: Form ═══════════════════════════════════════════════════ */}
        <div className="form-panel">

          {/* Upload */}
          <div
            className={`upload-box${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleImageFile(e.dataTransfer.files[0]); }}
          >
            {imagePreview
              ? <img src={imagePreview} alt="Card preview" />
              : (
                <>
                  <div className="upload-icon">🖼</div>
                  <div className="upload-title">Upload Card Image</div>
                  <div className="upload-sub">PNG / JPG · Click or drag &amp; drop</div>
                </>
              )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileChange} />

          {/* Guest name */}
          <div className="form-group">
            <label>Guest Name</label>
            <input
              type="text"
              placeholder="e.g. John &amp; Jane Smith"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Phone */}
          <div className="form-group">
            <label>Phone <span className="form-optional">(optional)</span></label>
            <input
              type="tel"
              placeholder="+255 7XX XXX XXX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>

          {/* Font sizes — absolute output pixels, free input (only > 0 enforced) */}
          <div className="font-size-row">
            <div className="font-size-field">
              <label>Name Size (px)</label>
              <input
                type="number"
                value={nameFontSize}
                onChange={e => { const v = parseInt(e.target.value, 10); if (v > 0) setNameFontSize(v); }}
              />
            </div>
            {!isContribution && (
              <div className="font-size-field">
                <label>CN Size (px)</label>
                <input
                  type="number"
                  value={cnFontSize}
                  onChange={e => { const v = parseInt(e.target.value, 10); if (v > 0) setCnFontSize(v); }}
                />
              </div>
            )}
          </div>

          {/* Colors */}
          <div className="color-pickers-grid">
            <div className="color-picker-row">
              <span className="color-picker-label">Name color</span>
              <input
                type="color" value={nameColor}
                onChange={e => setNameColor(e.target.value)}
                style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', background: 'none', padding: 0 }}
              />
              <span className="color-hex-sm">{nameColor}</span>
            </div>
            {!isContribution && (
              <div className="color-picker-row">
                <span className="color-picker-label">CN color</span>
                <input
                  type="color" value={cnColor}
                  onChange={e => setCnColor(e.target.value)}
                  style={{ width: 36, height: 28, border: 'none', cursor: 'pointer', background: 'none', padding: 0 }}
                />
                <span className="color-hex-sm">{cnColor}</span>
              </div>
            )}
          </div>

          {/* Show/hide toggles */}
          {!isContribution && (
            <div className="toggle-row">
              <label className="toggle-label">
                <input type="checkbox" checked={showQR} onChange={e => setShowQR(e.target.checked)} />
                Show QR
              </label>
              <label className="toggle-label">
                <input type="checkbox" checked={showCN} onChange={e => setShowCN(e.target.checked)} />
                Show CN
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.30)',
              borderRadius: 8, padding: '0.65rem 1rem',
              color: '#f87171', fontSize: '0.84rem',
            }}>
              {error}
            </div>
          )}

          {/* Generate */}
          <button
            className="btn-gold"
            onClick={handleGenerate}
            disabled={loading || !imageFile || !guestName.trim()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
          >
            {loading ? <><span className="btn-spinner" />Generating…</> : 'Generate Card'}
          </button>

          {/* Post-gen summary */}
          {result && (
            <div className="inv-summary">
              <div className="inv-code">{result.code}</div>
              <div className="inv-name">{result.guest_name}</div>
              <div className="inv-drag-hint">Drag elements on the right, then download</div>
            </div>
          )}
        </div>

        {/* ══ RIGHT: Drag canvas ═══════════════════════════════════════════ */}
        <div className="drag-preview-wrap">
          {imagePreview ? (
            <>
              {/* Legend */}
              <div className="drag-hint-label">
                <span><span className="legend-dot" style={{ background: '#3b82f6' }} />Name</span>
                {!isContribution && showCN && (
                  <span><span className="legend-dot" style={{ background: '#10b981' }} />CN</span>
                )}
                {!isContribution && showQR && <span>QR (drag box)</span>}
                <span style={{ marginLeft: 'auto', opacity: 0.6 }}>Drag to reposition</span>
              </div>

              {/* Canvas */}
              <div
                ref={overlayRef}
                className="drag-canvas-container"
                style={{ touchAction: 'none' }}
              >
                <img src={imagePreview} alt="Card" onLoad={onImgLoad} draggable={false} />

                {dragReady && (
                  <>
                    {/* QR placeholder box (positions use posScale) */}
                    {!isContribution && showQR && (
                      <Draggable
                        nodeRef={qrBoxRef}
                        position={{ x: pos.qrLeft * posScale, y: pos.qrTop * posScale }}
                        bounds={{ top: 0, left: 0, right: overlayW - qrBoxPx, bottom: overlayH - qrBoxPx }}
                        onStop={onQrStop}
                      >
                        <div ref={qrBoxRef} className="drag-qr-box" style={{ width: qrBoxPx, height: qrBoxPx }}>
                          QR
                        </div>
                      </Draggable>
                    )}

                    {/* SVG text preview — same font-family as server (Georgia, serif) */}
                    <svg className="drag-canvas-svg" style={{ zIndex: 6 }} aria-hidden="true">
                      <text
                        x={pos.nameX * posScale}
                        y={pos.nameY * posScale}
                        textAnchor="middle"
                        fontFamily="Georgia, serif"
                        fontSize={previewNamePx}
                        fontWeight="700"
                        fill={nameColor}
                        letterSpacing="2"
                        style={{ filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))' }}
                      >
                        {guestName || 'Guest Name'}
                      </text>

                      {!isContribution && showCN && (
                        <text
                          x={pos.codeX * posScale}
                          y={pos.codeY * posScale}
                          textAnchor="middle"
                          fontFamily="Georgia, serif"
                          fontSize={previewCnPx}
                          fontWeight="600"
                          fill={cnColor}
                          letterSpacing="4"
                          style={{ filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.6))' }}
                        >
                          {result?.code || 'CN-000'}
                        </text>
                      )}
                    </svg>

                    {/* Name anchor dot — center = text baseline center */}
                    <Draggable
                      nodeRef={nameAnchorRef}
                      position={{ x: pos.nameX * posScale - ANCHOR_R, y: pos.nameY * posScale - ANCHOR_R }}
                      bounds={{ top: -ANCHOR_R, left: -ANCHOR_R, right: overlayW - ANCHOR_R, bottom: overlayH - ANCHOR_R }}
                      onStop={onNameStop}
                    >
                      <div ref={nameAnchorRef} className="drag-anchor" style={{ zIndex: 10 }}>
                        <div className="drag-anchor__dot" style={{ background: '#3b82f6' }} />
                      </div>
                    </Draggable>

                    {/* CN anchor dot */}
                    {!isContribution && showCN && (
                      <Draggable
                        nodeRef={cnAnchorRef}
                        position={{ x: pos.codeX * posScale - ANCHOR_R, y: pos.codeY * posScale - ANCHOR_R }}
                        bounds={{ top: -ANCHOR_R, left: -ANCHOR_R, right: overlayW - ANCHOR_R, bottom: overlayH - ANCHOR_R }}
                        onStop={onCnStop}
                      >
                        <div ref={cnAnchorRef} className="drag-anchor" style={{ zIndex: 10 }}>
                          <div className="drag-anchor__dot" style={{ background: '#10b981' }} />
                        </div>
                      </Draggable>
                    )}
                  </>
                )}
              </div>

              {/* Download — below canvas */}
              {result && (
                <div className="download-bar">
                  <button
                    className="btn-gold"
                    onClick={handleDownload}
                    disabled={downloading}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  >
                    {downloading ? <><span className="btn-spinner" />Preparing…</> : '⬇ Download Card'}
                  </button>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', textAlign: 'center' }}>
                    Adjust positions above, then download
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="result-placeholder">
              <div className="result-placeholder-icon">🃏</div>
              <div>Upload a card image to begin</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
