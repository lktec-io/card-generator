-- Phase 3C: description per event + layout_config for card element positions.
-- All DDL changes are idempotent (information_schema guard + PREPARE/EXECUTE).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add description to events (optional, used by contribution campaigns)
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND COLUMN_NAME  = 'description'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE events ADD COLUMN description TEXT NULL AFTER dress_code_notes',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add layout_config to events (JSON: persists drag-and-drop positions)
--    Stores: { nameY, codeY, qrLeft, qrTop, amountY }
--    All coordinates in the 1080-pixel canvas space.
-- ─────────────────────────────────────────────────────────────────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'events'
    AND COLUMN_NAME  = 'layout_config'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE events ADD COLUMN layout_config JSON NULL AFTER amount_color',
  'SELECT 1'
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
