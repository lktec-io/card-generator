/**
 * RSVP Celebration — multi-burst canvas-confetti sequence.
 * Gold + champagne + white palette for a premium wedding feel.
 * Sequence: center explosion → left/right cannons → top rain → finale.
 */

const GOLD_PALETTE    = ['#d4af37', '#f5e6a3', '#ffd700', '#b8942a'];
const BLUSH_PALETTE   = ['#ffd1dc', '#f8bbd0', '#fce4ec', '#f48fb1'];
const WHITE_PALETTE   = ['#ffffff', '#fffef0', '#f5f5f5', '#fafafa'];
const LAVENDER_PALETTE = ['#e8d5f5', '#d1c4e9', '#ede7f6', '#ce93d8'];

const ALL_COLORS = [...GOLD_PALETTE, ...BLUSH_PALETTE, ...WHITE_PALETTE, ...LAVENDER_PALETTE];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Trigger the full RSVP celebration confetti sequence.
 * Uses dynamic import so the build never fails if the package is absent.
 */
export async function celebrateRSVP() {
  let confetti;
  try {
    confetti = (await import('canvas-confetti')).default;
  } catch {
    console.warn('[confetti] canvas-confetti not installed — run: npm install canvas-confetti');
    return;
  }

  // ── Burst 1: Center explosion ─────────────────────────────────────────
  confetti({
    particleCount: 130,
    spread:        80,
    origin:        { x: 0.5, y: 0.58 },
    colors:        ALL_COLORS,
    startVelocity: 48,
    ticks:         220,
    gravity:       0.9,
  });

  await sleep(220);

  // ── Burst 2 & 3: Left + Right cannons (simultaneous) ─────────────────
  confetti({
    particleCount: 90,
    angle:         60,
    spread:        60,
    origin:        { x: 0, y: 0.68 },
    colors:        [...GOLD_PALETTE, ...BLUSH_PALETTE],
    startVelocity: 55,
    ticks:         250,
  });
  confetti({
    particleCount: 90,
    angle:         120,
    spread:        60,
    origin:        { x: 1, y: 0.68 },
    colors:        [...GOLD_PALETTE, ...LAVENDER_PALETTE],
    startVelocity: 55,
    ticks:         250,
  });

  await sleep(450);

  // ── Burst 4: Gentle rain from the top ────────────────────────────────
  confetti({
    particleCount: 100,
    spread:        110,
    origin:        { x: 0.5, y: 0 },
    colors:        [...GOLD_PALETTE, ...WHITE_PALETTE],
    startVelocity: 18,
    gravity:       0.75,
    ticks:         300,
    scalar:        1.1,
  });

  await sleep(500);

  // ── Burst 5: Big finale — both sides ─────────────────────────────────
  confetti({
    particleCount: 160,
    angle:         65,
    spread:        85,
    origin:        { x: 0, y: 0.72 },
    colors:        ALL_COLORS,
    startVelocity: 60,
    ticks:         260,
    gravity:       0.85,
  });
  confetti({
    particleCount: 160,
    angle:         115,
    spread:        85,
    origin:        { x: 1, y: 0.72 },
    colors:        ALL_COLORS,
    startVelocity: 60,
    ticks:         260,
    gravity:       0.85,
  });

  await sleep(700);

  // ── Burst 6: Final shower from top-center ────────────────────────────
  confetti({
    particleCount: 80,
    spread:        70,
    origin:        { x: 0.5, y: 0.05 },
    colors:        [...GOLD_PALETTE, ...WHITE_PALETTE],
    startVelocity: 12,
    gravity:       0.6,
    ticks:         350,
    scalar:        0.9,
    drift:         0,
  });
}
