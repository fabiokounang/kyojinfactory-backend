/**
 * Terapkan database/schema.sql sebelum server jalan.
 * Dipanggil otomatis oleh npm run dev / npm start (hook predev / prestart).
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

if (process.env.NODE_ENV === 'production') {
  dbConfig.ssl = {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
  };
}

async function columnExists(connection, dbName, table, column) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [dbName, table, column]
  );
  return rows.length > 0;
}

async function tableExists(connection, dbName, table) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [dbName, table]
  );
  return rows.length > 0;
}

async function ensureColumn(connection, dbName, table, column, alterSql) {
  if (await columnExists(connection, dbName, table, column)) return false;
  await connection.query(alterSql);
  console.log(`[migrate] Kolom ${table}.${column} ditambahkan.`);
  return true;
}

/** Semua tabel yang dipakai aplikasi — harus ada setelah migrate (deploy). */
const EXPECTED_TABLES = [
  'users',
  'customers',
  'master_items',
  'customer_pos',
  'customer_po_lines',
  'customer_po_payment_terms',
  'app_settings',
  'po_number_sequences',
  'tasks',
  'bom_versions',
  'bom_components',
  'pof_number_sequences',
  'prod_order_forms',
  'prod_order_form_lines',
  'vendors',
  'pov_number_sequences',
  'vendor_pos',
  'vendor_po_lines',
  'vendor_po_payment_terms',
];

async function verifySchema(connection, dbName) {
  const missing = [];
  for (const table of EXPECTED_TABLES) {
    if (!(await tableExists(connection, dbName, table))) {
      missing.push(table);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Verifikasi gagal: tabel belum ada setelah migrate: ${missing.join(', ')}`
    );
  }
  console.log(`[migrate] Verifikasi OK — ${EXPECTED_TABLES.length} tabel siap.`);
}

async function applyPatches(connection, dbName) {
  const receiptColumns = [
    {
      column: 'customer_received_at',
      sql: `ALTER TABLE \`${dbName}\`.customer_pos
            ADD COLUMN customer_received_at DATE NULL AFTER confirmed_at`,
    },
    {
      column: 'customer_received_notes',
      sql: `ALTER TABLE \`${dbName}\`.customer_pos
            ADD COLUMN customer_received_notes TEXT NULL AFTER customer_received_at`,
    },
    {
      column: 'customer_received_by',
      sql: `ALTER TABLE \`${dbName}\`.customer_pos
            ADD COLUMN customer_received_by INT UNSIGNED NULL AFTER customer_received_notes`,
    },
  ];

  for (const col of receiptColumns) {
    await ensureColumn(connection, dbName, 'customer_pos', col.column, col.sql);
  }

  await ensureColumn(
    connection,
    dbName,
    'customer_pos',
    'ppn_rate',
    `ALTER TABLE \`${dbName}\`.customer_pos
     ADD COLUMN ppn_rate DECIMAL(5, 2) NOT NULL DEFAULT 11.00 AFTER due_date`
  );

  await ensureColumn(
    connection,
    dbName,
    'customer_pos',
    'payment_term_trigger',
    `ALTER TABLE \`${dbName}\`.customer_pos
     ADD COLUMN payment_term_trigger ENUM('AFTER_PO_ISSUED', 'AFTER_GOODS_RECEIVED')
       NOT NULL DEFAULT 'AFTER_PO_ISSUED' AFTER customer_id`
  );

  await ensureColumn(
    connection,
    dbName,
    'customer_pos',
    'payment_term_days',
    `ALTER TABLE \`${dbName}\`.customer_pos
     ADD COLUMN payment_term_days INT UNSIGNED NOT NULL DEFAULT 14
       AFTER payment_term_trigger`
  );

  await ensureColumn(
    connection,
    dbName,
    'customer_pos',
    'due_date',
    `ALTER TABLE \`${dbName}\`.customer_pos
     ADD COLUMN due_date DATE NULL AFTER payment_term_days`
  );

  if (!(await tableExists(connection, dbName, 'tasks'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.tasks (
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
        CONSTRAINT fk_tasks_user FOREIGN KEY (assignee_user_id)
          REFERENCES \`${dbName}\`.users(id),
        INDEX idx_tasks_status (status),
        INDEX idx_tasks_ref (reference_type, reference_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel tasks dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'customer_po_payment_terms'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.customer_po_payment_terms (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        customer_po_id INT UNSIGNED NOT NULL,
        term_no INT UNSIGNED NOT NULL DEFAULT 1,
        label VARCHAR(128) NULL,
        amount_type ENUM('PERCENT','FIXED') NOT NULL DEFAULT 'PERCENT',
        amount_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        term_days INT UNSIGNED NOT NULL DEFAULT 0,
        due_date DATE NULL,
        paid_at DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_cppt_cpo FOREIGN KEY (customer_po_id)
          REFERENCES \`${dbName}\`.customer_pos(id) ON DELETE CASCADE,
        UNIQUE KEY uq_cppt (customer_po_id, term_no),
        INDEX idx_cppt_cpo (customer_po_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel customer_po_payment_terms dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'app_settings'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.app_settings (
        setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
        setting_value VARCHAR(255) NOT NULL,
        description VARCHAR(255) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await connection.query(`
      INSERT IGNORE INTO \`${dbName}\`.app_settings (setting_key, setting_value, description)
      VALUES ('ppn_rate', '11', 'Tarif PPN (persen)')
    `);
    console.log('[migrate] Tabel app_settings dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'po_number_sequences'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.po_number_sequences (
        year INT UNSIGNED NOT NULL PRIMARY KEY,
        last_seq INT UNSIGNED NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel po_number_sequences dibuat.');
  }

  const [existingPos] = await connection.query(
    `SELECT po_number FROM \`${dbName}\`.customer_pos`
  );
  const byYear = {};
  for (const row of existingPos) {
    const m = String(row.po_number).match(/^PO-C-(\d{4})-(\d+)$/);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const seq = parseInt(m[2], 10);
    byYear[year] = Math.max(byYear[year] || 0, seq);
  }
  for (const [year, lastSeq] of Object.entries(byYear)) {
    await connection.query(
      `INSERT INTO \`${dbName}\`.po_number_sequences (year, last_seq)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE last_seq = GREATEST(last_seq, VALUES(last_seq))`,
      [year, lastSeq]
    );
  }

  const hasFk = await connection
    .query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customer_pos'
         AND CONSTRAINT_NAME = 'fk_cpo_received_by'`,
      [dbName]
    )
    .then(([rows]) => rows.length > 0);

  if (!hasFk && (await columnExists(connection, dbName, 'customer_pos', 'customer_received_by'))) {
    try {
      await connection.query(`
        ALTER TABLE \`${dbName}\`.customer_pos
        ADD CONSTRAINT fk_cpo_received_by
        FOREIGN KEY (customer_received_by) REFERENCES \`${dbName}\`.users(id)
      `);
      console.log('[migrate] FK fk_cpo_received_by ditambahkan.');
    } catch (err) {
      console.warn('[migrate] FK fk_cpo_received_by dilewati:', err.message);
    }
  }

  const indexExists = await connection
    .query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customer_pos' AND INDEX_NAME = 'idx_cpo_received_at'`,
      [dbName]
    )
    .then(([rows]) => rows.length > 0);

  if (!indexExists && (await columnExists(connection, dbName, 'customer_pos', 'customer_received_at'))) {
    await connection.query(`
      ALTER TABLE \`${dbName}\`.customer_pos
      ADD INDEX idx_cpo_received_at (customer_received_at)
    `);
    console.log('[migrate] Index idx_cpo_received_at ditambahkan.');
  }

  const [roleCol] = await connection.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [dbName]
  );
  const roleType = roleCol[0]?.COLUMN_TYPE || '';
  if (!roleType.includes('superadmin')) {
    await connection.query(`
      ALTER TABLE \`${dbName}\`.users
      MODIFY COLUMN role ENUM('superadmin', 'admin', 'staff') NOT NULL DEFAULT 'staff'
    `);
    await connection.query(
      `UPDATE \`${dbName}\`.users SET role = 'superadmin' WHERE role = 'admin' AND email = 'admin@kyojin.local'`
    );
    console.log('[migrate] Role superadmin ditambahkan; admin@kyojin.local di-upgrade.');
  }

  if (!(await tableExists(connection, dbName, 'bom_versions'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.bom_versions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        fg_id INT UNSIGNED NOT NULL,
        version_name VARCHAR(64) NOT NULL,
        status ENUM('DRAFT', 'ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
        notes TEXT NULL,
        created_by INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_bomv_fg FOREIGN KEY (fg_id) REFERENCES \`${dbName}\`.master_items(id),
        CONSTRAINT fk_bomv_user FOREIGN KEY (created_by) REFERENCES \`${dbName}\`.users(id),
        UNIQUE KEY uq_bomv_fg_version (fg_id, version_name),
        INDEX idx_bomv_fg (fg_id),
        INDEX idx_bomv_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel bom_versions dibuat.');
  }

  await ensureColumn(
    connection,
    dbName,
    'bom_components',
    'master_item_id',
    `ALTER TABLE \`${dbName}\`.bom_components
     ADD COLUMN master_item_id INT UNSIGNED NULL AFTER is_raw`
  );

  const hasMasterItemFk = await connection
    .query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bom_components'
         AND CONSTRAINT_NAME = 'fk_bomc_master_item'`,
      [dbName]
    )
    .then(([rows]) => rows.length > 0);

  if (
    !hasMasterItemFk &&
    (await columnExists(connection, dbName, 'bom_components', 'master_item_id'))
  ) {
    try {
      await connection.query(`
        ALTER TABLE \`${dbName}\`.bom_components
        ADD CONSTRAINT fk_bomc_master_item
        FOREIGN KEY (master_item_id) REFERENCES \`${dbName}\`.master_items(id) ON DELETE SET NULL
      `);
      console.log('[migrate] FK fk_bomc_master_item ditambahkan.');
    } catch (err) {
      console.warn('[migrate] FK fk_bomc_master_item dilewati:', err.message);
    }
  }

  // --- Vendor tables ---
  if (!(await tableExists(connection, dbName, 'vendors'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.vendors (
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
        INDEX idx_vendors_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel vendors dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'pov_number_sequences'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.pov_number_sequences (
        year INT UNSIGNED NOT NULL PRIMARY KEY,
        last_seq INT UNSIGNED NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel pov_number_sequences dibuat.');
  }

  await ensureColumn(
    connection,
    dbName,
    'vendor_pos',
    'payment_term_trigger',
    `ALTER TABLE \`${dbName}\`.vendor_pos
     ADD COLUMN payment_term_trigger ENUM('AFTER_PO_ISSUED', 'AFTER_GOODS_RECEIVED')
       NOT NULL DEFAULT 'AFTER_GOODS_RECEIVED' AFTER vendor_id`
  );

  if (!(await tableExists(connection, dbName, 'vendor_po_payment_terms'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.vendor_po_payment_terms (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        vendor_po_id INT UNSIGNED NOT NULL,
        term_no INT UNSIGNED NOT NULL DEFAULT 1,
        label VARCHAR(128) NULL,
        amount_type ENUM('PERCENT','FIXED') NOT NULL DEFAULT 'PERCENT',
        amount_value DECIMAL(14,2) NOT NULL DEFAULT 0,
        term_days INT UNSIGNED NOT NULL DEFAULT 0,
        due_date DATE NULL,
        paid_at DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_vppt_vpo FOREIGN KEY (vendor_po_id)
          REFERENCES \`${dbName}\`.vendor_pos(id) ON DELETE CASCADE,
        UNIQUE KEY uq_vppt (vendor_po_id, term_no),
        INDEX idx_vppt_vpo (vendor_po_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel vendor_po_payment_terms dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'vendor_pos'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.vendor_pos (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        po_number VARCHAR(64) NOT NULL UNIQUE,
        vendor_ref VARCHAR(128) NULL,
        po_date DATE NOT NULL,
        vendor_id INT UNSIGNED NOT NULL,
        payment_mode ENUM('UPFRONT','DP_THEN_RECEIPT','ON_RECEIPT') NOT NULL DEFAULT 'ON_RECEIPT',
        dp_amount DECIMAL(16,2) NULL,
        dp_due_date DATE NULL,
        balance_due_date DATE NULL,
        payment_term_days INT UNSIGNED NOT NULL DEFAULT 14,
        ppn_rate DECIMAL(5,2) NOT NULL DEFAULT 11.00,
        status ENUM('DRAFT','CONFIRMED','RECEIVED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
        notes TEXT NULL,
        created_by INT UNSIGNED NULL,
        confirmed_at TIMESTAMP NULL,
        received_at DATE NULL,
        received_notes TEXT NULL,
        received_by INT UNSIGNED NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_vpo_vendor FOREIGN KEY (vendor_id) REFERENCES \`${dbName}\`.vendors(id),
        CONSTRAINT fk_vpo_created_by FOREIGN KEY (created_by) REFERENCES \`${dbName}\`.users(id),
        CONSTRAINT fk_vpo_received_by FOREIGN KEY (received_by) REFERENCES \`${dbName}\`.users(id),
        INDEX idx_vpo_status (status),
        INDEX idx_vpo_vendor (vendor_id),
        INDEX idx_vpo_po_date (po_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel vendor_pos dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'vendor_po_lines'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.vendor_po_lines (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        vendor_po_id INT UNSIGNED NOT NULL,
        line_no INT UNSIGNED NOT NULL DEFAULT 1,
        item_name VARCHAR(255) NOT NULL,
        master_item_id INT UNSIGNED NULL,
        qty DECIMAL(14,2) NOT NULL DEFAULT 1,
        unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
        unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
        ppn_included TINYINT(1) NOT NULL DEFAULT 1,
        line_amount DECIMAL(16,2) NOT NULL DEFAULT 0,
        std_size VARCHAR(128) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_vpol_vpo FOREIGN KEY (vendor_po_id)
          REFERENCES \`${dbName}\`.vendor_pos(id) ON DELETE CASCADE,
        CONSTRAINT fk_vpol_master_item FOREIGN KEY (master_item_id)
          REFERENCES \`${dbName}\`.master_items(id) ON DELETE SET NULL,
        INDEX idx_vpol_vpo (vendor_po_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel vendor_po_lines dibuat.');
  }

  // --- POF tables ---
  if (!(await tableExists(connection, dbName, 'pof_number_sequences'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.pof_number_sequences (
        pof_date CHAR(8) NOT NULL PRIMARY KEY,
        last_seq INT UNSIGNED NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel pof_number_sequences dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'prod_order_forms'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.prod_order_forms (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        pof_number VARCHAR(32) NOT NULL UNIQUE,
        customer_po_id INT UNSIGNED NOT NULL UNIQUE,
        status ENUM('DRAFT', 'RELEASED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
        supervisor_user_id INT UNSIGNED NULL,
        issued_by_user_id INT UNSIGNED NULL,
        notes TEXT NULL,
        created_by INT UNSIGNED NULL,
        released_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pof_cpo FOREIGN KEY (customer_po_id) REFERENCES \`${dbName}\`.customer_pos(id),
        CONSTRAINT fk_pof_supervisor FOREIGN KEY (supervisor_user_id) REFERENCES \`${dbName}\`.users(id),
        CONSTRAINT fk_pof_issued_by FOREIGN KEY (issued_by_user_id) REFERENCES \`${dbName}\`.users(id),
        CONSTRAINT fk_pof_created_by FOREIGN KEY (created_by) REFERENCES \`${dbName}\`.users(id),
        INDEX idx_pof_status (status),
        INDEX idx_pof_cpo (customer_po_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel prod_order_forms dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'prod_order_form_lines'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.prod_order_form_lines (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        prod_order_form_id INT UNSIGNED NOT NULL,
        customer_po_line_id INT UNSIGNED NOT NULL,
        line_no INT UNSIGNED NOT NULL DEFAULT 1,
        product_number VARCHAR(64) NOT NULL,
        qty_to_produce DECIMAL(14, 2) NOT NULL DEFAULT 1,
        unit VARCHAR(32) NOT NULL DEFAULT 'pcs',
        bom_version_id INT UNSIGNED NULL,
        start_date DATE NULL,
        end_date DATE NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pofl_pof FOREIGN KEY (prod_order_form_id)
          REFERENCES \`${dbName}\`.prod_order_forms(id) ON DELETE CASCADE,
        CONSTRAINT fk_pofl_cpo_line FOREIGN KEY (customer_po_line_id)
          REFERENCES \`${dbName}\`.customer_po_lines(id),
        CONSTRAINT fk_pofl_bom_version FOREIGN KEY (bom_version_id)
          REFERENCES \`${dbName}\`.bom_versions(id) ON DELETE SET NULL,
        UNIQUE KEY uq_pofl_line (prod_order_form_id, customer_po_line_id),
        INDEX idx_pofl_pof (prod_order_form_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel prod_order_form_lines dibuat.');
  }

  if (!(await tableExists(connection, dbName, 'bom_components'))) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS \`${dbName}\`.bom_components (
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
        CONSTRAINT fk_bomc_version FOREIGN KEY (bom_version_id)
          REFERENCES \`${dbName}\`.bom_versions(id) ON DELETE CASCADE,
        CONSTRAINT fk_bomc_parent FOREIGN KEY (parent_component_id)
          REFERENCES \`${dbName}\`.bom_components(id) ON DELETE CASCADE,
        CONSTRAINT fk_bomc_fg FOREIGN KEY (fg_id) REFERENCES \`${dbName}\`.master_items(id),
        CONSTRAINT fk_bomc_master_item FOREIGN KEY (master_item_id)
          REFERENCES \`${dbName}\`.master_items(id) ON DELETE SET NULL,
        CONSTRAINT chk_bomc_status CHECK (NOT (has_next_level = 1 AND is_raw = 1)),
        UNIQUE KEY uq_bomc_code (bom_version_id, component_code),
        INDEX idx_bomc_version (bom_version_id),
        INDEX idx_bomc_parent (parent_component_id),
        INDEX idx_bomc_level (bom_version_id, level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('[migrate] Tabel bom_components dibuat.');
  }
}

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('[migrate] Menjalankan schema.sql …');

  const dbName = process.env.DB_NAME || 'kyojinfactory';
  const connection = await mysql.createConnection(dbConfig);
  try {
    await connection.query(sql);
    console.log('[migrate] Schema berhasil diterapkan.');
    await applyPatches(connection, dbName);
    await verifySchema(connection, dbName);
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Gagal:', err.message);
  console.error('[migrate] Pastikan MySQL berjalan dan file backend/.env sudah benar.');
  process.exit(1);
});
