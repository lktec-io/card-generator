-- Wedding Invitation QR System – Database Schema
-- Run once: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS wedding_qr
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE wedding_qr;

CREATE TABLE IF NOT EXISTS invitations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(20)  UNIQUE NOT NULL,
  guest_name      VARCHAR(100) NOT NULL,
  language        ENUM('en','sw') DEFAULT 'en',
  status          ENUM('unused','used') DEFAULT 'unused',
  original_image_url TEXT,
  image_url       TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at         TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index for fast verification lookups
CREATE INDEX idx_code ON invitations(code);
CREATE INDEX idx_status ON invitations(status);
