const pool = require('../config/db');

// users.can_view_sms_balance is added by ensureSchema at start-up. Until it is
// confirmed present, every query here treats it as absent (nobody granted)
// instead of failing — so user management keeps working on an older schema.
let columnPresent = false;
let lastCheck     = 0;

async function hasPermissionColumn() {
  if (columnPresent) return true;
  if (Date.now() - lastCheck < 30_000) return false;
  lastCheck = Date.now();
  try {
    const [[row]] = await pool.execute(
      `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'can_view_sms_balance'`
    );
    columnPresent = Number(row.n) > 0;
  } catch {
    columnPresent = false;
  }
  return columnPresent;
}

// Read on every balance request, so a grant or revoke applies without re-login.
async function isGrantedInDb(userId) {
  if (!userId || !(await hasPermissionColumn())) return false;
  const [[row]] = await pool.execute(
    "SELECT can_view_sms_balance FROM users WHERE id = ? AND status = 'active'",
    [userId]
  );
  return !!row && Number(row.can_view_sms_balance) === 1;
}

module.exports = { hasPermissionColumn, isGrantedInDb };
