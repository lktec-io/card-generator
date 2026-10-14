-- ---------------------------------------------------------------------------
-- issued_codes — every invitation code (CN-…) ever handed out.
--
-- Add-only. Applied automatically at API start by database/ensureSchema.js;
-- this file is the same change for running by hand. Safe to run more than once.
--
-- Why: codes are now random (CN-2895) instead of sequential. Recording each one
-- here means a code is never issued again, even after its invitation is deleted.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS issued_codes (
  code      VARCHAR(20) NOT NULL PRIMARY KEY,
  issued_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every code already on an invitation counts as issued.
INSERT IGNORE INTO issued_codes (code)
  SELECT code FROM invitations WHERE code IS NOT NULL;
