-- Wedding Invitation QR System — Database Schema
-- Run: mysql -u root -p < server/schema.sql

CREATE DATABASE IF NOT EXISTS card
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE card;

CREATE TABLE IF NOT EXISTS invitations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20) UNIQUE,
  guest_name VARCHAR(100),
  status     ENUM('unused','used') DEFAULT 'unused',
  image_url  TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at    TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
