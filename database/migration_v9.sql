-- ── Migration v9: User Management & RBAC ──────────────────────────────────
-- Safe to run multiple times (IF NOT EXISTS / IF NOT COLUMN guards).
-- All existing rows default to NULL for new columns — zero data impact.

-- ── Users table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  email      VARCHAR(200) NOT NULL,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin','event_manager','verifier') NOT NULL DEFAULT 'verifier',
  status     ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Event ownership columns ─────────────────────────────────────────────────
-- Add only if the columns don't exist yet (prevents re-run errors).

SET @col_created := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'created_by'
);
SET @col_assigned := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events' AND COLUMN_NAME = 'assigned_to'
);

-- Add created_by if missing
SET @sql1 := IF(@col_created = 0,
  'ALTER TABLE events ADD COLUMN created_by INT UNSIGNED NULL DEFAULT NULL AFTER event_mode',
  'SELECT 1'
);
PREPARE s1 FROM @sql1; EXECUTE s1; DEALLOCATE PREPARE s1;

-- Add assigned_to if missing
SET @sql2 := IF(@col_assigned = 0,
  'ALTER TABLE events ADD COLUMN assigned_to INT UNSIGNED NULL DEFAULT NULL AFTER created_by',
  'SELECT 1'
);
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- ── Foreign key constraints ─────────────────────────────────────────────────
-- Drop existing FKs first (idempotent), then recreate.

SET @fk1 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
  AND CONSTRAINT_NAME = 'fk_events_created_by'
);
SET @sql3 := IF(@fk1 = 0,
  'ALTER TABLE events ADD CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

SET @fk2 := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'events'
  AND CONSTRAINT_NAME = 'fk_events_assigned_to'
);
SET @sql4 := IF(@fk2 = 0,
  'ALTER TABLE events ADD CONSTRAINT fk_events_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE s4 FROM @sql4; EXECUTE s4; DEALLOCATE PREPARE s4;
