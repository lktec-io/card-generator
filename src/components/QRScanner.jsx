import { useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'qr-scanner-viewport';

// High-res camera constraints — browser ignores unsupported advanced props gracefully
const VIDEO_CONSTRAINTS = {
  facingMode: { ideal: 'environment' },
  width:      { ideal: 1280 },
  height:     { ideal: 720 },
  advanced: [
    { zoom: 2.0 },           // zoom in for clarity — ignored if device doesn't support
    { focusMode: 'continuous' }, // continuous autofocus
  ],
};

/**
 * QRScanner — camera-based QR scanning component.
 * Props:
 *   onResult {Function(code: string)}  called once per successful scan
 *   active   {boolean}                 when false, scanner is stopped
 */
export default function QRScanner({ onResult, active }) {
  const scannerRef    = useRef(null);
  const processingRef = useRef(false);

  const stopScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    try {
      if (scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
      scannerRef.current.clear();
    } catch (_) { /* ignore cleanup errors */ }
    scannerRef.current = null;
  }, []);

  const startScanner = useCallback(async () => {
    processingRef.current = false;

    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

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
      await scanner.start(
        VIDEO_CONSTRAINTS,               // high-res + zoom + autofocus
        {
          fps:         15,               // scan 15 frames/sec (was 10)
          qrbox:       { width: 260, height: 260 },
          aspectRatio: 1.33,
        },
        onSuccess,
        () => { /* per-frame decode misses — normal, ignore */ }
      );
    } catch (err) {
      // Fallback: retry with minimal constraints if advanced ones fail
      console.warn('[QRScanner] high-res start failed, retrying with fallback:', err.message);
      try {
        processingRef.current = false;
        const fallback = new Html5Qrcode(SCANNER_ELEMENT_ID);
        scannerRef.current = fallback;
        await fallback.start(
          { facingMode: 'environment' },
          { fps: 15, qrbox: { width: 260, height: 260 } },
          onSuccess,
          () => {}
        );
      } catch (err2) {
        console.error('[QRScanner] fallback also failed:', err2);
      }
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
