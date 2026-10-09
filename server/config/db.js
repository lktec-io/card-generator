const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:             process.env.DB_HOST || '127.0.0.1',
  user:             process.env.DB_USER || 'root',
  password:         process.env.DB_PASS || '',
  database:         process.env.DB_NAME || 'card',
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
  charset:          'utf8mb4',
});

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
 * Run `fn` with one pooled connection, waiting at most `acquireTimeoutMs` for it.
 *
 * Why this exists: the pool above queues without limit (queueLimit: 0) and has
 * no acquisition timeout. When every connection is busy, a request simply waits
 * — measured locally, a 12 ms WhatsApp-logs request sat queued until the
 * browser's 30 s timeout fired, and was STILL queued server-side afterwards,
 * waiting to run a query for a client that had already gone.
 *
 * This helper bounds that wait so the caller gets a clear 503 in seconds, and a
 * connection that turns up after the deadline is handed straight back rather
 * than leaked. The pool's own settings are deliberately unchanged, so no other
 * endpoint behaves any differently; endpoints opt in.
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
    const started = Date.now();
    let gaveUp = false;
    let timer;

    const acquiring = target.getConnection();
    // If the deadline passes first, release the connection whenever it arrives.
    acquiring.then((c) => { if (gaveUp) c.release(); }, () => {});

    let conn;
    try {
      conn = await Promise.race([
        acquiring,
        new Promise((_, reject) => {
          timer = setTimeout(() => { gaveUp = true; reject(new DatabaseBusyError(Date.now() - started)); }, acquireTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }

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

// The helpers ride on the pool object itself, so every existing
// `require('../config/db')` keeps receiving the pool exactly as before.
Object.assign(pool, makeHelpers(pool), { DatabaseBusyError, makeHelpers });

module.exports = pool;
