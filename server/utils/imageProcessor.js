const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ─── 1080-canvas-space constants ─────────────────────────────────────────────
const QR_SIZE       = 170;   // QR core size in 1080-canvas units (scales with card)
const QR_PAD        = 16;    // padding around QR (scales with card)
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // 202 canvas units
const BOTTOM_MARGIN = 150;

// Default font sizes in OUTPUT PIXELS (absolute — no cardScale multiplication)
const DEFAULT_NAME_FONT = 150;
const DEFAULT_CN_FONT   = 100;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resolveAlign(align, cardW) {
  if (align === 'left')  return { textAnchor: 'start', cx: Math.round(cardW * 0.05) };
  if (align === 'right') return { textAnchor: 'end',   cx: Math.round(cardW * 0.95) };
  return { textAnchor: 'middle', cx: Math.round(cardW / 2) };
}

// ─── MANUAL mode: full-card SVG per text element ──────────────────────────────
// y = text BASELINE in card-pixel space (matches SVG default; preview SVG uses same)

function buildElementSVG(cardW, cardH, text, cx, y, fontStyle, color, textAnchor = 'middle') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <style>.t { ${fontStyle} }</style>
  <text x="${cx}" y="${y}" text-anchor="${textAnchor}" class="t" fill="${xmlEsc(color)}">${xmlEsc(text)}</text>
</svg>`;
}

// ─── AUTO mode SVGs (fallback when no positions provided) ─────────────────────

function buildAutoInviteSVG(cardW, guestName, code, opts) {
  const nameColor      = opts.nameColor      || '#111111';
  const cnColor        = opts.cnColor        || '#222222';
  const nameFontPx     = opts.nameFontPx     || 88;     // already in card pixels
  const cnFontPx       = opts.cnFontPx       || 56;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const contactName    = opts.contactName    || null;
  const contactPhone   = opts.contactPhone   || null;
  const skipCN         = opts.skipCN         || false;

  const hasContact  = !!(contactName || contactPhone);
  const line2H      = skipCN ? 0 : cnFontPx + 20;
  const line3H      = hasContact ? 50 : 0;
  const svgH        = nameFontPx + line2H + line3H + 20;
  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">
  <style>
    .name    { font: ${nameFontWeight} ${nameFontPx}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }
    .code    { font: 600 ${cnFontPx}px Georgia, 'Times New Roman', serif; letter-spacing: 5px; }
    .contact { font: 400 ${Math.round(cnFontPx * 0.55)}px Poppins, sans-serif; letter-spacing: 1px; }
  </style>
  <text x="${cx}" y="${nameFontPx}" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
  ${!skipCN ? `<text x="50%" y="${nameFontPx + cnFontPx + 20}" text-anchor="middle" class="code" fill="${xmlEsc(cnColor)}">${xmlEsc(code)}</text>` : ''}
  ${hasContact ? `<text x="50%" y="${nameFontPx + line2H + 45}" text-anchor="middle" class="contact" fill="#666666">${xmlEsc(contactText)}</text>` : ''}
</svg>`;
}

function buildAutoContribSVG(cardW, guestName, opts) {
  const nameColor      = opts.nameColor      || '#111111';
  const nameFontPx     = opts.nameFontPx     || 88;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);
  const svgH = nameFontPx + 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">
  <style>.name { font: ${nameFontWeight} ${nameFontPx}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }</style>
  <text x="${cx}" y="${nameFontPx}" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
</svg>`;
}

function rasterise(svgStr) {
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

// Build padded QR resized to correct card-pixel dimensions
async function buildPaddedQR(qrBuffer, cardScale) {
  const qrPx  = Math.round(QR_SIZE  * cardScale);
  const padPx = Math.round(QR_PAD   * cardScale);
  return sharp(qrBuffer)
    .resize(qrPx, qrPx, { kernel: 'lanczos3' })
    .extend({ top: padPx, bottom: padPx, left: padPx, right: padPx,
              background: { r: 245, g: 245, b: 245, alpha: 1 } })
    .png()
    .toBuffer();
}

// ─── Main export ──────────────────────────────────────────────────────────────
/**
 * @param {Buffer}      cardBuffer
 * @param {Buffer}      qrBuffer
 * @param {string}      guestName
 * @param {string}      code
 * @param {object}      [opts]
 * @param {boolean}     [opts.isContribution]
 * @param {boolean}     [opts.skipQR]
 * @param {boolean}     [opts.skipCN]
 * @param {string}      [opts.nameColor]
 * @param {string}      [opts.cnColor]
 * @param {number}      [opts.nameFontSize]   canvas-space units (1080-ref)
 * @param {number}      [opts.cnFontSize]     canvas-space units (1080-ref)
 * @param {string}      [opts.nameFontWeight]
 * @param {string}      [opts.nameTextAlign]
 * @param {string|null} [opts.contactName]
 * @param {string|null} [opts.contactPhone]
 * @param {object|null} [opts.positions]  { nameX, nameY, codeX, codeY, qrLeft, qrTop }
 *                                         all in 1080-canvas space; Y = text baseline
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code, opts = {}) {
  const {
    isContribution = false,
    skipQR         = false,
    skipCN         = false,
    nameColor      = '#111111',
    cnColor        = '#222222',
    nameFontSize   = DEFAULT_NAME_FONT,
    cnFontSize     = DEFAULT_CN_FONT,
    nameFontWeight = '700',
    nameTextAlign  = 'center',
    contactName    = null,
    contactPhone   = null,
    positions      = null,
  } = opts;

  const hideQR = isContribution || skipQR;
  const hideCN = isContribution || skipCN;

  // ── Load & normalise card (min 1200px wide) ───────────────────────────────
  let card = sharp(cardBuffer);
  const meta = await card.metadata();
  let cardW = meta.width;
  let cardH = meta.height;

  if (cardW < 1200) {
    const u = 1200 / cardW;
    cardH = Math.round(cardH * u);
    cardW = 1200;
    card  = card.resize(cardW, cardH, { kernel: 'lanczos3' });
  }

  // cardScale converts 1080-canvas units → actual card pixels
  const cardScale = cardW / 1080;

  // Font sizes are ABSOLUTE output pixels — user-selected value rendered directly,
  // no cardScale multiplication (WYSIWYG: preview and download use the same px value)
  const nameFontPx = Math.round(nameFontSize);
  const cnFontPx   = Math.round(cnFontSize);

  const nameStyle  = `font: ${nameFontWeight} ${nameFontPx}px Georgia, 'Times New Roman', serif; letter-spacing: 2px;`;
  const cnStyle    = `font: 600 ${cnFontPx}px Georgia, 'Times New Roman', serif; letter-spacing: 5px;`;

  const { textAnchor: nameAnchor, cx: nameCX } = resolveAlign(nameTextAlign, cardW);

  let composites;

  if (positions) {
    // ── MANUAL mode ──────────────────────────────────────────────────────────
    const { nameX, nameY, codeX, codeY, qrLeft, qrTop } = positions;

    // Convert 1080-canvas coords → card pixels
    const scaledNameCX    = nameX != null ? Math.round(nameX * cardScale) : nameCX;
    const effectiveAnchor = nameX != null ? 'middle' : nameAnchor;
    const scaledNameY     = Math.round(nameY * cardScale);

    // Clamp Y so text is on card (baseline must be ≥ font height)
    const clampedNameY = Math.max(nameFontPx, Math.min(scaledNameY, cardH + Math.round(nameFontPx * 0.3)));

    const namePNG = rasterise(buildElementSVG(
      cardW, cardH, guestName,
      scaledNameCX, clampedNameY,
      nameStyle, nameColor, effectiveAnchor,
    ));
    composites = [{ input: namePNG, top: 0, left: 0 }];

    if (!hideQR && qrLeft != null && qrTop != null) {
      const paddedQR     = await buildPaddedQR(qrBuffer, cardScale);
      const scaledQrLeft = Math.max(0, Math.round(qrLeft * cardScale));
      const scaledQrTop  = Math.max(0, Math.round(qrTop  * cardScale));
      composites.unshift({ input: paddedQR, top: scaledQrTop, left: scaledQrLeft });
    }

    if (!hideCN && codeY != null) {
      const scaledCodeCX = codeX != null ? Math.round(codeX * cardScale) : Math.round(cardW / 2);
      const scaledCodeY  = Math.round(codeY * cardScale);
      const clampedCodeY = Math.max(cnFontPx, Math.min(scaledCodeY, cardH + Math.round(cnFontPx * 0.3)));

      const codePNG = rasterise(buildElementSVG(cardW, cardH, code, scaledCodeCX, clampedCodeY, cnStyle, cnColor));
      composites.push({ input: codePNG, top: 0, left: 0 });

      const hasContact = !!(contactName || contactPhone);
      if (hasContact) {
        const contactText  = [contactName, contactPhone].filter(Boolean).join('  |  ');
        const contactFontPx = Math.round(Math.min(cnFontPx * 0.55, 40));
        const contactStyle  = `font: 400 ${contactFontPx}px Poppins, sans-serif; letter-spacing: 1px;`;
        const contactY     = clampedCodeY + Math.round(cnFontPx * 1.3);
        const contactPNG   = rasterise(buildElementSVG(
          cardW, cardH, contactText, Math.round(cardW / 2), contactY, contactStyle, '#666666',
        ));
        composites.push({ input: contactPNG, top: 0, left: 0 });
      }
    }

  } else {
    // ── AUTO mode (fallback) ──────────────────────────────────────────────────
    if (isContribution) {
      const svg  = buildAutoContribSVG(cardW, guestName, { nameColor, nameFontPx, nameFontWeight, nameTextAlign });
      const png  = rasterise(svg);
      const svgH = nameFontPx + 20;
      composites = [{ input: png, top: Math.max(0, cardH - svgH - BOTTOM_MARGIN), left: 0 }];

    } else {
      const scaledQrBlock = Math.round(QR_BLOCK * cardScale);
      const textSVG  = buildAutoInviteSVG(cardW, guestName, code, {
        nameColor, cnColor, nameFontPx, cnFontPx, nameFontWeight, nameTextAlign,
        contactName, contactPhone, skipCN,
      });
      const textPNG  = rasterise(textSVG);
      const svgHMatch = textSVG.match(/height="(\d+)"/);
      const textH    = svgHMatch ? Number(svgHMatch[1]) : nameFontPx + cnFontPx + 80;

      const qrX  = Math.floor((cardW - scaledQrBlock) / 2);
      const qrY  = Math.max(0, cardH - scaledQrBlock - textH - BOTTOM_MARGIN);
      const textY = qrY + scaledQrBlock + 4;

      composites = [{ input: textPNG, top: Math.max(0, textY), left: 0 }];

      if (!hideQR) {
        const paddedQR = await buildPaddedQR(qrBuffer, cardScale);
        composites.unshift({ input: paddedQR, top: qrY, left: Math.max(0, qrX) });
      }
    }
  }

  console.log(`[processCardImage] ${cardW}×${cardH} cardScale=${cardScale.toFixed(3)} | namePx=${nameFontPx} cnPx=${cnFontPx} | ${positions ? 'MANUAL' : 'AUTO'} | hideQR=${hideQR} hideCN=${hideCN}`);

  return card
    .composite(composites)
    .png({ compressionLevel: 3 })
    .toBuffer();
}

module.exports = { processCardImage };
