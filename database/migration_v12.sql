-- Phase 3D: Add created_by to users table for admin-scoped user isolation.
-- Super Admin sees all users; Admin sees only users they created.
-- Idempotent (information_schema guard + PREPARE/EXECUTE).

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'users'
    AND COLUMN_NAME  = 'created_by'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE users ADD COLUMN created_by INT NULL DEFAULT NULL AFTER access_type',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
