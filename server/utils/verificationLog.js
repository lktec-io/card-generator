// Writes a row to the existing verification_logs table and records which logged-in user
// performed the check-in (verified_by_user_id, added by migration_verifier_history.sql).
//
// Safe before the migration runs: if the column doesn't exist yet, it falls back to the
// original INSERT, so check-in logging keeps working exactly as before.

const pool = require('../config/db');

let columnExists = null;       // null = not checked yet
let checkedAt    = 0;
const RECHECK_MS = 60_000;     // while missing, look again at most once a minute

async function hasVerifierColumn() {
  if (columnExists === true) return true;
  if (columnExists === false && Date.now() - checkedAt < RECHECK_MS) return false;
  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'verification_logs'
          AND COLUMN_NAME  = 'verified_by_user_id'`
    );
    columnExists = Number(row.n) > 0;
  } catch {
    columnExists = false;
  }
  checkedAt = Date.now();
  return columnExists;
}

// The verifier's identity comes ONLY from the authenticated user set by the auth middleware
function authenticatedUserId(user) {
  const id = Number(user?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function logVerification(connection, { eventId, invitationId, method, user }) {
  const userId = authenticatedUserId(user);

  if (columnExists !== false) {
    try {
      await connection.execute(
        `INSERT INTO verification_logs
           (event_id, invitation_id, verification_method, verified_by, verified_by_user_id)
         VALUES (?, ?, ?, 'Staff', ?)`,
        [eventId || null, invitationId, method, userId]
      );
      columnExists = true;
      return;
    } catch (err) {
      if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
      columnExists = false;      // migration not run yet
      checkedAt = Date.now();
    }
  }

  // Original INSERT, unchanged
  await connection.execute(
    `INSERT INTO verification_logs (event_id, invitation_id, verification_method, verified_by)
     VALUES (?, ?, ?, 'Staff')`,
    [eventId || null, invitationId, method]
  );
}

module.exports = { logVerification, hasVerifierColumn, authenticatedUserId };
