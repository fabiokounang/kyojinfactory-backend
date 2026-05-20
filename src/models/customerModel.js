const { pool } = require('../config/database');

const COLS = 'id, code, name, contact_person, phone, email, address, is_active, created_at, updated_at';

async function list({ search, includeInactive } = {}) {
  const where = [];
  const params = {};
  if (!includeInactive) {
    where.push('is_active = 1');
  }
  if (search) {
    where.push('(name LIKE :q OR code LIKE :q OR contact_person LIKE :q)');
    params.q = `%${search}%`;
  }
  const sql = `SELECT ${COLS} FROM customers ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name ASC`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM customers WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function findByCode(code) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM customers WHERE code = :code LIMIT 1`, { code });
  return rows[0] || null;
}

async function nextCode() {
  const [rows] = await pool.execute(
    "SELECT MAX(CAST(SUBSTRING(code, 6) AS UNSIGNED)) AS max_seq FROM customers WHERE code LIKE 'CUST-%'"
  );
  const next = (rows[0]?.max_seq || 0) + 1;
  return `CUST-${String(next).padStart(3, '0')}`;
}

async function create(data) {
  const code = data.code || (await nextCode());
  const [result] = await pool.execute(
    `INSERT INTO customers (code, name, contact_person, phone, email, address, is_active)
     VALUES (:code, :name, :contact_person, :phone, :email, :address, :is_active)`,
    {
      code,
      name: data.name,
      contact_person: data.contactPerson || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      is_active: data.isActive === false ? 0 : 1,
    }
  );
  return findById(result.insertId);
}

async function update(id, data) {
  await pool.execute(
    `UPDATE customers SET
       name = :name,
       contact_person = :contact_person,
       phone = :phone,
       email = :email,
       address = :address,
       is_active = :is_active
     WHERE id = :id`,
    {
      id,
      name: data.name,
      contact_person: data.contactPerson || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      is_active: data.isActive === false ? 0 : 1,
    }
  );
  return findById(id);
}

async function softDelete(id) {
  await pool.execute('UPDATE customers SET is_active = 0 WHERE id = :id', { id });
}

module.exports = { list, findById, findByCode, create, update, softDelete, nextCode };
