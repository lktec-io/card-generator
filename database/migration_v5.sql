-- ============================================================
-- Nardio Events — Migration v5
-- Adds: voice_message_url to RSVP responses
-- Safe: no DROP, no data loss
-- ============================================================

ALTER TABLE rsvp_responses
  ADD COLUMN IF NOT EXISTS voice_message_url VARCHAR(500) NULL DEFAULT NULL;
