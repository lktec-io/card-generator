/**
 * imageProcessor.js
 * Overlay QR code + guest name + invitation code (+ optional amount + contact)
 * onto a card image using Sharp + @resvg/resvg-js.
 *
 * Supports two modes:
 *   AUTO   — elements centred at bottom (legacy behaviour, no positions arg)
 *   MANUAL — caller provides absolute Y coords for text and X,Y for QR block
 *            (used by drag-and-drop card generator)
 *
 * All coordinates are in the 1080-pixel canvas space.
 */

const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ─── Constants ────────────────────────────────────────────────────────────────
const QR_SIZE       = 170;
const QR_PAD        = 16;
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // 202px padded box
const BOTTOM_MARGIN = 150;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ─── AUTO mode: original single full-width SVG block (backward compat) ────────

function buildAutoTextSVG(cardW, guestName, code, opts) {
  const nameColor    = opts.nameColor    || '#111111';
  const cnColor      = opts.cnColor      || '#222222';
  const amountColor  = opts.amountColor  || '#222222';
  const amount       = opts.amount       || null;
  const contactName  = opts.contactName  || null;
  const contactPhone = opts.contactPhone || null;

  const hasAmount  = !!amount;
  const hasContact = !!(contactName || contactPhone);

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
  ${hasAmount  ? `<text x="50%" y="302" text-anchor="middle" class="amount"  fill="${xmlEsc(amountColor)}">${xmlEsc(amount)}</text>` : ''}
  ${hasContact ? `<text x="50%" y="375" text-anchor="middle" class="contact" fill="#666666">${xmlEsc(contactText)}</text>` : ''}
</svg>`;
}

// ─── MANUAL mode: individual full-card transparent SVG per text element ───────
// Each SVG is the same size as the card; only contains one text node at (cx, y).
// Alpha-composited at (0,0) so the text lands at the right absolute coordinates.

function buildElementSVG(cardW, cardH, text, cx, y, fontStyle, color) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <style>.t { ${fontStyle} }</style>
  <text x="${cx}" y="${y}" text-anchor="middle" class="t" fill="${xmlEsc(color)}">${xmlEsc(text)}</text>
</svg>`;
}

const FONT_STYLES = {
  name:    "font: 700 120px Georgia, 'Times New Roman', serif; letter-spacing: 2px;",
  code:    "font: 600  96px Georgia, 'Times New Roman', serif; letter-spacing: 5px;",
  amount:  "font: 600  96px Georgia, 'Times New Roman', serif; letter-spacing: 3px;",
  contact: "font: 400  40px Poppins, sans-serif; letter-spacing: 1px;",
};

function rasterise(svgStr) {
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Overlay QR + text onto a card image.
 *
 * @param {Buffer}      cardBuffer   Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer}      qrBuffer     QR PNG buffer
 * @param {string}      guestName
 * @param {string}      code         CN code e.g. "CN-042"
 * @param {object}      [options]
 * @param {string}      [options.nameColor]
 * @param {string}      [options.cnColor]
 * @param {string}      [options.amountColor]
 * @param {string|null} [options.amount]       Formatted string e.g. "TZS 50,000"
 * @param {string|null} [options.contactName]
 * @param {string|null} [options.contactPhone]
 * @param {object|null} [options.positions]    Manual positions in 1080px canvas space:
 *   { nameY, codeY, qrLeft, qrTop, amountY?, contactY? }
 *   nameY/codeY/amountY = the SVG baseline Y coordinate for center-aligned text.
 *   qrLeft/qrTop = top-left corner of the padded QR block.
 * @returns {Promise<Buffer>}   Final PNG buffer, print-ready
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code, options = {}) {
  const {
    nameColor    = '#111111',
    cnColor      = '#222222',
    amountColor  = '#222222',
    amount       = null,
    contactName  = null,
    contactPhone = null,
    positions    = null,
  } = options;

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

  // STEP 2 — Resize QR and extend with off-white border
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

  const hasAmount  = !!amount;
  const hasContact = !!(contactName || contactPhone);
  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');

  let composites;

  if (positions) {
    // ── MANUAL mode: each element at absolute coordinates ──────────────────
    const { nameY, codeY, qrLeft, qrTop, amountY, contactY } = positions;

    const namePNG = rasterise(buildElementSVG(
      cardW, cardH, guestName, cardW / 2, nameY, FONT_STYLES.name, nameColor
    ));
    const codePNG = rasterise(buildElementSVG(
      cardW, cardH, code, cardW / 2, codeY, FONT_STYLES.code, cnColor
    ));

    composites = [
      { input: paddedQR, top: Math.max(0, Math.round(qrTop)),  left: Math.max(0, Math.round(qrLeft)) },
      { input: namePNG,  top: 0, left: 0 },
      { input: codePNG,  top: 0, left: 0 },
    ];

    if (hasAmount && amountY != null) {
      const amountPNG = rasterise(buildElementSVG(
        cardW, cardH, amount, cardW / 2, amountY, FONT_STYLES.amount, amountColor
      ));
      composites.push({ input: amountPNG, top: 0, left: 0 });
    }

    if (hasContact) {
      const cy = contactY ?? (amountY ? amountY + 80 : codeY + 80);
      const contactPNG = rasterise(buildElementSVG(
        cardW, cardH, contactText, cardW / 2, cy, FONT_STYLES.contact, '#666666'
      ));
      composites.push({ input: contactPNG, top: 0, left: 0 });
    }

  } else {
    // ── AUTO mode: centred block at bottom (original behaviour) ───────────
    const textSVG = buildAutoTextSVG(cardW, guestName, code, {
      nameColor, cnColor, amountColor, amount, contactName, contactPhone,
    });
    const textPNG = rasterise(textSVG);

    const svgHMatch = textSVG.match(/height="(\d+)"/);
    const textH     = svgHMatch ? Number(svgHMatch[1]) : 230;

    const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
    const qrY   = cardH - QR_BLOCK - textH - BOTTOM_MARGIN;
    const textY = qrY + QR_BLOCK + 4;

    composites = [
      { input: paddedQR, top: qrY,   left: qrX },
      { input: textPNG,  top: textY, left: 0   },
    ];
  }

  console.log(`[processCardImage] ${cardW}×${cardH} | "${guestName}" | ${code} | mode=${positions ? 'manual' : 'auto'}`);

  return card
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { processCardImage };
