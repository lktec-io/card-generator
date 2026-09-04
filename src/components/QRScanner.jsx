import { useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'qr-scanner-viewport';

// Camera constraints. Unsupported keys are ignored by the browser, and a full
// fallback path below covers devices that reject the whole set.
//
// NOTE: `advanced` is an ordered list — the browser applies the FIRST satisfiable
// entry and skips the rest. Focus is therefore the only entry here; a `zoom` entry
// placed first would win and silently prevent autofocus from ever being applied.
const VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width:      { ideal: 1280 },
  height:     { ideal: 720 },
  advanced:   [{ focusMode: 'continuous' }],
};

// qrbox sets the scan window: html5-qrcode crops the video to this region and only
// decodes inside it. The old fixed 260px box looked at as little as 41% of the frame
// width, so a QR that was off-centre or simply didn't fit the small centre box was
// never examined at all. Widening it does NOT change pixel density (the library
// downscales by videoWidth/clientWidth either way) — it widens what gets seen.
const qrboxFn = (viewfinderWidth, viewfinderHeight) => {
  const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.9);
  const size = Math.max(220, edge);   // never smaller than the old fixed box
  return { width: size, height: size };
};

const SCAN_CONFIG = {
  fps: 20,
  qrbox: qrboxFn,
  // Cards are never mirrored. Without this html5-qrcode runs a SECOND decode pass
  // on a flipped canvas for every frame that misses — pure waste on every miss.
  disableFlip: true,
  // Native hardware-accelerated detector where the browser has it (Chrome/Android);
  // silently falls back to the bundled JS decoder everywhere else.
  experimentalFeatures: { useBarCodeDetectorIfSupported: true },
};

// Progressive enhancement: ask the live track for continuous autofocus. Applying this
// after the stream is running is more reliable than the initial constraint, because we
// can check getCapabilities() first and only request what the device actually offers.
// Anything unsupported is skipped — the camera keeps its default behaviour.
async function tuneCameraTrack(scanner) {
  try {
    const caps = scanner.getRunningTrackCapabilities?.();
    if (!caps || !Array.isArray(caps.focusMode)) return;

    const mode = ['continuous', 'auto'].find((m) => caps.focusMode.includes(m));
    if (!mode) return;

    await scanner.applyVideoConstraints({ advanced: [{ focusMode: mode }] });
  } catch (_) {
    /* device/browser does not support these — keep default camera behaviour */
  }
}

/**
 * QRScanner — camera-based QR scanning component.
 * Props:
 *   onResult {Function(code: string)}  called once per successful scan
 *   active   {boolean}                 when false, scanner is stopped
 */
export default function QRScanner({ onResult, active }) {
  const scannerRef    = useRef(null);
  const processingRef = useRef(false);
  const startingRef   = useRef(false);

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    const scanner = scannerRef.current;
    scannerRef.current = null;          // claim it first, so a concurrent stop is a no-op
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch (_) { /* ignore cleanup errors */ }
  }, []);

  const startScanner = useCallback(async () => {
    // Guard against overlapping starts (rapid toggling / StrictMode double-invoke),
    // which would otherwise leave a second camera stream running.
    if (startingRef.current || scannerRef.current) return;
    startingRef.current = true;
    processingRef.current = false;

    const onSuccess = (decodedText) => {
      // Guard: ignore duplicate fires during async verify
      if (processingRef.current) return;
      processingRef.current = true;

      // Parse JSON payload {code, name}; fall back to raw text
      let code = decodedText.trim();
      try {
        const parsed = JSON.parse(decodedText);
        if (parsed.code) code = parsed.code;
      } catch (_) { /* plain-text QR — use as-is */ }

      onResult(code);
    };

    try {
      const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
      scannerRef.current = scanner;
      await scanner.start(
        VIDEO_CONSTRAINTS,
        SCAN_CONFIG,
        onSuccess,
        () => { /* per-frame decode misses — normal, ignore */ }
      );
      await tuneCameraTrack(scanner);
    } catch (err) {
      // Fallback: retry with minimal constraints if the advanced ones are rejected
      console.warn('[QRScanner] high-res start failed, retrying with fallback:', err?.message || err);
      scannerRef.current = null;
      try {
        processingRef.current = false;
        const fallback = new Html5Qrcode(SCANNER_ELEMENT_ID);
        scannerRef.current = fallback;
        await fallback.start(
          { facingMode: 'environment' },
          { fps: 20, qrbox: qrboxFn, disableFlip: true },
          onSuccess,
          () => {}
        );
      } catch (err2) {
        scannerRef.current = null;
        console.error('[QRScanner] fallback also failed:', err2);
      }
    } finally {
      startingRef.current = false;
    }
  }, [onResult]);

  useEffect(() => {
    if (active) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => { stopScanner(); };
  }, [active, startScanner, stopScanner]);

  return (
    <div className="scanner-viewport">
      <div id={SCANNER_ELEMENT_ID} style={{ width: '100%' }} />
      <div className="scan-line" />
      <p className="scanner-hint">Point camera at the QR code on the invitation</p>
    </div>
  );
}
