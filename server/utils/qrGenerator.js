/**
 * Styled QR Code Generator
 * Strategy: build an SVG manually from the raw QR module matrix,
 * then rasterize with @resvg/resvg-js (no canvas / build-tool deps).
 *
 * Dot style   : square (clean, high-contrast, scan-friendly)
 * Finder      : sharp nested squares (strong, visible corner markers)
 */

const QRCode = require('qrcode');
const { Resvg } = require('@resvg/resvg-js');

// ─── helpers ────────────────────────────────────────────────────────────────

function n(v, d = 2) {
  return parseFloat(v.toFixed(d));
}

function rect(x, y, w, h, r, fill) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ry="${n(r)}" fill="${fill}"/>`;
}

// ─── finder pattern (sharp nested squares, clearly visible on print) ──────────

function finderPattern(fx, fy, moduleSize, fill = '#000000') {
  const fs      = moduleSize * 7;
  const unit    = moduleSize;
  const innerSz = unit * 5;
  const coreSz  = unit * 3;

  // radius = 1 gives barely-perceptible rounding — visually square
  return [
    rect(fx,            fy,            fs,       fs,       1,  fill),
    rect(fx + unit,     fy + unit,     innerSz,  innerSz,  1,  '#ffffff'),
    rect(fx + unit * 2, fy + unit * 2, coreSz,   coreSz,   1,  fill),
  ].join('\n');
}

// ─── core SVG builder ────────────────────────────────────────────────────────

function buildQRSVG(data, outputSize = 600, dotColor = '#000000') {
  const qr          = QRCode.create(data, { errorCorrectionLevel: 'H' });
  const moduleCount = qr.modules.size;
  const modules     = qr.modules.data;

  const margin    = 3;
  const totalMods = moduleCount + margin * 2;
  const modSz     = outputSize / totalMods;
  const offset    = margin * modSz;

  // Square dots: radius nearly zero, minimal gap between modules
  const dotRadius = modSz * 0.05;
  const pad       = modSz * 0.04;

  const inFinder = (row, col) => {
    const N = moduleCount;
    if (row < 9 && col < 9)        return true;
    if (row < 9 && col >= N - 9)   return true;
    if (row >= N - 9 && col < 9)   return true;
    return false;
  };

  const parts = [
    `<rect width="${outputSize}" height="${outputSize}" fill="#ffffff"/>`,
  ];

  // Regular modules — square dots
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (inFinder(row, col)) continue;
      if (!modules[row * moduleCount + col]) continue;

      const x = offset + col * modSz;
      const y = offset + row * modSz;
      parts.push(rect(x + pad, y + pad, modSz - pad * 2, modSz - pad * 2, dotRadius, dotColor));
    }
  }

  // Three finder patterns
  const N = moduleCount;
  parts.push(finderPattern(offset,                    offset,                    modSz, dotColor));
  parts.push(finderPattern(offset + (N - 7) * modSz, offset,                    modSz, dotColor));
  parts.push(finderPattern(offset,                    offset + (N - 7) * modSz, modSz, dotColor));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${outputSize}" height="${outputSize}"
     viewBox="0 0 ${outputSize} ${outputSize}">
${parts.join('\n')}
</svg>`;
}

// ─── public API ──────────────────────────────────────────────────────────────

async function generateStyledQRBuffer(data, outputSize = 600) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const svg     = buildQRSVG(payload, outputSize);

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: outputSize },
    font:  { loadSystemFonts: true },
  });

  return resvg.render().asPng();
}

module.exports = { generateStyledQRBuffer };
