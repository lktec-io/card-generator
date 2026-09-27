-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: mark which sms_logs rows are post-event thank-you messages
--  One column on the EXISTING sms_logs table — no new table, no new SMS system.
--  Safe to re-run. Existing rows become 'invitation', which is what they are.
-- ═══════════════════════════════════════════════════════════════════════════

USE card;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sms_logs'
     AND COLUMN_NAME  = 'sms_kind'
);

SET @sql = IF(
  @col_exists = 0,
  "ALTER TABLE sms_logs ADD COLUMN sms_kind ENUM('invitation','thank_you') NOT NULL DEFAULT 'invitation' AFTER provider",
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sms_logs'
     AND INDEX_NAME   = 'idx_sms_event_kind'
);

SET @sql = IF(
  @idx_exists = 0,
  'CREATE INDEX idx_sms_event_kind ON sms_logs (event_id, sms_kind, status)',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
