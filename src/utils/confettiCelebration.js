/**
 * RSVP Celebration — multi-burst canvas-confetti sequence.
 * Gold + champagne + blush + white palette for a premium wedding feel.
 * zIndex: 99999 — confetti renders ABOVE the success modal.
 */

const GOLD     = ['#d4af37', '#f5e6a3', '#ffd700', '#b8942a', '#e8c84a'];
const BLUSH    = ['#ffd1dc', '#f8bbd0', '#fce4ec', '#f48fb1', '#ff8fab'];
const WHITE    = ['#ffffff', '#fffef0', '#f5f5f5', '#fefefe'];
const LAVENDER = ['#e8d5f5', '#d1c4e9', '#ede7f6', '#ba68c8'];

const ALL = [...GOLD, ...BLUSH, ...WHITE, ...LAVENDER];

const Z = 99999;  // above success modal (9990)

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function celebrateRSVP() {
  let confetti;
  try {
    confetti = (await import('canvas-confetti')).default;
  } catch {
    console.warn('[confetti] Run: npm install canvas-confetti');
    return;
  }

  // ── Burst 1: Big center explosion ────────────────────────────────────
  confetti({
    particleCount: 160,
    spread:        90,
    origin:        { x: 0.5, y: 0.60 },
    colors:        ALL,
    startVelocity: 52,
    ticks:         380,
    gravity:       0.85,
    scalar:        1.25,
    zIndex:        Z,
  });

  await sleep(250);

  // ── Burst 2 + 3: Left + Right cannons (simultaneous) ─────────────────
  confetti({
    particleCount: 110,
    angle:         60,
    spread:        65,
    origin:        { x: 0, y: 0.70 },
    colors:        [...GOLD, ...BLUSH],
    startVelocity: 58,
    ticks:         360,
    scalar:        1.2,
    zIndex:        Z,
  });
  confetti({
    particleCount: 110,
    angle:         120,
    spread:        65,
    origin:        { x: 1, y: 0.70 },
    colors:        [...GOLD, ...LAVENDER],
    startVelocity: 58,
    ticks:         360,
    scalar:        1.2,
    zIndex:        Z,
  });

  await sleep(500);

  // ── Burst 4: Slow rain from top ───────────────────────────────────────
  confetti({
    particleCount: 120,
    spread:        120,
    origin:        { x: 0.5, y: 0 },
    colors:        [...GOLD, ...WHITE],
    startVelocity: 20,
    gravity:       0.70,
    ticks:         420,
    scalar:        1.15,
    zIndex:        Z,
    drift:         0,
  });

  await sleep(600);

  // ── Burst 5: Wide finale — both corners ───────────────────────────────
  confetti({
    particleCount: 180,
    angle:         65,
    spread:        90,
    origin:        { x: 0, y: 0.72 },
    colors:        ALL,
    startVelocity: 62,
    ticks:         400,
    gravity:       0.88,
    scalar:        1.3,
    zIndex:        Z,
  });
  confetti({
    particleCount: 180,
    angle:         115,
    spread:        90,
    origin:        { x: 1, y: 0.72 },
    colors:        ALL,
    startVelocity: 62,
    ticks:         400,
    gravity:       0.88,
    scalar:        1.3,
    zIndex:        Z,
  });

  await sleep(800);

  // ── Burst 6: Lingering shower — top center ───────────────────────────
  confetti({
    particleCount: 90,
    spread:        80,
    origin:        { x: 0.5, y: 0.03 },
    colors:        [...GOLD, ...WHITE, ...BLUSH],
    startVelocity: 14,
    gravity:       0.55,
    ticks:         500,
    scalar:        1.1,
    zIndex:        Z,
    drift:         0.1,
  });
}
