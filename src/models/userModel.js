const { pool } = require('../config/database');

async function findByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = :email LIMIT 1',
    { email }
  );
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.execute(
    'SELECT id, email, full_name, role, is_active FROM users WHERE id = :id LIMIT 1',
    { id }
  );
  return rows[0] || null;
}

module.exports = { findByEmail, findById };
