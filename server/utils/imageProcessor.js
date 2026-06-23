/**
 * imageProcessor.js
 * Overlay QR code + guest name + invitation code onto a card image
 * using Sharp + @resvg/resvg-js.
 *
 * Contribution mode: renders Guest Name ONLY (no QR, no CN, no amount).
 * Invitation mode:   renders Name + CN code + QR block.
 *
 * Two positioning modes:
 *   AUTO   — elements centred at bottom (legacy / fallback, no positions arg)
 *   MANUAL — caller provides absolute Y coords for text and X,Y for QR block
 *            (used by the drag-and-drop card generator)
 *
 * All coordinates are in the 1080-pixel canvas space.
 * Text customisation (size, weight, alignment, color) applies to Guest Name in both modes.
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

// Resolve text-anchor and cx from alignment + card width
function resolveAlign(align, cardW) {
  if (align === 'left')  return { textAnchor: 'start', cx: Math.round(cardW * 0.05) };
  if (align === 'right') return { textAnchor: 'end',   cx: Math.round(cardW * 0.95) };
  return { textAnchor: 'middle', cx: Math.round(cardW / 2) };
}

// ─── AUTO mode: single full-width SVG block placed at bottom (invitation) ─────

function buildAutoInviteSVG(cardW, guestName, code, opts) {
  const nameColor    = opts.nameColor    || '#111111';
  const cnColor      = opts.cnColor      || '#222222';
  const nameFontSize   = opts.nameFontSize   || 120;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const contactName  = opts.contactName  || null;
  const contactPhone = opts.contactPhone || null;

  const hasContact  = !!(contactName || contactPhone);
  const svgHeight   = hasContact ? 320 : 230;
  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgHeight}">
  <style>
    .name    { font: ${nameFontWeight} ${nameFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }
    .code    { font: 600  96px Georgia, 'Times New Roman', serif; letter-spacing: 5px; }
    .contact { font: 400  40px Poppins, sans-serif; letter-spacing: 1px; }
  </style>
  <text x="${cx}"  y="102" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
  <text x="50%"    y="210" text-anchor="middle"        class="code" fill="${xmlEsc(cnColor)}"  >${xmlEsc(code)}</text>
  ${hasContact ? `<text x="50%" y="295" text-anchor="middle" class="contact" fill="#666666">${xmlEsc(contactText)}</text>` : ''}
</svg>`;
}

// AUTO mode contribution: guest name only
function buildAutoContribSVG(cardW, guestName, opts) {
  const nameColor      = opts.nameColor      || '#111111';
  const nameFontSize   = opts.nameFontSize   || 120;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);
  const textY   = Math.round(nameFontSize * 1.15);
  const svgH    = textY + 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">
  <style>.name { font: ${nameFontWeight} ${nameFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }</style>
  <text x="${cx}" y="${textY}" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
</svg>`;
}

// ─── MANUAL mode: individual full-card transparent SVG per element ─────────────
// Composited at (0,0) — text lands at its absolute coordinate.

function buildElementSVG(cardW, cardH, text, cx, y, fontStyle, color, textAnchor = 'middle') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <style>.t { ${fontStyle} }</style>
  <text x="${cx}" y="${y}" text-anchor="${textAnchor}" class="t" fill="${xmlEsc(color)}">${xmlEsc(text)}</text>
</svg>`;
}

const CN_FONT_STYLE = "font: 600 96px Georgia, 'Times New Roman', serif; letter-spacing: 5px;";

function rasterise(svgStr) {
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Overlay text (and QR for invitation) onto a card image.
 *
 * @param {Buffer}      cardBuffer   Raw image buffer (JPEG / PNG / WebP)
 * @param {Buffer}      qrBuffer     QR PNG buffer (ignored for contribution)
 * @param {string}      guestName
 * @param {string}      code         CN code e.g. "CN-042" (ignored for contribution)
 * @param {object}      [options]
 * @param {boolean}     [options.isContribution]   Skip QR + CN rendering when true
 * @param {string}      [options.nameColor]
 * @param {string}      [options.cnColor]
 * @param {number}      [options.nameFontSize]      px in 1080-canvas space (default 120)
 * @param {string}      [options.nameFontWeight]    CSS font-weight string (default '700')
 * @param {string}      [options.nameTextAlign]     'left' | 'center' | 'right' (default 'center')
 * @param {string|null} [options.contactName]
 * @param {string|null} [options.contactPhone]
 * @param {object|null} [options.positions]         Manual positions in 1080px canvas space:
 *   { nameY, codeY, qrLeft, qrTop }
 *   nameY/codeY = SVG baseline Y; qrLeft/qrTop = top-left of padded QR block.
 * @returns {Promise<Buffer>}   Final PNG buffer, print-ready
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code, options = {}) {
  const {
    isContribution = false,
    nameColor      = '#111111',
    cnColor        = '#222222',
    nameFontSize   = 120,
    nameFontWeight = '700',
    nameTextAlign  = 'center',
    contactName    = null,
    contactPhone   = null,
    positions      = null,
  } = options;

  // STEP 1 — Load card; upscale narrow images to ≥1200px
  let card = sharp(cardBuffer);
  const meta = await card.metadata();
  let cardW  = meta.width;
  let cardH  = meta.height;

  if (cardW < 1200) {
    const upscale = 1200 / cardW;
    cardH = Math.round(cardH * upscale);
    cardW = 1200;
    card  = card.resize(cardW, cardH, { kernel: 'lanczos3' });
  }

  // Card scale from 1080px canvas to actual card pixels
  const cardScale = cardW / 1080;

  // Dynamic name font (scaled to actual card size)
  const scaledFontSize = Math.round(nameFontSize * cardScale);
  const nameStyle = `font: ${nameFontWeight} ${scaledFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px;`;
  const { textAnchor: nameAnchor, cx: nameCX } = resolveAlign(nameTextAlign, cardW);

  let composites;

  if (positions) {
    // ── MANUAL mode: each element at absolute canvas-scaled coordinates ──────
    const { nameY, codeY, qrLeft, qrTop } = positions;

    const scaledNameY = Math.round(nameY * cardScale);
    const namePNG = rasterise(buildElementSVG(cardW, cardH, guestName, nameCX, scaledNameY, nameStyle, nameColor, nameAnchor));

    composites = [{ input: namePNG, top: 0, left: 0 }];

    if (!isContribution) {
      // STEP 2 — Resize QR and add off-white border (invitation only)
      const paddedQR = await sharp(qrBuffer)
        .resize(QR_SIZE, QR_SIZE, { kernel: 'lanczos3' })
        .extend({
          top: QR_PAD, bottom: QR_PAD, left: QR_PAD, right: QR_PAD,
          background: { r: 245, g: 245, b: 245, alpha: 1 },
        })
        .png()
        .toBuffer();

      const scaledQrLeft = Math.round(qrLeft * cardScale);
      const scaledQrTop  = Math.round(qrTop  * cardScale);
      const scaledCodeY  = Math.round(codeY  * cardScale);

      const codePNG = rasterise(buildElementSVG(cardW, cardH, code, Math.round(cardW / 2), scaledCodeY, CN_FONT_STYLE, cnColor));

      composites.unshift({ input: paddedQR, top: Math.max(0, scaledQrTop), left: Math.max(0, scaledQrLeft) });
      composites.push({ input: codePNG, top: 0, left: 0 });

      const hasContact = !!(contactName || contactPhone);
      if (hasContact) {
        const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');
        const contactStyle = "font: 400 40px Poppins, sans-serif; letter-spacing: 1px;";
        const cy = Math.round((codeY + 80) * cardScale);
        const contactPNG = rasterise(buildElementSVG(cardW, cardH, contactText, Math.round(cardW / 2), cy, contactStyle, '#666666'));
        composites.push({ input: contactPNG, top: 0, left: 0 });
      }
    }

  } else {
    // ── AUTO mode: centred block at bottom (legacy / fallback) ───────────────
    if (isContribution) {
      const svg  = buildAutoContribSVG(cardW, guestName, { nameColor, nameFontSize: scaledFontSize, nameFontWeight, nameTextAlign });
      const png  = rasterise(svg);
      const hMatch = svg.match(/height="(\d+)"/);
      const svgH = hMatch ? Number(hMatch[1]) : Math.round(scaledFontSize * 1.5);
      const textY = Math.max(0, cardH - svgH - BOTTOM_MARGIN);
      composites = [{ input: png, top: textY, left: 0 }];
    } else {
      // STEP 2 — Resize QR and add off-white border (invitation AUTO)
      const paddedQR = await sharp(qrBuffer)
        .resize(QR_SIZE, QR_SIZE, { kernel: 'lanczos3' })
        .extend({
          top: QR_PAD, bottom: QR_PAD, left: QR_PAD, right: QR_PAD,
          background: { r: 245, g: 245, b: 245, alpha: 1 },
        })
        .png()
        .toBuffer();

      const textSVG = buildAutoInviteSVG(cardW, guestName, code, {
        nameColor, cnColor, nameFontSize: scaledFontSize, nameFontWeight, nameTextAlign, contactName, contactPhone,
      });
      const textPNG = rasterise(textSVG);
      const svgHMatch = textSVG.match(/height="(\d+)"/);
      const textH = svgHMatch ? Number(svgHMatch[1]) : 230;

      const qrX   = Math.floor((cardW - QR_BLOCK) / 2);
      const qrY   = cardH - QR_BLOCK - textH - BOTTOM_MARGIN;
      const textY = qrY + QR_BLOCK + 4;

      composites = [
        { input: paddedQR, top: qrY,   left: qrX },
        { input: textPNG,  top: textY, left: 0   },
      ];
    }
  }

  console.log(`[processCardImage] ${cardW}×${cardH} | "${guestName}" | mode=${positions ? 'manual' : 'auto'} | ${isContribution ? 'contribution' : 'invitation'} | align=${nameTextAlign} size=${nameFontSize}px`);

  return card
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();
}

module.exports = { processCardImage };
