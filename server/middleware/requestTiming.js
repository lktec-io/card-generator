'use strict';

/**
 * Structured request timing — one JSON line per slow or failed request:
 *
 *   {"evt":"slow_request","rid":"…","method":"GET","route":"/events/:id",
 *    "status":200,"ms":2412,"db_wait_ms":3,"db_query_ms":41,"db_queries":5,
 *    "loop_max_ms":1810,"pool":{…},"verify_pool":{…}}
 *
 * Reading it: ms ≫ db_wait_ms + db_query_ms means the time went to the Node
 * process itself (event loop blocked — loop_max_ms says by how much); a large
 * db_wait_ms means the pool was saturated; a large db_query_ms means SQL.
 *
 * Privacy: only the route PATTERN is logged (never the URL, so no query string —
 * webhook URLs carry ?secret= — and no codes or phone numbers), no bodies, no
 * headers, no user identity. The request id is echoed as X-Request-Id so a
 * browser report can be matched to its log line.
 *
 * Env: REQUEST_LOG_SLOW_MS (default 1000), REQUEST_LOG_ALL=1 logs every request.
 */

const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');
const pool = require('../config/db');

const SLOW_MS = Number(process.env.REQUEST_LOG_SLOW_MS) > 0 ? Number(process.env.REQUEST_LOG_SLOW_MS) : 1000;
const LOG_ALL = process.env.REQUEST_LOG_ALL === '1';
const HEALTH_EVERY_MS = 60000;

// Event-loop delay, reset each health interval: loop_max_ms is the worst stall
// in the last minute or less.
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

const stats = (p) => (typeof p?.poolStats === 'function' ? p.poolStats() : null);

setInterval(() => {
  const maxMs = loop.max / 1e6;
  const main = stats(pool);
  const verify = stats(pool.verifyPool);
  // Only when something is worth looking at — a quiet server logs nothing.
  if (maxMs >= 200 || (main && main.queued > 0) || (verify && verify.queued > 0)) {
    console.log(JSON.stringify({
      evt: 'health',
      loop_p99_ms: Math.round(loop.percentile(99) / 1e6),
      loop_max_ms: Math.round(maxMs),
      pool: main,
      verify_pool: verify,
      rss_mb: Math.round(process.memoryUsage().rss / 1048576),
    }));
  }
  loop.reset();
}, HEALTH_EVERY_MS).unref();

const RID_OK = /^[A-Za-z0-9._-]{8,64}$/;

function requestTiming(req, res, next) {
  const incoming = req.get('x-request-id');
  const rid = incoming && RID_OK.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', rid);

  const ctx = { rid, db_wait_ms: 0, db_query_ms: 0, db_queries: 0, db_acquires: 0, ended: false };
  const t0 = process.hrtime.bigint();

  let done = false;
  const finish = (aborted) => {
    if (done) return;
    done = true;
    ctx.ended = true;           // work that outlives the response is no longer this request's
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const status = aborted && !res.writableEnded ? 499 : res.statusCode;
    if (!LOG_ALL && ms < SLOW_MS && status < 500) return;
    console.log(JSON.stringify({
      evt: ms >= SLOW_MS ? 'slow_request' : 'request',
      rid,
      method: req.method,
      route: req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched',
      status,
      ms: Math.round(ms),
      db_wait_ms: ctx.db_wait_ms,
      db_query_ms: ctx.db_query_ms,
      db_queries: ctx.db_queries,
      loop_max_ms: Math.round(loop.max / 1e6),
      pool: stats(pool),
      verify_pool: stats(pool.verifyPool),
    }));
  };
  res.on('finish', () => finish(false));
  res.on('close', () => finish(true));

  pool.requestContext.run(ctx, next);
}

module.exports = requestTiming;
