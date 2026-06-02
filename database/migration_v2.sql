-- ============================================================
-- Nardio Events Platform — Database Migration v2
-- Run once against your existing `card` database
-- ============================================================

-- ── 1. events ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                    INT          AUTO_INCREMENT PRIMARY KEY,
  event_name            VARCHAR(200) NOT NULL,
  event_type            ENUM(
    'Wedding','Kitchen Party','Birthday','Sendoff',
    'Graduation','Conference','Church Event','Corporate Event'
  ) NOT NULL DEFAULT 'Wedding',
  event_date            DATE         DEFAULT NULL,
  venue                 VARCHAR(300) DEFAULT NULL,
  dress_code_main       VARCHAR(100) DEFAULT NULL,
  dress_code_secondary  VARCHAR(100) DEFAULT NULL,
  dress_code_notes      TEXT         DEFAULT NULL,
  maps_link             VARCHAR(500) DEFAULT NULL,
  created_at            TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. Add event_id to invitations (nullable — backwards compat) ──
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS event_id INT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS original_image_url VARCHAR(500) DEFAULT NULL;

-- Add FK only if not already there (run separately if it errors)
ALTER TABLE invitations
  ADD CONSTRAINT fk_inv_event
    FOREIGN KEY (event_id) REFERENCES events(id)
    ON DELETE SET NULL;

-- ── 3. rsvp_responses ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS rsvp_responses (
  id             INT  AUTO_INCREMENT PRIMARY KEY,
  event_id       INT  DEFAULT NULL,
  invitation_id  INT  NOT NULL,
  response       ENUM('attending','declined','pending') NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE  KEY  uq_rsvp_inv (invitation_id),
  FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE SET NULL,
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. verification_logs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS verification_logs (
  id                    INT  AUTO_INCREMENT PRIMARY KEY,
  event_id              INT  DEFAULT NULL,
  invitation_id         INT  NOT NULL,
  verified_by           VARCHAR(100) DEFAULT 'Staff',
  verification_method   ENUM('QR','CN') NOT NULL,
  verified_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE SET NULL,
  FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
