-- ============================================================
-- Nardio Events — Migration v4
-- Adds: phone numbers, event time, contact person, accent color
-- Safe: no DROP, no data loss
-- ============================================================

-- 1. Invitations — phone number
ALTER TABLE invitations
  ADD COLUMN phone_number VARCHAR(30) NULL DEFAULT NULL;

-- 2. Events — time + contact person + accent color
ALTER TABLE events
  ADD COLUMN event_time     VARCHAR(50)  NULL DEFAULT NULL,
  ADD COLUMN contact_name  VARCHAR(150) NULL DEFAULT NULL,
  ADD COLUMN contact_phone VARCHAR(50)  NULL DEFAULT NULL,
  ADD COLUMN dress_code_accent VARCHAR(100) NULL DEFAULT NULL;
