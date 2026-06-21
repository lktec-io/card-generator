/**
 * imageProcessor.js
 * Overlay QR code + guest name + invitation code (+ optional amount + contact)
 * onto a wedding/contribution card image using Sharp + @resvg/resvg-js.
 *
 * Pipeline:
 *   1. Load card; upscale to ≥1200px wide if needed
 *   2. Build QR block with #f5f5f5 background (170px QR + 16px padding → 202×202)
 *   3. Build SVG label: name / code / optional amount / optional contact footer
 *   4. Rasterize SVG with @resvg/resvg-js
 *   5. Composite: card + QR block + label — centred, BOTTOM_MARGIN above bottom edge
 *   6. Return final PNG buffer (high-res, print-ready)
 */

const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ─── Position/size constants ───────────────────────────────────────────────
const QR_SIZE       = 170;
const QR_PAD        = 16;
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // 202 — total padded box
const BOTTOM_MARGIN = 150;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Build the text label SVG.
 *
 * Lines:
 *   1. Guest name  — 120px Georgia, colour = nameColor
 *   2. CN code     —  96px Georgia, colour = cnColor
 *   3. Amount      —  96px Georgia, colour = amountColor  (only when amount present)
 *   4. Contact     —  40px Poppins, colour = #666666      (only when contact present)
 */
function buildTextSVG(cardW, guestName, code, opts) {
  const nameColor    = opts.nameColor    || '#111111';
  const cnColor      = opts.cnColor      || '#222222';
  const amountColor  = opts.amountColor  || '#222222';
  const amount       = opts.amount       || null;
  const contactName  = opts.contactName  || null;
  const contactPhone = opts.contactPhone || null;

  const hasAmount  = !!amount;
  const hasContact = !!(contactName || contactPhone);

  // SVG height grows with each optional line
  let svgHeight = 230;
  if (hasAmount)  svgHeight = 330;
  if (hasContact) svgHeight = 400;

  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgHeight}">
  <style>
    .name    { font: 700 120px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }
    .code    { font: 600  96px Georgia, 'Times New Roman', serif; letter-spacing: 5px; }
    .amount  { font: 600  96px Georgia, 'Times New Roman', serif; letter-spacing: 3px; }
    .contact { font: 400  40px Poppins, sans-serif; letter-spacing: 1px; }
  </style>
  <text x="50%" y="102"  text-anchor="middle" class="name"    fill="${xmlEsc(nameColor)}"  >${xmlEsc(guestName)}</text>
  <text x="50%" y="210"  text-anchor="middle" class="code"    fill="${xmlEsc(cnColor)}"    >${xmlEsc(code)}</text>
  ${hasAmount  ? `<text x="50%" y="302" text-anchor="middle" class="amount"  fill="${xmlEsc(amountColor)}" >${xmlEsc(amount)}</text>` : ''}
  ${hasContact ? `<text x="50%" y="375" text-anchor="middle" class="contact" fill="#666666">${xmlEsc(contactText)}</text>` : ''}
</svg>`;
}

/**
 * Overlay QR + text label on a card image.
 *
 * @param {Buffer} cardBuffer   Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer} qrBuffer     QR PNG buffer (any size — resized internally)
 * @param {string} guestName    Guest name, e.g. "Amos & Angle"
 * @param {string} code         Invitation code, e.g. "CN-001"
 * @param {object} [options]
 * @param {string} [options.nameColor='#111111']
 * @param {string} [options.cnColor='#222222']
 * @param {string} [options.amountColor='#222222']
 * @param {string|null} [options.amount]        Formatted string e.g. "TZS 50,000"
 * @param {string|null} [options.contactName]
 * @param {string|null} [options.contactPhone]
 * @returns {Promise<Buffer>}   Final PNG buffer, print-ready
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code, options = {}) {
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

  // STEP 3 — Build label SVG and rasterize to PNG
  const textSVG = buildTextSVG(cardW, guestName, code, options);
  const textPNG = new Resvg(textSVG, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();

  // Extract SVG height to compute composite positions
  const svgHMatch = textSVG.match(/height="(\d+)"/);
  const textH     = svgHMatch ? Number(svgHMatch[1]) : 230;

  // STEP 4 — Calculate centred positions, BOTTOM_MARGIN above card bottom
  const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
  const qrY   = cardH - QR_BLOCK - textH - BOTTOM_MARGIN;
  const textY = qrY + QR_BLOCK + 4;

  console.log(`[processCardImage] ${cardW}×${cardH} | QR (${qrX},${qrY}) | "${guestName}" | ${code}`);

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
