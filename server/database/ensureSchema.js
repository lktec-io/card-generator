'use strict';

/**
 * Schema guard — runs on every API start, against the SAME connection the app uses.
 *
 * Why this exists: schema changes used to depend on someone remembering to run a .sql
 * file by hand, against the right database, on the right server. When that was missed the
 * API booted happily and only failed later at the feature (e.g. saving a thank-you
 * message returned 400 "no column events.thank_you_template"). Now the API brings its own
 * schema up to date at boot, so code and database cannot drift apart.
 *
 * Rules:
 *   - add-only: it adds missing columns/indexes, never drops, renames or retypes anything
 *   - idempotent: existing columns are left exactly as they are, so it is safe on every restart
 *   - non-fatal: if it cannot run, the API still starts and the problem is logged loudly
 */

const pool = require('../config/db');

// Everything the current application code expects. Keep this list in step with the
// migration files in this folder — each entry names the file it corresponds to.
const REQUIRED_COLUMNS = [
  {
    table: 'events', column: 'sms_template',
    ddl: 'ALTER TABLE events ADD COLUMN sms_template TEXT NULL',
    migration: 'migration_sms.sql', purpose: 'per-event invitation SMS wording',
  },
  {
    table: 'events', column: 'thank_you_template',
    ddl: 'ALTER TABLE events ADD COLUMN thank_you_template TEXT NULL AFTER sms_template',
    migration: 'migration_thank_you_template.sql', purpose: 'saved post-event thank-you message',
  },
  {
    table: 'invitations', column: 'card_type',
    ddl: "ALTER TABLE invitations ADD COLUMN card_type ENUM('single','double') NOT NULL DEFAULT 'single' AFTER guest_name",
    migration: 'migration_card_type.sql', purpose: 'Single/Double invitations and analytics',
  },
  {
    table: 'verification_logs', column: 'verified_by_user_id',
    ddl: 'ALTER TABLE verification_logs ADD COLUMN verified_by_user_id INT NULL AFTER verified_by',
    migration: 'migration_verifier_history.sql', purpose: 'per-verifier scan history',
  },
  {
    table: 'sms_logs', column: 'sms_kind',
    ddl: "ALTER TABLE sms_logs ADD COLUMN sms_kind ENUM('invitation','thank_you') NOT NULL DEFAULT 'invitation' AFTER provider",
    migration: 'migration_thank_you_sms.sql', purpose: 'tells thank-you messages apart in sms_logs',
  },
];

const REQUIRED_INDEXES = [
  { table: 'verification_logs', index: 'idx_vl_verifier_time',
    ddl: 'CREATE INDEX idx_vl_verifier_time ON verification_logs (verified_by_user_id, verified_at)' },
  { table: 'sms_logs', index: 'idx_sms_event_kind',
    ddl: 'CREATE INDEX idx_sms_event_kind ON sms_logs (event_id, sms_kind, status)' },
];

// Errors that mean "already there" — harmless if two instances start at once
const ALREADY_PRESENT = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME']);

async function currentDatabase() {
  const [[row]] = await pool.execute('SELECT DATABASE() AS db');
  return row?.db || null;
}

async function tableExists(table) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return Number(row.n) > 0;
}

async function columnExists(table, column) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(row.n) > 0;
}

async function indexExists(table, index) {
  const [[row]] = await pool.execute(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return Number(row.n) > 0;
}

/**
 * @param {{ verbose?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, database: string|null, added: string[], present: string[],
 *                     missingTables: string[], failed: {target: string, reason: string}[], error?: string }>}
 */
async function ensureSchema({ verbose = true } = {}) {
  const result = { ok: false, database: null, added: [], present: [], missingTables: [], failed: [] };
  const log = (...a) => { if (verbose) console.log(...a); };

  try {
    result.database = await currentDatabase();
  } catch (err) {
    result.error = err.message;
    console.error(`[schema] cannot reach the database — the API will start, but schema-dependent features may fail: ${err.message}`);
    return result;
  }

  log(`[schema] checking database "${result.database}"`);

  for (const { table, column, ddl, migration, purpose } of REQUIRED_COLUMNS) {
    try {
      if (!(await tableExists(table))) {
        if (!result.missingTables.includes(table)) result.missingTables.push(table);
        console.error(`[schema] table "${table}" does not exist in "${result.database}" — run server/database/schema.sql first`);
        continue;
      }
      if (await columnExists(table, column)) { result.present.push(`${table}.${column}`); continue; }

      await pool.execute(ddl);
      result.added.push(`${table}.${column}`);
      console.log(`[schema] added ${table}.${column} (${purpose}) — equivalent to ${migration}`);
    } catch (err) {
      if (ALREADY_PRESENT.has(err.code)) { result.present.push(`${table}.${column}`); continue; }
      result.failed.push({ target: `${table}.${column}`, reason: err.message });
      console.error(`[schema] could not add ${table}.${column}: ${err.message}`);
    }
  }

  for (const { table, index, ddl } of REQUIRED_INDEXES) {
    try {
      if (!(await tableExists(table)) || await indexExists(table, index)) continue;
      await pool.execute(ddl);
      result.added.push(`${table}.${index}`);
      console.log(`[schema] added index ${index} on ${table}`);
    } catch (err) {
      if (ALREADY_PRESENT.has(err.code)) continue;
      result.failed.push({ target: `${table}.${index}`, reason: err.message });
      console.error(`[schema] could not add index ${index}: ${err.message}`);
    }
  }

  result.ok = result.failed.length === 0 && result.missingTables.length === 0;
  if (result.added.length === 0 && result.ok) {
    log(`[schema] up to date — all ${result.present.length} expected columns present`);
  } else if (result.added.length) {
    console.log(`[schema] applied ${result.added.length} change(s): ${result.added.join(', ')}`);
  }
  return result;
}

module.exports = { ensureSchema, REQUIRED_COLUMNS, REQUIRED_INDEXES };

// Also runnable on its own:  node server/database/ensureSchema.js
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  ensureSchema()
    .then((r) => {
      if (r.error) { console.error('\nSchema check failed to run.'); process.exit(2); }
      console.log(`\ndatabase: ${r.database}`);
      console.log(`present:  ${r.present.join(', ') || 'none'}`);
      console.log(`added:    ${r.added.join(', ') || 'none'}`);
      if (r.missingTables.length) console.log(`missing tables: ${r.missingTables.join(', ')}`);
      if (r.failed.length) console.log(`failed:   ${r.failed.map((f) => `${f.target} (${f.reason})`).join(', ')}`);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((err) => { console.error(err); process.exit(2); });
}
