-- ============================================================
-- SMS Module Migration
-- Run once on production:
--   mysql -u root -p card < server/database/migration_sms.sql
-- ============================================================

USE card;

-- 1. Add sms_template column to events (idempotent)
SET @col_exists = (
  SELECT COUNT(*)
  FROM   information_schema.COLUMNS
  WHERE  TABLE_SCHEMA = DATABASE()
  AND    TABLE_NAME   = 'events'
  AND    COLUMN_NAME  = 'sms_template'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE events ADD COLUMN sms_template TEXT NULL AFTER layout_config',
  'SELECT 1 -- sms_template already exists'
);
PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

-- 2. Create sms_logs table
CREATE TABLE IF NOT EXISTS sms_logs (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  event_id            INT          NULL,
  invitation_id       INT          NULL,
  phone_number        VARCHAR(30)  NOT NULL,
  provider            VARCHAR(50)  NOT NULL DEFAULT 'beem',
  message             TEXT         NOT NULL,
  status              ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  provider_message_id VARCHAR(100) NULL,
  error_message       TEXT         NULL,
  sent_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_sms_event_id  (event_id),
  INDEX idx_sms_inv_id    (invitation_id),
  INDEX idx_sms_status    (status),
  INDEX idx_sms_sent_at   (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
