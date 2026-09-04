const sharp     = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

// ════════════════════════════════════════════════════════════════════════════
//  ★ QR SIZE CONTROL ★  — change QR_SIZE and nothing else.
//    Bigger number = bigger QR on the generated card. Everything below derives
//    from it, so the layout re-centres itself automatically.
//    ⚠️ Must stay in sync with QR_SIZE in src/components/CardGenerator.jsx
// ════════════════════════════════════════════════════════════════════════════
const QR_SIZE       = 260;                    // ← THE ONE VALUE TO CHANGE (was 170)
const QR_PAD        = 16;                     // white quiet-zone padding around it
const QR_BLOCK      = QR_SIZE + QR_PAD * 2;   // canvas units (position math)
const BOTTOM_MARGIN = 150;

// Default font sizes — absolute output pixels, matched by CardGenerator defaults
const DEFAULT_NAME_FONT = 150;
const DEFAULT_CN_FONT   = 100;

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveAlign(align, cardW) {
  if (align === 'left')  return { textAnchor: 'start', cx: Math.round(cardW * 0.05) };
  if (align === 'right') return { textAnchor: 'end',   cx: Math.round(cardW * 0.95) };
  return { textAnchor: 'middle', cx: Math.round(cardW / 2) };
}

// ─── INLINE-ATTRIBUTE SVG builder ────────────────────────────────────────────
// Uses presentation attributes directly on <text> — NOT a CSS class.
// Resvg does NOT reliably apply CSS <style> block rules; inline attrs always work.
// y = text BASELINE (SVG default).

function buildTextSVG(cardW, cardH, text, cx, y, {
  fontSize,              // px — absolute output pixels, no scaling
  fontWeight = '700',
  fontFamily = 'Georgia, serif',
  letterSpacing = '2',
  fill,
  textAnchor = 'middle',
}) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}">` +
    `<text` +
    ` x="${cx}" y="${y}"` +
    ` text-anchor="${textAnchor}"` +
    ` font-family="${xmlEsc(fontFamily)}"` +
    ` font-size="${fontSize}"` +
    ` font-weight="${fontWeight}"` +
    ` letter-spacing="${letterSpacing}"` +
    ` fill="${xmlEsc(fill)}"` +
    `>${xmlEsc(text)}</text>` +
    `</svg>`
  );
}

// ─── AUTO mode fallback SVGs (used when no drag positions are provided) ───────

function buildAutoInviteSVG(cardW, guestName, code, opts) {
  const {
    nameColor   = '#111111',
    cnColor     = '#222222',
    nameFontPx  = 150,
    cnFontPx    = 100,
    nameFontWeight = '700',
    nameTextAlign  = 'center',
    contactName = null,
    contactPhone = null,
    skipCN      = false,
  } = opts;

  const hasContact = !!(contactName || contactPhone);
  const line2H     = skipCN ? 0 : cnFontPx + 20;
  const line3H     = hasContact ? 50 : 0;
  const svgH       = nameFontPx + line2H + line3H + 20;
  const contactText = [contactName, contactPhone].filter(Boolean).join('  |  ');
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);
  const contactFontPx = Math.round(Math.min(cnFontPx * 0.55, 48));

  let svg =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">` +
    `<text x="${cx}" y="${nameFontPx}" text-anchor="${textAnchor}"` +
    ` font-family="Georgia, serif" font-size="${nameFontPx}" font-weight="${nameFontWeight}"` +
    ` letter-spacing="2" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>`;

  if (!skipCN) {
    svg +=
      `<text x="${Math.round(cardW / 2)}" y="${nameFontPx + cnFontPx + 20}" text-anchor="middle"` +
      ` font-family="Georgia, serif" font-size="${cnFontPx}" font-weight="600"` +
      ` letter-spacing="5" fill="${xmlEsc(cnColor)}">${xmlEsc(code)}</text>`;
  }

  if (hasContact) {
    svg +=
      `<text x="${Math.round(cardW / 2)}" y="${nameFontPx + line2H + 45}" text-anchor="middle"` +
      ` font-family="Georgia, serif" font-size="${contactFontPx}" font-weight="400"` +
      ` letter-spacing="1" fill="#666666">${xmlEsc(contactText)}</text>`;
  }

  svg += `</svg>`;
  return svg;
}

function buildAutoContribSVG(cardW, guestName, opts) {
  const {
    nameColor      = '#111111',
    nameFontPx     = 150,
    nameFontWeight = '700',
    nameTextAlign  = 'center',
  } = opts;
  const { textAnchor, cx } = resolveAlign(nameTextAlign, cardW);
  const svgH = nameFontPx + 20;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${svgH}">` +
    `<text x="${cx}" y="${nameFontPx}" text-anchor="${textAnchor}"` +
    ` font-family="Georgia, serif" font-size="${nameFontPx}" font-weight="${nameFontWeight}"` +
    ` letter-spacing="2" fill="${xmlEsc(nameColor)}">${xmlEsc(guestName)}</text>` +
    `</svg>`
  );
}

function rasterise(svgStr) {
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

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
async function processCardImage(cardBuffer, qrBuffer, guestName, code, opts = {}) {
  const t0 = Date.now();

  const {
    isContribution = false,
    skipQR         = false,
    skipCN         = false,
    nameColor      = '#111111',
    cnColor        = '#222222',
    nameFontSize   = DEFAULT_NAME_FONT,   // ABSOLUTE output pixels
    cnFontSize     = DEFAULT_CN_FONT,     // ABSOLUTE output pixels
    nameFontWeight = '700',
    nameTextAlign  = 'center',
    contactName    = null,
    contactPhone   = null,
    positions      = null,
    naturalW       = 0,  // client-provided dimensions; skip metadata() when set
    naturalH       = 0,
  } = opts;

  const hideQR = isContribution || skipQR;
  const hideCN = isContribution || skipCN;

  // ── Load card — normalise to min 1200px wide ──────────────────────────────
  let card = sharp(cardBuffer);
  let cardW, cardH;
  if (naturalW >= 1 && naturalH >= 1) {
    cardW = naturalW;
    cardH = naturalH;
  } else {
    const meta = await card.metadata();
    cardW = meta.width;
    cardH = meta.height;
  }

  if (cardW < 1200) {
    const u = 1200 / cardW;
    cardH = Math.round(cardH * u);
    cardW = 1200;
    card  = card.resize(cardW, cardH, { kernel: 'lanczos3' });
  }

  // cardScale: for POSITION coordinates only (1080-canvas → actual card px)
  const cardScale = cardW / 1080;

  // Font sizes: ABSOLUTE output pixels — no cardScale multiplication
  const nameFontPx = Math.round(nameFontSize);
  const cnFontPx   = Math.round(cnFontSize);

  // ── Debug log: exact values entering SVG generation ──────────────────────
  console.log('[imageProcessor] render params:', {
    cardWidth:              cardW,
    cardHeight:             cardH,
    cardScale:              cardScale.toFixed(3),
    nameFontSize_received:  nameFontSize,
    cnFontSize_received:    cnFontSize,
    nameFontPx_in_SVG:      nameFontPx,
    cnFontPx_in_SVG:        cnFontPx,
    mode:                   positions ? 'MANUAL' : 'AUTO',
    hideQR,
    hideCN,
  });

  const { textAnchor: nameAnchor, cx: nameCX } = resolveAlign(nameTextAlign, cardW);
  let composites;

  if (positions) {
    // ── MANUAL mode ──────────────────────────────────────────────────────────
    const { nameX, nameY, codeX, codeY, qrLeft, qrTop } = positions;

    const scaledNameCX    = nameX != null ? Math.round(nameX * cardScale) : nameCX;
    const effectiveAnchor = nameX != null ? 'middle' : nameAnchor;
    const scaledNameY     = Math.round(nameY * cardScale);
    const clampedNameY    = Math.max(nameFontPx, Math.min(scaledNameY, cardH + Math.round(nameFontPx * 0.3)));

    console.log('[imageProcessor] name SVG:', {
      cx: scaledNameCX, y: clampedNameY,
      'font-size': nameFontPx,
      fontFamily: 'Georgia, serif',
    });

    console.time('[timer] svg-name');
    const namePNG = rasterise(buildTextSVG(cardW, cardH, guestName, scaledNameCX, clampedNameY, {
      fontSize: nameFontPx,
      fontWeight: nameFontWeight,
      letterSpacing: '2',
      fill: nameColor,
      textAnchor: effectiveAnchor,
    }));
    console.timeEnd('[timer] svg-name');
    composites = [{ input: namePNG, top: 0, left: 0 }];

    if (!hideQR && qrLeft != null && qrTop != null) {
      console.time('[timer] qr-scale');
      const paddedQR     = await buildPaddedQR(qrBuffer, cardScale);
      console.timeEnd('[timer] qr-scale');
      const scaledQrLeft = Math.max(0, Math.round(qrLeft * cardScale));
      const scaledQrTop  = Math.max(0, Math.round(qrTop  * cardScale));
      composites.unshift({ input: paddedQR, top: scaledQrTop, left: scaledQrLeft });
    }

    if (!hideCN && codeY != null) {
      const scaledCodeCX = codeX != null ? Math.round(codeX * cardScale) : Math.round(cardW / 2);
      const scaledCodeY  = Math.round(codeY * cardScale);
      const clampedCodeY = Math.max(cnFontPx, Math.min(scaledCodeY, cardH + Math.round(cnFontPx * 0.3)));

      console.log('[imageProcessor] CN SVG:', {
        cx: scaledCodeCX, y: clampedCodeY,
        'font-size': cnFontPx,
      });

      console.time('[timer] svg-cn');
      const codePNG = rasterise(buildTextSVG(cardW, cardH, code, scaledCodeCX, clampedCodeY, {
        fontSize: cnFontPx,
        fontWeight: '600',
        letterSpacing: '5',
        fill: cnColor,
      }));
      console.timeEnd('[timer] svg-cn');
      composites.push({ input: codePNG, top: 0, left: 0 });

      const hasContact = !!(contactName || contactPhone);
      if (hasContact) {
        const contactText   = [contactName, contactPhone].filter(Boolean).join('  |  ');
        const contactFontPx = Math.round(Math.min(cnFontPx * 0.55, 48));
        const contactY      = clampedCodeY + Math.round(cnFontPx * 1.3);
        const contactPNG    = rasterise(buildTextSVG(cardW, cardH, contactText, Math.round(cardW / 2), contactY, {
          fontSize: contactFontPx,
          fontWeight: '400',
          letterSpacing: '1',
          fill: '#666666',
        }));
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
      const qrX      = Math.floor((cardW - scaledQrBlock) / 2);
      const qrY      = Math.max(0, cardH - scaledQrBlock - textH - BOTTOM_MARGIN);
      const textY    = qrY + scaledQrBlock + 4;

      composites = [{ input: textPNG, top: Math.max(0, textY), left: 0 }];

      if (!hideQR) {
        const paddedQR = await buildPaddedQR(qrBuffer, cardScale);
        composites.unshift({ input: paddedQR, top: qrY, left: Math.max(0, qrX) });
      }
    }
  }

  console.time('[timer] sharp-composite');
  const result = await card
    .composite(composites)
    .png({ compressionLevel: 3 })
    .toBuffer();
  console.timeEnd('[timer] sharp-composite');

  console.log(`[imageProcessor] total=${Date.now() - t0}ms | output=${result.length} bytes`);

  return result;
}

module.exports = { processCardImage };
