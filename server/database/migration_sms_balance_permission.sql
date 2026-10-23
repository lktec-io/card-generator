-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: per-user "Can View SMS Balance" permission
--  One column on the EXISTING users table. Safe to re-run. Every existing user
--  starts without the permission (0); super_admin always has it regardless.
-- ═══════════════════════════════════════════════════════════════════════════

USE card;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND COLUMN_NAME  = 'can_view_sms_balance'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE users ADD COLUMN can_view_sms_balance TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
