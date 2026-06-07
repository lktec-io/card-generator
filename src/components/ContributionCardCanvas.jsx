import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import Draggable from 'react-draggable';
import '../styles/contribution.css';

// Shared renderer for Contribution Cards — used by the drag-and-drop template
// editor (editable), the guest-facing card (read-only) AND the PNG download
// (html2canvas captures this exact DOM). One render path = WYSIWYG guarantee:
// "live preview" and "download preserves exact positions" both fall out for free.

const ELEMENT_KEYS = ['guestName', 'cn', 'amount', 'qr'];

function normalizeLayout(cfg) {
  const out = {};
  ELEMENT_KEYS.forEach((key) => {
    const el = cfg?.[key] || {};
    out[key] = { x: Number(el.x) || 0, y: Number(el.y) || 0, visible: el.visible !== false };
  });
  return out;
}

const ContributionCardCanvas = forwardRef(function ContributionCardCanvas({
  backgroundImage,
  layoutConfig,
  data = {},
  editable = false,
  onLayoutChange,
  mini = false,
}, forwardedRef) {
  const frameRef     = useRef(null);
  const canvasRef    = useRef(null);
  const guestNameRef = useRef(null);
  const cnRef        = useRef(null);
  const amountRef    = useRef(null);
  const qrRef        = useRef(null);

  const nodeRefs = { guestName: guestNameRef, cn: cnRef, amount: amountRef, qr: qrRef };

  // canvasScale kept in state so it can be passed to <Draggable scale={...}> —
  // keeps drag movement matching the visual canvas size at every zoom level
  // (identical convention to CardGenerator.jsx).
  const [canvasScale, setCanvasScale] = useState(1);

  const layout = normalizeLayout(layoutConfig);

  const updateScale = useCallback(() => {
    if (!frameRef.current || !canvasRef.current) return;
    const frameWidth = frameRef.current.offsetWidth;
    const scale = frameWidth / 1080;
    canvasRef.current.style.transform = `scale(${scale})`;
    setCanvasScale(scale);
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [updateScale]);

  // Adjust frame aspect-ratio to match the uploaded background, then rescale.
  const handleBgLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    if (!naturalWidth || !naturalHeight) return;
    const canvasHeight = Math.round(1080 * naturalHeight / naturalWidth);
    if (frameRef.current)  frameRef.current.style.aspectRatio = `1080 / ${canvasHeight}`;
    if (canvasRef.current) canvasRef.current.style.height     = `${canvasHeight}px`;
    updateScale();
  };

  // Expose the raw 1080px canvas DOM node so callers can run html2canvas on it
  // (reset transform to scale(1) before capture, restore after — see CardGenerator.handleDownload).
  useImperativeHandle(forwardedRef, () => ({
    getCanvas: () => canvasRef.current,
  }), []);

  const handleStop = (key) => (_, d) => {
    if (!onLayoutChange) return;
    onLayoutChange({
      ...layoutConfig,
      [key]: { ...layout[key], x: Math.round(d.x), y: Math.round(d.y) },
    });
  };

  const renderElement = (key, content) => {
    const pos = layout[key];
    if (!pos.visible || content == null || content === '') return null;

    if (editable) {
      return (
        <Draggable
          key={key}
          nodeRef={nodeRefs[key]}
          position={{ x: pos.x, y: pos.y }}
          scale={canvasScale}
          onStop={handleStop(key)}
        >
          <div className={`cc-el cc-el--${key} cc-el--editable`} ref={nodeRefs[key]}>
            {content}
          </div>
        </Draggable>
      );
    }

    return (
      <div
        key={key}
        className={`cc-el cc-el--${key}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        {content}
      </div>
    );
  };

  return (
    <div className={`cc-frame${mini ? ' cc-frame--mini' : ''}`} ref={frameRef}>
      <div className="cc-canvas" ref={canvasRef}>
        {backgroundImage ? (
          <img
            src={backgroundImage}
            className="cc-bg"
            alt="Template background"
            crossOrigin="anonymous"
            onLoad={handleBgLoad}
          />
        ) : (
          <div className="cc-bg-placeholder">No background image</div>
        )}

        {renderElement('guestName', data.guestName)}
        {renderElement('cn', data.cn)}
        {renderElement('amount', data.amount)}
        {renderElement('qr', data.qrDataUrl
          ? <img src={data.qrDataUrl} alt="QR Code" className="cc-qr-img" draggable={false} />
          : null)}
      </div>
    </div>
  );
});

export default ContributionCardCanvas;
