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
  } finally {
    await connection.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Gagal:', err.message);
  console.error('[migrate] Pastikan MySQL berjalan dan file backend/.env sudah benar.');
  process.exit(1);
});
