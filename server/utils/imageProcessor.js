/**
 * imageProcessor.js
 * Overlay QR code + guest name + invitation code onto a wedding card image.
 *
 * Pipeline:
 *   1. Load card; upscale to ≥1200px wide if needed
 *   2. Build QR block with #f5f5f5 background (260px QR + 20px padding → 300×300)
 *   3. Build two-line SVG label: "John Doe" / "CN-001" — 90px tall, full card width
 *   4. Rasterize SVG with @resvg/resvg-js
 *   5. Composite: card + QR block + label — centred, 70px above bottom edge
 *   6. Return final PNG buffer (high-res, print-ready)
 */

const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const QR_SIZE       = 260;                     // QR pixel size
const QR_PAD        = 20;                      // border around QR
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // 300 — total box size
const TEXT_HEIGHT   = 90;                      // two lines: name + code
const BOTTOM_MARGIN = 70;                      // gap from card bottom edge

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Two-line label: guest name (top) + invitation code (bottom).
 * Bold, dark, centred, scaled to card resolution (≥1200px wide).
 */
function buildTextSVG(cardW, guestName, code) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${TEXT_HEIGHT}">
  <style>
    .name {
      font: 600 30px Georgia, 'Times New Roman', serif;
      fill: #1a1a1a;
      letter-spacing: 2px;
    }
    .code {
      font: bold 36px Georgia, 'Times New Roman', serif;
      fill: #1a1a1a;
      letter-spacing: 4px;
    }
  </style>
  <text x="50%" y="32" text-anchor="middle" class="name">${xmlEsc(guestName)}</text>
  <text x="50%" y="76" text-anchor="middle" class="code">${xmlEsc(code)}</text>
</svg>`;
}

/**
 * Overlay QR + text label on a wedding card image.
 *
 * @param {Buffer} cardBuffer  Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer} qrBuffer    QR PNG buffer (any size — resized internally)
 * @param {string} guestName   Guest name, e.g. "John & Jane Doe"
 * @param {string} code        Invitation code, e.g. "CN-001"
 * @returns {Promise<Buffer>}  Final PNG buffer, print-ready
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code) {
  // STEP 1 — Load card; upscale narrow images to ≥1200px
  let card = sharp(cardBuffer);
  const meta = await card.metadata();
  let cardW  = meta.width;
  let cardH  = meta.height;

  if (cardW < 1200) {
    const scale = 1200 / cardW;
    cardH = Math.round(cardH * scale);
    cardW = 1200;
    card  = card.resize(cardW, cardH, { kernel: 'lanczos3' });
  }

  // STEP 2 — Resize QR and extend with #f5f5f5 border → clean off-white box
  const paddedQR = await sharp(qrBuffer)
    .resize(QR_SIZE, QR_SIZE, { kernel: 'lanczos3' })
    .extend({
      top:        QR_PAD,
      bottom:     QR_PAD,
      left:       QR_PAD,
      right:      QR_PAD,
      background: { r: 245, g: 245, b: 245, alpha: 1 },
    })
    .png()
    .toBuffer();

  // STEP 3 — Build two-line label SVG and rasterize to PNG
  const textSVG = buildTextSVG(cardW, guestName, code);
  const textPNG = new Resvg(textSVG, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();

  // STEP 4 — Calculate centred positions, 70px above card bottom
  const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
  const qrY   = cardH - QR_BLOCK - TEXT_HEIGHT - BOTTOM_MARGIN;
  const textY = qrY + QR_BLOCK + 4;

  console.log(`[processCardImage] Card ${cardW}×${cardH} | QR at (${qrX}, ${qrY}) | Guest: "${guestName}" | Code: ${code}`);

  // STEP 5 — Composite and output high-res PNG
  return card
    .composite([
      { input: paddedQR, top: qrY,   left: qrX },
      { input: textPNG,  top: textY, left: 0    },
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { processCardImage };
