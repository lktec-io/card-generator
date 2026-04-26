/**
 * Web Audio API sound effects — no external files needed.
 * AudioContext must be created after user interaction (camera grant = interaction).
 */

function createCtx() {
  return new (window.AudioContext || window.webkitAudioContext)();
}

export function playSuccess() {
  try {
    const ctx  = createCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.1);

    // Soft chime: C5 → E5 → G5
    [[523.25, 0], [659.25, 0.12], [783.99, 0.24]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      osc.connect(gain);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.7);
    });
  } catch (_) { /* silently fail in restricted contexts */ }
}

export function playError() {
  try {
    const ctx  = createCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.3);
    osc.connect(gain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (_) { /* silently fail */ }
}
