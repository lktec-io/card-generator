-- ============================================================
-- Nardio Events — Migration v3 (UUID-based Public Links)
-- Run once on top of migration_v2.sql
-- ============================================================

-- 1. Add invitation_uuid column
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS invitation_uuid VARCHAR(100) UNIQUE DEFAULT NULL;

-- 2. Indexes for performance
CREATE INDEX idx_inv_uuid    ON invitations(invitation_uuid);
CREATE INDEX idx_inv_event   ON invitations(event_id);
CREATE INDEX idx_rsvp_inv    ON rsvp_responses(invitation_id);
CREATE INDEX idx_rsvp_event  ON rsvp_responses(event_id);
CREATE INDEX idx_vlog_inv    ON verification_logs(invitation_id);

-- 3. Backfill UUIDs for existing rows (MySQL 8.0+ UUID() function)
UPDATE invitations SET invitation_uuid = UUID() WHERE invitation_uuid IS NULL;
