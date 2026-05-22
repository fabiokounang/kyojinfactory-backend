/**
 * Seed admin user.
 * Jalankan: node database/seed.js
 * Memerlukan .env terisi (DB_*).
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/database');

const DEFAULT_USERS = [
  { email: 'admin@kyojin.local', password: 'admin123', fullName: 'Administrator', role: 'superadmin' },
  { email: 'finance@kyojin.local', password: 'admin123', fullName: 'Finance Admin', role: 'admin' },
  { email: 'staff@kyojin.local', password: 'staff123', fullName: 'Staff Operator', role: 'staff' },
];

async function run() {
  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.execute(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES (:email, :hash, :fullName, :role, 1)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash),
                               full_name = VALUES(full_name),
                               role = VALUES(role),
                               is_active = 1`,
      { email: u.email, hash, fullName: u.fullName, role: u.role }
    );
    console.log(`  ✓ ${u.email} (${u.role}) / ${u.password}`);
  }

  console.log('Seed selesai.');
  await pool.end();
}

run().catch((err) => {
  console.error('Seed gagal:', err);
  process.exit(1);
});
