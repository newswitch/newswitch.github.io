-- Run only in a dedicated test MySQL instance. No DROP/TRUNCATE or credential setup.
-- DATETIME text in this lab is explicitly interpreted as UTC by the data contract.
CREATE DATABASE IF NOT EXISTS datax_lab CHARACTER SET utf8mb4;
USE datax_lab;
CREATE TABLE IF NOT EXISTS orders (
  order_id BIGINT NOT NULL PRIMARY KEY,
  customer_id VARCHAR(32) NOT NULL,
  amount DECIMAL(18,2) NULL,
  status VARCHAR(16) NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX ix_orders_updated (updated_at, order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders_stage LIKE orders;
-- Intentionally fail on duplicate keys when run a second time. Do not hide old data.
INSERT INTO orders (order_id, customer_id, amount, status, updated_at) VALUES
  (101, '0007', 10.10, 'paid',      '2026-11-01 00:10:00'),
  (102, '0008', 20.20, 'paid',      '2026-11-01 00:20:00'),
  (103, '0009', NULL,  'pending',   '2026-11-01 01:10:00'),
  (104, '0010', 0.00,  'cancelled', '2026-11-01 02:10:00');
