import { useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'qr-scanner-viewport';

/**
 * QRScanner — camera-based QR scanning component.
 * Props:
 *   onResult {Function(code: string)}  called once per scan; scanner pauses until caller signals ready
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

    try {
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 280 }, aspectRatio: 1.0 },
        (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;

          // Parse JSON payload; fall back to raw text
          let code = decodedText.trim();
          try {
            const parsed = JSON.parse(decodedText);
            if (parsed.code) code = parsed.code;
          } catch (_) { /* plain-text QR */ }

          onResult(code);
        },
        () => { /* per-frame decode errors — ignore */ }
      );
    } catch (err) {
      console.error('[QRScanner]', err);
    }
  }, [onResult]);

  // Start/stop in response to the `active` prop
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
      {/* html5-qrcode injects the camera feed here */}
      <div id={SCANNER_ELEMENT_ID} style={{ width: '100%' }} />
      <div className="scan-line" />
      <p className="scanner-hint">Point camera at the QR code on the invitation</p>
    </div>
  );
}
