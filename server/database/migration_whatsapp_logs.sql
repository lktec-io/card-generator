-- WhatsApp message log.
--
-- Deliberately a separate table from sms_logs: WhatsApp has a different
-- provider, an approved-template model and a delivery lifecycle (accepted →
-- delivered → read) that SMS does not have. Mixing them would mean nullable
-- columns on both sides and statuses that mean different things per row.
--
-- Add-only and idempotent: safe to run on a live database, and the API applies
-- the same thing itself at boot via database/ensureSchema.js.

CREATE TABLE IF NOT EXISTS whatsapp_logs (
  id                  INT AUTO_INCREMENT PRIMARY KEY,

  event_id            INT NULL,
  invitation_id       INT NULL,

  -- Captured at send time so a log row still reads correctly after a guest is
  -- renamed or an invitation is deleted.
  guest_name          VARCHAR(100) NULL,
  phone_number        VARCHAR(32)  NOT NULL,

  template_id         VARCHAR(190) NULL,
  template_name       VARCHAR(190) NULL,
  template_language   VARCHAR(16)  NULL,

  -- Our own correlation id, echoed back by the provider on delivery callbacks.
  message_reference   VARCHAR(64)  NULL,
  beem_job_id         VARCHAR(190) NULL,
  provider_message_id VARCHAR(190) NULL,
  provider            VARCHAR(40)  NOT NULL DEFAULT 'beem_whatsapp',

  -- The rendered parameters, kept for support ("what exactly did we send?").
  message             TEXT NULL,
  media_url           TEXT NULL,

  status              ENUM('pending','sending','accepted','sent','delivered','read','failed')
                        NOT NULL DEFAULT 'pending',
  -- Exactly what the provider called it, before mapping. Invaluable when a new
  -- status appears that we do not yet recognise.
  provider_status     VARCHAR(40) NULL,
  error_message       TEXT NULL,

  sent_at             TIMESTAMP NULL DEFAULT NULL,
  accepted_at         TIMESTAMP NULL DEFAULT NULL,
  delivered_at        TIMESTAMP NULL DEFAULT NULL,
  read_at             TIMESTAMP NULL DEFAULT NULL,
  failed_at           TIMESTAMP NULL DEFAULT NULL,

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event isolation and the logs screen's default ordering.
CREATE INDEX idx_wa_event_created  ON whatsapp_logs (event_id, created_at);
-- Campaign summary counts per event.
CREATE INDEX idx_wa_event_status   ON whatsapp_logs (event_id, status);
-- Delivery callbacks correlate on these.
CREATE INDEX idx_wa_job            ON whatsapp_logs (beem_job_id);
CREATE INDEX idx_wa_reference      ON whatsapp_logs (message_reference);
CREATE INDEX idx_wa_provider_msg   ON whatsapp_logs (provider_message_id);
-- Duplicate protection: "has this invitation already been sent successfully?"
CREATE INDEX idx_wa_invitation     ON whatsapp_logs (invitation_id, status);
