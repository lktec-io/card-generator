/**
 * Styled QR Code Generator
 * Strategy: build an SVG manually from the raw QR module matrix,
 * then rasterize with @resvg/resvg-js (no canvas / build-tool deps).
 *
 * Dot style : rounded squares (dotsType "rounded")
 * Finder    : extra-rounded nested squares (cornersSquareOptions "extra-rounded")
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

// ─── finder pattern (3-layer nested rounded squares) ─────────────────────────

function finderPattern(fx, fy, moduleSize, fill = '#1a1a2e') {
  const fs   = moduleSize * 7;
  const unit = moduleSize;
  const innerSz = unit * 5;
  const coreSz  = unit * 3;

  return [
    rect(fx,           fy,           fs,       fs,       fs * 0.22,       fill),
    rect(fx + unit,    fy + unit,    innerSz,  innerSz,  innerSz * 0.15,  '#ffffff'),
    rect(fx + unit*2,  fy + unit*2,  coreSz,   coreSz,   coreSz * 0.25,   fill),
  ].join('\n');
}

// ─── core SVG builder ────────────────────────────────────────────────────────

function buildQRSVG(data, outputSize = 600, dotColor = '#1a1a2e') {
  const qr          = QRCode.create(data, { errorCorrectionLevel: 'H' });
  const moduleCount = qr.modules.size;
  const modules     = qr.modules.data;

  // Quiet zone = 3 modules on each side (QR spec minimum = 4, we use 3 for compactness)
  const margin     = 3;
  const totalMods  = moduleCount + margin * 2;
  const modSz      = outputSize / totalMods;
  const offset     = margin * modSz;
  const dotRadius  = modSz * 0.40;

  // Zones to skip (we draw finder patterns as one piece)
  const inFinder = (row, col) => {
    const N = moduleCount;
    if (row < 9  && col < 9)          return true;  // top-left
    if (row < 9  && col >= N - 9)     return true;  // top-right
    if (row >= N - 9 && col < 9)      return true;  // bottom-left
    return false;
  };

  const parts = [
    `<rect width="${outputSize}" height="${outputSize}" fill="#ffffff" rx="12" ry="12"/>`,
  ];

  // Regular dots
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (inFinder(row, col)) continue;
      if (!modules[row * moduleCount + col]) continue;

      const x   = offset + col * modSz;
      const y   = offset + row * modSz;
      const pad = modSz * 0.10;
      parts.push(rect(x + pad, y + pad, modSz - pad * 2, modSz - pad * 2, dotRadius, dotColor));
    }
  }

  // Three finder patterns
  const N = moduleCount;
  parts.push(finderPattern(offset,                      offset,                      modSz, dotColor));
  parts.push(finderPattern(offset + (N - 7) * modSz,   offset,                      modSz, dotColor));
  parts.push(finderPattern(offset,                      offset + (N - 7) * modSz,   modSz, dotColor));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${outputSize}" height="${outputSize}"
     viewBox="0 0 ${outputSize} ${outputSize}">
${parts.join('\n')}
</svg>`;
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Generate a styled QR code PNG buffer.
 * @param {string} data       Data to encode (will be stringified if object)
 * @param {number} outputSize Width/height in pixels (default 600 for print quality)
 * @returns {Promise<Buffer>}
 */
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
