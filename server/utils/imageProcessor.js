const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ─── Constants (1080-canvas space) ───────────────────────────────────────────
const QR_SIZE       = 170;  // QR core px (scaled by cardScale at render time)
const QR_PAD        = 16;   // padding around QR
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // 202px in 1080-canvas space
const BOTTOM_MARGIN = 150;

// Default font sizes in 1080-canvas space
const DEFAULT_NAME_FONT_SIZE = 150;
const CN_FONT_PX             = 120;
const CN_FONT_STYLE          = `font: 600 ${CN_FONT_PX}px Georgia, 'Times New Roman', serif; letter-spacing: 5px;`;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function resolveAlign(align, cardW) {
  if (align === 'left')  return { textAnchor: 'start', cx: Math.round(cardW * 0.05) };
  if (align === 'right') return { textAnchor: 'end',   cx: Math.round(cardW * 0.95) };
  return { textAnchor: 'middle', cx: Math.round(cardW / 2) };
}

// ─── AUTO mode SVGs (legacy / fallback) ──────────────────────────────────────

function buildAutoInviteSVG(cardW, guestName, code, opts) {
  const nameColor      = opts.nameColor      || '#111111';
  const cnColor        = opts.cnColor        || '#222222';
  const nameFontSize   = opts.nameFontSize   || DEFAULT_NAME_FONT_SIZE;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const contactName    = opts.contactName    || null;
  const contactPhone   = opts.contactPhone   || null;
  const skipCN         = opts.skipCN         || false;

  const hasContact  = !!(contactName || contactPhone);
  const lines       = [1, !skipCN ? 1 : 0, hasContact ? 1 : 0].reduce((a, b) => a + b, 0);
  const svgHeight   = 120 + lines * 115;
  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgHeight}">
  <style>
    .name    { font: ${nameFontWeight} ${nameFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }
    .code    { font: 600 ${CN_FONT_PX}px Georgia, 'Times New Roman', serif; letter-spacing: 5px; }
    .contact { font: 400 40px Poppins, sans-serif; letter-spacing: 1px; }
  </style>
  <text x="${cx}" y="${nameFontSize}" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
  ${!skipCN ? `<text x="50%" y="${nameFontSize + CN_FONT_PX + 20}" text-anchor="middle" class="code" fill="${xmlEsc(cnColor)}">${xmlEsc(code)}</text>` : ''}
  ${hasContact ? `<text x="50%" y="${nameFontSize + (skipCN ? 0 : CN_FONT_PX + 20) + 55}" text-anchor="middle" class="contact" fill="#666666">${xmlEsc(contactText)}</text>` : ''}
</svg>`;
}

function buildAutoContribSVG(cardW, guestName, opts) {
  const nameColor      = opts.nameColor      || '#111111';
  const nameFontSize   = opts.nameFontSize   || DEFAULT_NAME_FONT_SIZE;
  const nameFontWeight = opts.nameFontWeight || '700';
  const nameTextAlign  = opts.nameTextAlign  || 'center';
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);
  const svgH = nameFontSize + 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">
  <style>.name { font: ${nameFontWeight} ${nameFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px; }</style>
  <text x="${cx}" y="${nameFontSize}" text-anchor="${textAnchor}" class="name" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>
</svg>`;
}

// ─── MANUAL mode: full-card transparent SVG per element ──────────────────────
// dominant-baseline="hanging" → y = TOP of text (matches preview handle top)

function buildElementSVG(cardW, cardH, text, cx, y, fontStyle, color, textAnchor = 'middle') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">
  <style>.t { ${fontStyle} }</style>
  <text x="${cx}" y="${y}" dominant-baseline="hanging" text-anchor="${textAnchor}" class="t" fill="${xmlEsc(color)}">${xmlEsc(text)}</text>
</svg>`;
}

function rasterise(svgStr) {
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

// ─── Build padded QR buffer at the correct size for this card ────────────────

async function buildPaddedQR(qrBuffer, cardScale) {
  const scaledQrPx  = Math.round(QR_SIZE * cardScale);
  const scaledPadPx = Math.round(QR_PAD  * cardScale);
  return sharp(qrBuffer)
    .resize(scaledQrPx, scaledQrPx, { kernel: 'lanczos3' })
    .extend({
      top: scaledPadPx, bottom: scaledPadPx,
      left: scaledPadPx, right: scaledPadPx,
      background: { r: 245, g: 245, b: 245, alpha: 1 },
    })
    .png()
    .toBuffer();
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {Buffer}      cardBuffer
 * @param {Buffer}      qrBuffer
 * @param {string}      guestName
 * @param {string}      code
 * @param {object}      [options]
 * @param {boolean}     [options.isContribution]
 * @param {boolean}     [options.skipQR]          hide QR (overrides isContribution)
 * @param {boolean}     [options.skipCN]          hide CN code (overrides isContribution)
 * @param {string}      [options.nameColor]
 * @param {string}      [options.cnColor]
 * @param {number}      [options.nameFontSize]    px in 1080-canvas space
 * @param {string}      [options.nameFontWeight]
 * @param {string}      [options.nameTextAlign]
 * @param {string|null} [options.contactName]
 * @param {string|null} [options.contactPhone]
 * @param {object|null} [options.positions]       { nameX, nameY, codeX, codeY, qrLeft, qrTop }
 *                                                 nameY/codeY = text TOP (dominant-baseline hanging)
 * @returns {Promise<Buffer>}
 */
async function processCardImage(cardBuffer, qrBuffer, guestName, code, options = {}) {
  const {
    isContribution = false,
    skipQR         = false,
    skipCN         = false,
    nameColor      = '#111111',
    cnColor        = '#222222',
    nameFontSize   = DEFAULT_NAME_FONT_SIZE,
    nameFontWeight = '700',
    nameTextAlign  = 'center',
    contactName    = null,
    contactPhone   = null,
    positions      = null,
  } = options;

  const hideQR = isContribution || skipQR;
  const hideCN = isContribution || skipCN;

  // ── Load card; upscale narrow images to ≥1200px ──────────────────────────
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

  const cardScale = cardW / 1080;

  const scaledFontSize = Math.round(nameFontSize * cardScale);
  const nameStyle = `font: ${nameFontWeight} ${scaledFontSize}px Georgia, 'Times New Roman', serif; letter-spacing: 2px;`;
  const { textAnchor: nameAnchor, cx: nameCX } = resolveAlign(nameTextAlign, cardW);

  let composites;

  if (positions) {
    // ── MANUAL mode ──────────────────────────────────────────────────────
    const { nameX, nameY, codeX, codeY, qrLeft, qrTop } = positions;

    const scaledNameCX    = nameX != null ? Math.round(nameX * cardScale) : nameCX;
    const effectiveAnchor = nameX != null ? 'middle' : nameAnchor;
    const scaledNameY     = Math.round(nameY * cardScale);

    const namePNG = rasterise(buildElementSVG(
      cardW, cardH, guestName,
      scaledNameCX, scaledNameY,
      nameStyle, nameColor, effectiveAnchor,
    ));
    composites = [{ input: namePNG, top: 0, left: 0 }];

    if (!hideQR && qrLeft != null && qrTop != null) {
      const paddedQR     = await buildPaddedQR(qrBuffer, cardScale);
      const scaledQrLeft = Math.round(qrLeft * cardScale);
      const scaledQrTop  = Math.round(qrTop  * cardScale);
      composites.unshift({ input: paddedQR, top: Math.max(0, scaledQrTop), left: Math.max(0, scaledQrLeft) });
    }

    if (!hideCN && codeY != null) {
      const scaledCodeCX = codeX != null ? Math.round(codeX * cardScale) : Math.round(cardW / 2);
      const scaledCodeY  = Math.round(codeY * cardScale);
      const scaledCnStyle = `font: 600 ${Math.round(CN_FONT_PX * cardScale)}px Georgia, 'Times New Roman', serif; letter-spacing: 5px;`;
      const codePNG = rasterise(buildElementSVG(cardW, cardH, code, scaledCodeCX, scaledCodeY, scaledCnStyle, cnColor));
      composites.push({ input: codePNG, top: 0, left: 0 });

      const hasContact = !!(contactName || contactPhone);
      if (hasContact) {
        const contactText  = [contactName, contactPhone].filter(Boolean).join('  |  ');
        const contactStyle = `font: 400 ${Math.round(40 * cardScale)}px Poppins, sans-serif; letter-spacing: 1px;`;
        const cy           = Math.round((codeY + CN_FONT_PX + 10) * cardScale);
        const contactPNG   = rasterise(buildElementSVG(cardW, cardH, contactText, Math.round(cardW / 2), cy, contactStyle, '#666666'));
        composites.push({ input: contactPNG, top: 0, left: 0 });
      }
    }

  } else {
    // ── AUTO mode (fallback) ──────────────────────────────────────────────
    if (isContribution) {
      const svg  = buildAutoContribSVG(cardW, guestName, { nameColor, nameFontSize: scaledFontSize, nameFontWeight, nameTextAlign });
      const png  = rasterise(svg);
      const svgH = scaledFontSize + 20;
      const textY = Math.max(0, cardH - svgH - BOTTOM_MARGIN);
      composites = [{ input: png, top: textY, left: 0 }];

    } else {
      const scaledQrBlock = Math.round(QR_BLOCK * cardScale);
      const textSVG  = buildAutoInviteSVG(cardW, guestName, code, {
        nameColor, cnColor, nameFontSize: scaledFontSize, nameFontWeight, nameTextAlign,
        contactName, contactPhone, skipCN,
      });
      const textPNG  = rasterise(textSVG);
      const svgHMatch = textSVG.match(/height="(\d+)"/);
      const textH    = svgHMatch ? Number(svgHMatch[1]) : scaledFontSize + 150;

      const qrX  = Math.floor((cardW - scaledQrBlock) / 2);
      const qrY  = cardH - scaledQrBlock - textH - BOTTOM_MARGIN;
      const textY = qrY + scaledQrBlock + 4;

      composites = [{ input: textPNG, top: Math.max(0, textY), left: 0 }];

      if (!hideQR) {
        const paddedQR = await buildPaddedQR(qrBuffer, cardScale);
        composites.unshift({ input: paddedQR, top: Math.max(0, qrY), left: Math.max(0, qrX) });
      }
    }
  }

  console.log(`[processCardImage] ${cardW}×${cardH} | "${guestName}" | ${positions ? 'manual' : 'auto'} | skipQR=${hideQR} skipCN=${hideCN}`);

  return card
    .composite(composites)
    .png({ compressionLevel: 3 })
    .toBuffer();
}

module.exports = { processCardImage };
