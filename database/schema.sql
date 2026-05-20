CREATE DATABASE IF NOT EXISTS kyojinfactory
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE kyojinfactory;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role ENUM('superadmin', 'admin', 'staff') NOT NULL DEFAULT 'staff',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NULL,
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  address TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customers_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS master_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category ENUM('RAW', 'WIP', 'FG') NOT NULL,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  std_size VARCHAR(128) NULL,
  version VARCHAR(16) NOT NULL DEFAULT 'V1',
  source_po_line_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_master_items_category (category),
  INDEX idx_master_items_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_pos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(64) NOT NULL UNIQUE,
  customer_po_ref VARCHAR(128) NULL,
  po_date DATE NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  payment_term_trigger ENUM('AFTER_PO_ISSUED', 'AFTER_GOODS_RECEIVED') NOT NULL DEFAULT 'AFTER_PO_ISSUED',
  payment_term_days INT UNSIGNED NOT NULL DEFAULT 14,
  due_date DATE NULL,
  ppn_rate DECIMAL(5, 2) NOT NULL DEFAULT 11.00,
  status ENUM('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  confirmed_at TIMESTAMP NULL,
  customer_received_at DATE NULL,
  customer_received_notes TEXT NULL,
  customer_received_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cpo_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cpo_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_cpo_received_by FOREIGN KEY (customer_received_by) REFERENCES users(id),
  INDEX idx_cpo_status (status),
  INDEX idx_cpo_po_date (po_date),
  INDEX idx_cpo_due_date (due_date),
  INDEX idx_cpo_received_at (customer_received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_po_lines (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_po_id INT UNSIGNED NOT NULL,
  line_no INT UNSIGNED NOT NULL DEFAULT 1,
  item_name VARCHAR(255) NOT NULL,
  item_code VARCHAR(64) NULL UNIQUE,
  qty DECIMAL(14, 2) NOT NULL DEFAULT 1,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  unit_price DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ppn_included TINYINT(1) NOT NULL DEFAULT 1,
  line_amount DECIMAL(16, 2) NOT NULL DEFAULT 0,
  master_item_id INT UNSIGNED NULL,
  std_size VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cpol_po FOREIGN KEY (customer_po_id) REFERENCES customer_pos(id) ON DELETE CASCADE,
  CONSTRAINT fk_cpol_master_item FOREIGN KEY (master_item_id) REFERENCES master_items(id),
  INDEX idx_cpol_po (customer_po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  description VARCHAR(255) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_settings (setting_key, setting_value, description)
VALUES ('ppn_rate', '11', 'Tarif PPN (persen)');

CREATE TABLE IF NOT EXISTS po_number_sequences (
  year INT UNSIGNED NOT NULL PRIMARY KEY,
  last_seq INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type ENUM('CREATE_BOM') NOT NULL,
  reference_type VARCHAR(64) NOT NULL,
  reference_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  assignee_user_id INT UNSIGNED NULL,
  due_date DATE NULL,
  status ENUM('OPEN', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
  done_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_user FOREIGN KEY (assignee_user_id) REFERENCES users(id),
  INDEX idx_tasks_status (status),
  INDEX idx_tasks_ref (reference_type, reference_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_versions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fg_id INT UNSIGNED NOT NULL,
  version_name VARCHAR(64) NOT NULL,
  status ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bomv_fg FOREIGN KEY (fg_id) REFERENCES master_items(id),
  CONSTRAINT fk_bomv_user FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_bomv_fg_version (fg_id, version_name),
  INDEX idx_bomv_fg (fg_id),
  INDEX idx_bomv_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bom_components (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fg_id INT UNSIGNED NOT NULL,
  bom_version_id INT UNSIGNED NOT NULL,
  level INT UNSIGNED NOT NULL,
  parent_component_id INT UNSIGNED NULL,
  component_name VARCHAR(255) NOT NULL,
  component_code VARCHAR(128) NOT NULL,
  running_number INT UNSIGNED NOT NULL,
  qty_per_parent DECIMAL(14, 4) NOT NULL DEFAULT 1,
  unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
  size VARCHAR(255) NULL,
  waste_percent DECIMAL(8, 4) NOT NULL DEFAULT 0,
  has_next_level TINYINT(1) NOT NULL DEFAULT 0,
  is_raw TINYINT(1) NOT NULL DEFAULT 1,
  master_item_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_bomc_version FOREIGN KEY (bom_version_id) REFERENCES bom_versions(id) ON DELETE CASCADE,
  CONSTRAINT fk_bomc_parent FOREIGN KEY (parent_component_id) REFERENCES bom_components(id) ON DELETE CASCADE,
  CONSTRAINT fk_bomc_fg FOREIGN KEY (fg_id) REFERENCES master_items(id),
  CONSTRAINT fk_bomc_master_item FOREIGN KEY (master_item_id) REFERENCES master_items(id) ON DELETE SET NULL,
  CONSTRAINT chk_bomc_status CHECK (NOT (has_next_level = 1 AND is_raw = 1)),
  UNIQUE KEY uq_bomc_code (bom_version_id, component_code),
  INDEX idx_bomc_version (bom_version_id),
  INDEX idx_bomc_parent (parent_component_id),
  INDEX idx_bomc_level (bom_version_id, level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
