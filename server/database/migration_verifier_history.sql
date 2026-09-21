-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: record which logged-in user performed each check-in
--  Adds one nullable column + index to the EXISTING verification_logs table.
--  Safe to re-run. Existing rows keep NULL (check-ins made before this change).
-- ═══════════════════════════════════════════════════════════════════════════

USE card;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'verification_logs'
     AND COLUMN_NAME  = 'verified_by_user_id'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE verification_logs ADD COLUMN verified_by_user_id INT NULL AFTER verified_by',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'verification_logs'
     AND INDEX_NAME   = 'idx_vl_verifier_time'
);

SET @sql = IF(
  @idx_exists = 0,
  'CREATE INDEX idx_vl_verifier_time ON verification_logs (verified_by_user_id, verified_at)',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
