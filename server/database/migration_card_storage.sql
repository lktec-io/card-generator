-- ═══════════════════════════════════════════════════════════════════════════
--  Migration: keep the old Cloudinary card URL when a card moves to VPS storage
--
--  invitations.image_url        → becomes /uploads/cards/<event>/<id>.png
--  invitations.cloudinary_url   → keeps the previous https://res.cloudinary.com/... URL
--
--  Rollback is then a single UPDATE (see deploy/CARD-STORAGE-MIGRATION.md).
--  Add-only, idempotent, no data is read or rewritten. Existing rows stay NULL,
--  which simply means "never migrated".
--
--  Run against the SAME database the API uses (server/.env DB_NAME), e.g.
--    mysql -u <DB_USER> -p <DB_NAME> < server/database/migration_card_storage.sql
--  The API also applies this automatically at startup (server/database/ensureSchema.js).
-- ═══════════════════════════════════════════════════════════════════════════

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'invitations'
     AND COLUMN_NAME  = 'cloudinary_url'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE invitations ADD COLUMN cloudinary_url TEXT NULL AFTER image_url',
  'SELECT 1'
);

PREPARE _stmt FROM @sql;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
