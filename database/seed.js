/**
 * Seed admin user.
 * Jalankan: node database/seed.js
 * Memerlukan .env terisi (DB_*).
 */
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/database');

async function run() {
  const email = 'admin@kyojin.local';
  const password = 'admin123';
  const fullName = 'Administrator';
  const role = 'superadmin';

  const hash = await bcrypt.hash(password, 10);

  await pool.execute(
    `INSERT INTO users (email, password_hash, full_name, role, is_active)
     VALUES (:email, :hash, :fullName, :role, 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash),
                             full_name = VALUES(full_name),
                             role = VALUES(role),
                             is_active = 1`,
    { email, hash, fullName, role }
  );

  console.log(`Seed selesai. Login: ${email} / ${password}`);
  await pool.end();
}

run().catch((err) => {
  console.error('Seed gagal:', err);
  process.exit(1);
});
