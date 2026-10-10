const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('async_hooks');

const baseConfig = {
  host:             process.env.DB_HOST || '127.0.0.1',
  user:             process.env.DB_USER || 'root',
  password:         process.env.DB_PASS || '',
  database:         process.env.DB_NAME || 'card',
  waitForConnections: true,
  queueLimit:       0,
  charset:          'utf8mb4',
};

// Main pool: settings unchanged.
const pool = mysql.createPool({ ...baseConfig, connectionLimit: 10 });

// Gate check-in gets its own few connections, so QR/CN verification can never
// queue behind dashboards, guest lists or message campaigns holding the main
// pool. mysql2 opens these lazily — idle cost is zero. Total per process: 10 + 3.
const VERIFY_POOL_SIZE = Math.max(1, Math.min(10, Number(process.env.DB_VERIFY_POOL_SIZE) || 3));
const verifyPool = mysql.createPool({ ...baseConfig, connectionLimit: VERIFY_POOL_SIZE });

/**
 * Per-request context (set by middleware/requestTiming). Lets the pool bound
 * connection waits for HTTP requests only, and attribute DB time to a request.
 */
const requestContext = new AsyncLocalStorage();

// How long an HTTP request may wait for a free connection before answering 503.
// Well inside the browser's 30 s, so the user sees a real "busy" message instead
// of a spinner. Background jobs (no live request) keep the old unbounded wait.
const REQUEST_ACQUIRE_TIMEOUT_MS = Number(process.env.DB_ACQUIRE_TIMEOUT_MS) > 0
  ? Number(process.env.DB_ACQUIRE_TIMEOUT_MS) : 10000;

/**
 * Raised when no connection became free in time. Carries no database detail,
 * so it is safe to turn straight into an HTTP response.
 */
class DatabaseBusyError extends Error {
  constructor(waitedMs) {
    super('The server is busy right now. Please try again in a moment.');
    this.name = 'DatabaseBusyError';
    this.code = 'DB_BUSY';
    this.status = 503;
    this.waitedMs = waitedMs;
  }
}

/**
 * Wait for `acquiring` at most `ms`. A connection that arrives after the
 * deadline is released straight back, never leaked.
 */
async function raceAcquire(acquiring, ms, started = Date.now()) {
  let gaveUp = false;
  let timer;
  acquiring.then((c) => { if (gaveUp) c.release(); }, () => {});
  try {
    return await Promise.race([
      acquiring,
      new Promise((_, reject) => {
        timer = setTimeout(() => { gaveUp = true; reject(new DatabaseBusyError(Date.now() - started)); }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `fn` with one pooled connection, waiting at most `acquireTimeoutMs` for it.
 *
 * Why this exists: the pool queues without limit (queueLimit: 0) and has no
 * acquisition timeout of its own. When every connection is busy, a request simply
 * waits — measured locally, a 12 ms WhatsApp-logs request sat queued until the
 * browser's 30 s timeout fired, and was STILL queued server-side afterwards.
 *
 * Using one connection for several statements (instead of a fresh acquisition
 * per statement) also means a request queues at most once.
 *
 * @template T
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<T>} fn
 * @param {{ acquireTimeoutMs?: number }} [opts]
 * @returns {Promise<T>}
 */
function makeHelpers(target) {
  async function withConnection(fn, { acquireTimeoutMs = 8000 } = {}) {
    const conn = await raceAcquire(target.getConnection(), acquireTimeoutMs);
    try {
      return await fn(conn);
    } finally {
      conn.release();
    }
  }

  /** Live pool occupancy, for diagnostics. Numbers only — nothing sensitive. */
  function poolStats() {
    const p = target.pool;
    return {
      limit:  p?.config?.connectionLimit ?? null,
      open:   p?._allConnections?.length ?? null,
      free:   p?._freeConnections?.length ?? null,
      queued: p?._connectionQueue?.length ?? null,
    };
  }

  return { withConnection, poolStats };
}

/** The live request's context, or null once that request has been answered. */
function liveContext() {
  const ctx = requestContext.getStore();
  return ctx && !ctx.ended ? ctx : null;
}

/** Attribute statement time on this connection to the current request. */
function timeStatements(conn) {
  for (const m of ['execute', 'query']) {
    const orig = conn[m];
    if (typeof orig !== 'function') continue;
    conn[m] = async function (...args) {
      const ctx = liveContext();
      const t = Date.now();
      try {
        return await orig.apply(conn, args);
      } finally {
        if (ctx) { ctx.db_query_ms += Date.now() - t; ctx.db_queries++; }
      }
    };
  }
  return conn;
}

/**
 * Give a mysql2 promise pool: bounded waits inside HTTP requests, per-request
 * DB timing, and the helpers. execute()/query() keep their exact semantics —
 * mysql2 itself implements them as acquire → statement → release.
 */
function instrument(p) {
  const rawGet = p.getConnection.bind(p);

  const timedGet = async (bound) => {
    const ctx = liveContext();
    const t = Date.now();
    const acquiring = rawGet();
    let conn;
    try {
      conn = ctx && bound ? await raceAcquire(acquiring, ctx.acquireTimeoutMs || REQUEST_ACQUIRE_TIMEOUT_MS, t) : await acquiring;
    } finally {
      // recorded on failure too — a timed-out wait is the case that matters most
      if (ctx) { ctx.db_wait_ms += Date.now() - t; ctx.db_acquires++; }
    }
    return timeStatements(conn);
  };

  // withConnection applies its own deadline, so it takes the unbounded path.
  Object.assign(p, makeHelpers({ getConnection: () => timedGet(false), pool: p.pool }));

  p.getConnection = () => timedGet(true);
  p.execute = async (...args) => {
    const conn = await p.getConnection();
    try { return await conn.execute(...args); } finally { conn.release(); }
  };
  p.query = async (...args) => {
    const conn = await p.getConnection();
    try { return await conn.query(...args); } finally { conn.release(); }
  };
  return p;
}

instrument(pool);
instrument(verifyPool);

// Everything rides on the pool object itself, so every existing
// `require('../config/db')` keeps receiving the pool exactly as before.
Object.assign(pool, { DatabaseBusyError, makeHelpers, instrument, requestContext, verifyPool, REQUEST_ACQUIRE_TIMEOUT_MS });

module.exports = pool;
