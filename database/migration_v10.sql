-- Phase 3B: super_admin role, access_type per user, card text colours per event.
-- All DDL changes are idempotent (information_schema guard + PREPARE/EXECUTE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend users.role ENUM to include 'super_admin'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE users
  MODIFY COLUMN role
  ENUM('admin','event_manager','verifier','super_admin') NOT NULL DEFAULT 'verifier';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add access_type to users (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'users'
    AND COLUMN_NAME  = 'access_type'
);
SET @sql := IF(@col = 0,
  "ALTER TABLE users ADD COLUMN access_type ENUM('invitation','contribution','both') NOT NULL DEFAULT 'both' AFTER role",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add name_color to events (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND COLUMN_NAME  = 'name_color'
);
SET @sql := IF(@col = 0,
  "ALTER TABLE events ADD COLUMN name_color VARCHAR(7) NOT NULL DEFAULT '#111111' AFTER contact_phone",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Add cn_color to events (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND COLUMN_NAME  = 'cn_color'
);
SET @sql := IF(@col = 0,
  "ALTER TABLE events ADD COLUMN cn_color VARCHAR(7) NOT NULL DEFAULT '#222222' AFTER name_color",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add amount_color to events (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND COLUMN_NAME  = 'amount_color'
);
SET @sql := IF(@col = 0,
  "ALTER TABLE events ADD COLUMN amount_color VARCHAR(7) NOT NULL DEFAULT '#222222' AFTER cn_color",
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Promote the original bootstrap admin to super_admin
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE users SET role = 'super_admin' WHERE role = 'admin' ORDER BY id ASC LIMIT 1;
