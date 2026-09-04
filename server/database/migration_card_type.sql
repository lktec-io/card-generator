-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: add Single / Double card type to invitations
--  Safe to re-run — the column is only added when it does not already exist.
--  Existing rows default to 'single', so nothing breaks.
-- ═══════════════════════════════════════════════════════════════════════════

USE card;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'invitations'
     AND COLUMN_NAME  = 'card_type'
);

SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE invitations ADD COLUMN card_type ENUM('single','double') NOT NULL DEFAULT 'single' AFTER guest_name",
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
