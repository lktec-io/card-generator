-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: store each event's saved post-event thank-you message
--  One nullable column on the EXISTING events table, beside sms_template.
--  Safe to re-run. Existing rows stay NULL and fall back to the generated
--  default, so no event's wording changes when this runs.
-- ═══════════════════════════════════════════════════════════════════════════

-- Run it against the SAME database the API uses (server/.env DB_NAME), e.g.
--   mysql -u root -p YOUR_DB_NAME < server/database/migration_thank_you_template.sql
-- No USE statement here on purpose: the checks below run against whichever database
-- you connect to, so the column can never land in the wrong schema.

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'events'
     AND COLUMN_NAME  = 'thank_you_template'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE events ADD COLUMN thank_you_template TEXT NULL AFTER sms_template',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
