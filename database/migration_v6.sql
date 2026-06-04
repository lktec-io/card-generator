-- ============================================================
-- Nardio Events — Migration v6
-- Adds: voice_messages table (standalone, not tied to RSVP)
-- Safe: no DROP, no data loss
-- ============================================================

CREATE TABLE IF NOT EXISTS voice_messages (
  id                INT          AUTO_INCREMENT PRIMARY KEY,
  event_id          INT          DEFAULT NULL,
  invitation_id     INT          NOT NULL,
  guest_name        VARCHAR(150) NOT NULL,
  invitation_code   VARCHAR(30)  NOT NULL,
  voice_message_url VARCHAR(500) NOT NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_vm_event      (event_id),
  INDEX idx_vm_invitation (invitation_id),
  FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE SET NULL,
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
