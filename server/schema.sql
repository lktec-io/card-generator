-- Wedding Invitation QR System — Database Schema
-- Run: mysql -u root -p < server/schema.sql

CREATE DATABASE IF NOT EXISTS wedding_qr
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE wedding_qr;

CREATE TABLE IF NOT EXISTS invitations (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  code                 VARCHAR(20)  NOT NULL UNIQUE,
  guest_name           VARCHAR(255) NOT NULL,
  language             ENUM('english','swahili') DEFAULT 'english',
  status               ENUM('unused','used')     DEFAULT 'unused',
  image_url            TEXT,
  cloudinary_public_id VARCHAR(255),
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at              TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_code   (code),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
