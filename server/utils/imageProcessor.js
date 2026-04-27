/**
 * imageProcessor.js
 * Overlay QR code + invitation code text onto a wedding card image.
 *
 * Pipeline:
 *   1. Load card; upscale to ≥1200px wide if needed
 *   2. Build white-boxed QR block (260px QR + 20px white padding → 300×300)
 *   3. Build code-label SVG (single line: "CN-001", 60px tall, full card width)
 *   4. Rasterize SVG with @resvg/resvg-js
 *   5. Composite: card + QR block + code label — centred, 60px above bottom edge
 *   6. Return final PNG buffer (high-res, print-ready)
 */

const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const QR_SIZE      = 260;                      // QR pixel size
const QR_PAD       = 20;                       // white border around QR
const QR_BLOCK     = QR_SIZE + QR_PAD * 2;    // 300 — total white box size
const TEXT_HEIGHT  = 60;                       // single code-label line
const BOTTOM_MARGIN = 60;                      // gap from card bottom edge

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Single-line code label: "CN-001" — bold, dark, centred, print-clear.
 * Font scaled to card resolution (card is ≥1200px, so 36px looks right).
 */
function buildCodeSVG(cardW, code) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${TEXT_HEIGHT}">
  <style>
    .code {
      font: bold 36px Georgia, 'Times New Roman', serif;
      fill: #1a1a1a;
      letter-spacing: 4px;
    }
  </style>
  <text x="50%" y="44" text-anchor="middle" class="code">${xmlEsc(code)}</text>
</svg>`;
}

/**
 * Overlay QR + code label on a wedding card image.
 *
 * @param {Buffer} cardBuffer  Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer} qrBuffer    QR PNG buffer (any size — resized internally)
 * @param {string} guestName   (accepted for API compatibility, not rendered)
 * @param {string} code        e.g. "CN-001"
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

  // STEP 2 — Resize QR and extend with white border → clean white box
  const paddedQR = await sharp(qrBuffer)
    .resize(QR_SIZE, QR_SIZE, { kernel: 'lanczos3' })
    .extend({
      top:        QR_PAD,
      bottom:     QR_PAD,
      left:       QR_PAD,
      right:      QR_PAD,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();

  // STEP 3 — Build code label SVG and rasterize to PNG
  const codeSVG = buildCodeSVG(cardW, code);
  const codePNG = new Resvg(codeSVG, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();

  // STEP 4 — Calculate centred positions, 60px above card bottom
  const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
  const qrY   = cardH - QR_BLOCK - TEXT_HEIGHT - BOTTOM_MARGIN;
  const textY = qrY + QR_BLOCK + 4;

  console.log(`[processCardImage] Card ${cardW}×${cardH} | QR at (${qrX}, ${qrY})`);

  // STEP 5 — Composite and output high-res PNG
  return card
    .composite([
      { input: paddedQR, top: qrY,   left: qrX },
      { input: codePNG,  top: textY, left: 0    },
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { processCardImage };
