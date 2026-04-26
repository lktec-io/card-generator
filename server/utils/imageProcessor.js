/**
 * imageProcessor.js
 * Overlay QR code + guest name/code text onto a wedding card image.
 *
 * Pipeline:
 *   1. Load card; upscale to ≥1200px wide if needed
 *   2. Build padded QR block (260px QR + 20px white padding → 300×300)
 *   3. Build text SVG (guestName + code, 90px tall, full card width)
 *   4. Rasterize SVG with @resvg/resvg-js (works on Windows without native builds)
 *   5. Composite: card + text layer + QR block — centre-bottom position
 *   6. Return final PNG buffer (high-res, print-ready)
 */

const sharp        = require('sharp');
const { Resvg }    = require('@resvg/resvg-js');

const QR_SIZE      = 260;   // rendered QR pixel size
const QR_PAD       = 20;    // white padding around QR
const QR_BLOCK     = QR_SIZE + QR_PAD * 2;  // 300
const TEXT_HEIGHT  = 90;    // height of the text SVG layer
const BOTTOM_MARGIN = 40;   // gap from card bottom edge

// XML-safe string escaping
function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Build a full-card-width SVG containing two centred text lines:
 *   Line 1 – guest name (bold 32px Georgia, dark)
 *   Line 2 – invitation code (24px Georgia, gold #C9A84C)
 */
function buildTextSVG(cardW, guestName, code) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${TEXT_HEIGHT}">
  <style>
    .name { font: bold 32px Georgia,'Times New Roman',serif; fill: #1A1A1A; }
    .code { font: 24px Georgia,'Times New Roman',serif; fill: #C9A84C; letter-spacing: 2px; }
  </style>
  <text x="50%" y="38" text-anchor="middle" class="name">${xmlEsc(guestName)}</text>
  <text x="50%" y="74" text-anchor="middle" class="code">${xmlEsc(code)}</text>
</svg>`;
}

/**
 * Overlay QR + text on a wedding card image.
 *
 * @param {Buffer} cardBuffer  Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer} qrBuffer    Styled QR PNG buffer (any size — will be resized)
 * @param {string} guestName
 * @param {string} code        e.g. "CN-001"
 * @returns {Promise<Buffer>}  Final PNG buffer, print-ready
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code) {
  // STEP 1 — Load card metadata; upscale narrow cards to ≥1200px
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

  // STEP 2 — Build padded QR block (QR_SIZE×QR_SIZE + white border → QR_BLOCK×QR_BLOCK)
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

  // STEP 3 — Build text SVG and rasterize to PNG via resvg
  const textSVG = buildTextSVG(cardW, guestName, code);
  const textPNG = new Resvg(textSVG, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();

  // STEP 4 — Calculate centre-bottom positions
  const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
  const qrY   = cardH - QR_BLOCK - TEXT_HEIGHT - BOTTOM_MARGIN;
  const textY = qrY + QR_BLOCK + 4;  // 4px gap between QR and text

  console.log(`[processCardImage] Card ${cardW}×${cardH}, QR at (${qrX},${qrY})`);

  // STEP 5 — Composite layers and output high-res PNG
  const result = await card
    .composite([
      { input: paddedQR, top: qrY,   left: qrX },
      { input: textPNG,  top: textY, left: 0    },
    ])
    .png({ compressionLevel: 6 })
    .toBuffer();

  return result;
}

module.exports = { processCardImage };
