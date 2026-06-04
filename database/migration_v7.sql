-- ============================================================
-- Nardio Events — Migration v7
-- Adds: templates table + template_id in events
-- Safe: no DROP, no data loss, backward compatible
-- ============================================================

-- 1. Templates catalogue
CREATE TABLE IF NOT EXISTS templates (
  id               INT          AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  slug             VARCHAR(100) NOT NULL UNIQUE,
  category         VARCHAR(50)  NOT NULL DEFAULT 'General',
  description      TEXT         DEFAULT NULL,
  thumbnail_url    VARCHAR(500) DEFAULT NULL,
  background_image VARCHAR(500) DEFAULT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  is_premium       TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order       INT          NOT NULL DEFAULT 0,
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Link events → template (nullable — existing events keep working)
ALTER TABLE events
  ADD COLUMN template_id INT DEFAULT NULL,
  ADD CONSTRAINT fk_event_template
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL;

-- 3. Seed initial templates
INSERT IGNORE INTO templates (name, slug, category, description, is_active, sort_order) VALUES
  ('Wedding Gold',        'wedding-gold',        'Wedding',        'Elegant dark-gold wedding invitation with serif accents',       1, 10),
  ('Graduation Premium',  'graduation-premium',  'Graduation',     'Professional navy-and-gold academic graduation invitation',      1, 20),
  ('Birthday Modern',     'birthday-modern',     'Birthday',       'Vibrant purple birthday celebration with modern typography',     1, 30),
  ('Sendoff Journey',     'sendoff-journey',     'Sendoff',        'Warm amber sendoff invitation with travel accents',             1, 40),
  ('Conference Pro',      'conference-pro',      'Conference',     'Clean minimal corporate conference invitation',                  1, 50),
  ('Church Elegant',      'church-elegant',      'Church Event',   'Graceful cream-and-gold church event invitation',               1, 60),
  ('Kitchen Party',       'kitchen-party',       'Kitchen Party',  'Playful warm kitchen party invitation',                         1, 70),
  ('Corporate Event',     'corporate-event',     'Corporate Event','Modern dark corporate event invitation',                        1, 80);
