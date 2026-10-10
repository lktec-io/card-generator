'use strict';

/**
 * SVG → PNG rasterising (resvg), off the main thread.
 *
 * resvg's render() is synchronous and costs ~0.2 s per call (it also reloads the
 * system font database each time), and a card needs several calls. On the main
 * thread that froze the WHOLE API — QR/CN check-in included — for the length of
 * every card. Measured with a bulk generation running: event-loop stalls up to
 * 1.8 s, QR verification p95 3.0 s instead of 35 ms.
 *
 * The same file is both the worker and its client:
 *   - as a worker thread it renders whatever SVG it is sent;
 *   - required normally it exports rasterise(svg) → Promise<Buffer>.
 * Rendering options are defined once (renderSync), so the worker and the
 * in-process fallback produce identical PNGs.
 *
 * CARD_RASTER_WORKER=0 switches back to in-process rendering (old behaviour).
 */

const { Worker, isMainThread, parentPort } = require('worker_threads');

function renderSync(svgStr) {
  const { Resvg } = require('@resvg/resvg-js');
  return new Resvg(svgStr, {
    fitTo: { mode: 'original' },
    font:  { loadSystemFonts: true },
  }).render().asPng();
}

if (!isMainThread && parentPort) {
  // ── worker side ──
  parentPort.on('message', ({ id, svg }) => {
    try {
      const png = renderSync(svg);
      parentPort.postMessage({ id, png });
    } catch (err) {
      parentPort.postMessage({ id, error: err?.message || 'rasterise failed' });
    }
  });
} else {
  // ── client side ──
  const JOB_TIMEOUT_MS = 60000;   // one text layer; anything near this is a hung worker
  const enabled = process.env.CARD_RASTER_WORKER !== '0';

  let worker = null;
  let seq = 0;
  const pending = new Map();      // id → { resolve, reject, timer }

  const failAll = (err) => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  };

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(__filename);
    worker.on('message', ({ id, png, error }) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (!pending.size) worker?.unref();   // idle: never keep the process alive
      if (error) p.reject(new Error(error));
      else p.resolve(Buffer.from(png.buffer, png.byteOffset, png.byteLength));
    });
    worker.on('error', (err) => {
      console.error('[rasterWorker] worker error:', err.message);
      failAll(err);
      worker = null;                        // a fresh one is started on the next call
    });
    worker.on('exit', (code) => {
      if (pending.size) failAll(new Error(`raster worker exited (${code})`));
      worker = null;
    });
    worker.unref();
    return worker;
  }

  function rasterise(svgStr) {
    if (!enabled) return Promise.resolve(renderSync(svgStr));
    let w;
    try {
      w = getWorker();
    } catch (err) {
      // Could not start a thread at all: render in-process rather than fail the card.
      console.error('[rasterWorker] unavailable, rendering in-process:', err.message);
      return Promise.resolve(renderSync(svgStr));
    }
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Card text rendering timed out.'));
        w.terminate().catch(() => {});     // a stuck render must not block every later card
      }, JOB_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      w.ref();                              // keep alive while work is outstanding
      w.postMessage({ id, svg: svgStr });
    });
  }

  module.exports = { rasterise, renderSync };
}
