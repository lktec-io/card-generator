-- ============================================================
-- Nardio Events — Migration v8
-- Adds: Contribution Campaign Module (event_mode, requested_amount,
--       contribution templates with drag-and-drop layout_config)
-- Safe: no DROP, no data loss, backward compatible
-- Existing rows default to 'invitation' mode/type — zero impact.
-- ============================================================

-- 1. Distinguish Invitation Events from Contribution Campaigns
ALTER TABLE events
  ADD COLUMN event_mode ENUM('invitation','contribution') NOT NULL DEFAULT 'invitation' AFTER event_type;

-- 2. Per-guest requested contribution amount + share tracking
ALTER TABLE invitations
  ADD COLUMN requested_amount DECIMAL(15,2) DEFAULT NULL AFTER phone_number,
  ADD COLUMN shared_at TIMESTAMP NULL DEFAULT NULL;

-- 3. Contribution templates reuse the existing `templates` catalogue —
--    template_type distinguishes fixed React-component invitation templates
--    from uploaded-image, drag-and-drop contribution templates.
--    layout_config stores element positions in 1080px-canvas pixel space:
--      { "guestName": {"x":90,"y":700,"visible":true},
--        "cn":        {"x":90,"y":800,"visible":true},
--        "amount":    {"x":90,"y":870,"visible":true},
--        "qr":        {"x":800,"y":700,"visible":false} }
ALTER TABLE templates
  ADD COLUMN template_type ENUM('invitation','contribution') NOT NULL DEFAULT 'invitation' AFTER category,
  ADD COLUMN layout_config JSON DEFAULT NULL;
