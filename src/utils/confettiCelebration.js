// Static import — always bundled, never fails at runtime.
// Dynamic import was swallowed by the catch block and confetti never fired.
import confetti from 'canvas-confetti';

// ── Color palette ─────────────────────────────────────────────────────────────
const GOLD     = ['#d4af37', '#f5e6a3', '#ffd700', '#b8942a', '#e8c84a'];
const BLUSH    = ['#ffd1dc', '#f8bbd0', '#fce4ec', '#f48fb1', '#ff8fab'];
const WHITE    = ['#ffffff', '#fffef0', '#f5f5f5', '#fefefe'];
const LAVENDER = ['#e8d5f5', '#d1c4e9', '#ede7f6', '#ba68c8'];
const ALL = [...GOLD, ...BLUSH, ...WHITE, ...LAVENDER];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Creates a full-screen fixed canvas appended directly to document.body.
 * Bypasses any overflow:hidden, transform, filter, or z-index constraints
 * on page containers. pointer-events:none so it never blocks interaction.
 */
function makeCanvas() {
  const el = document.createElement('canvas');
  el.style.cssText =
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:999999;margin:0;padding:0;border:0;';
  document.body.appendChild(el);
  return el;
}

/**
 * Soft crystal-bell arpeggio — C major (C5 E5 G5 C6).
 * Elegant, emotional, non-intrusive. Suitable for weddings, church events,
 * conferences, and formal occasions. Shared by RSVP and Voice Message success.
 */
export function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const t   = ctx.currentTime + i * 0.11;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(env);
      env.connect(ctx.destination);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.15, t + 0.018);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.start(t);
      osc.stop(t + 0.95);
    });
  } catch (_) { /* AudioContext unavailable */ }
}

/**
 * Premium multi-burst confetti — gold/champagne/blush/white/lavender palette.
 *
 * Root fixes applied:
 *   1. Static import instead of dynamic — no silent catch() failure
 *   2. Dedicated fixed canvas via confetti.create() — above all CSS constraints
 *   3. Console logs to confirm execution in DevTools
 *   4. Canvas removed only after all particles finish (~6 s total)
 */
export async function celebrateRSVP() {
  console.log('[confetti] Confetti started');

  const canvas = makeCanvas();
  const fire   = confetti.create(canvas, { resize: true, useWorker: true });

  // ── Burst 1: Big center explosion ─────────────────────────────────────────
  fire({ particleCount: 160, spread: 90,  origin: { x: 0.5, y: 0.60 },
    colors: ALL, startVelocity: 52, ticks: 380, gravity: 0.85, scalar: 1.25 });

  await sleep(250);

  // ── Burst 2 + 3: Left + Right cannons ────────────────────────────────────
  fire({ particleCount: 110, angle: 60,  spread: 65, origin: { x: 0, y: 0.70 },
    colors: [...GOLD, ...BLUSH],    startVelocity: 58, ticks: 360, scalar: 1.2 });
  fire({ particleCount: 110, angle: 120, spread: 65, origin: { x: 1, y: 0.70 },
    colors: [...GOLD, ...LAVENDER], startVelocity: 58, ticks: 360, scalar: 1.2 });

  await sleep(500);

  // ── Burst 4: Slow rain from top ───────────────────────────────────────────
  fire({ particleCount: 120, spread: 120, origin: { x: 0.5, y: 0 },
    colors: [...GOLD, ...WHITE], startVelocity: 20, gravity: 0.70,
    ticks: 420, scalar: 1.15, drift: 0 });

  await sleep(600);

  // ── Burst 5: Wide finale — both corners ──────────────────────────────────
  fire({ particleCount: 180, angle: 65,  spread: 90, origin: { x: 0, y: 0.72 },
    colors: ALL, startVelocity: 62, ticks: 400, gravity: 0.88, scalar: 1.3 });
  fire({ particleCount: 180, angle: 115, spread: 90, origin: { x: 1, y: 0.72 },
    colors: ALL, startVelocity: 62, ticks: 400, gravity: 0.88, scalar: 1.3 });

  await sleep(800);

  // ── Burst 6: Lingering shower — top center ────────────────────────────────
  fire({ particleCount: 90, spread: 80, origin: { x: 0.5, y: 0.03 },
    colors: [...GOLD, ...WHITE, ...BLUSH], startVelocity: 14,
    gravity: 0.55, ticks: 500, scalar: 1.1, drift: 0.1 });

  // Wait for all particles to fully settle before removing the canvas
  await sleep(3000);
  canvas.remove();

  console.log('[confetti] Confetti finished');
}
