const { pool } = require('../config/database');
const { generateVendorCode } = require('../services/vendorCodeService');

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
  const sql = `SELECT ${COLS} FROM vendors ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name ASC`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM vendors WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function create(data) {
  const code = data.code || (await generateVendorCode(data.name));
  const [result] = await pool.execute(
    `INSERT INTO vendors (code, name, contact_person, phone, email, address, is_active)
     VALUES (:code, :name, :contact_person, :phone, :email, :address, 1)`,
    {
      code,
      name: data.name,
      contact_person: data.contactPerson || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
    }
  );
  return findById(result.insertId);
}

async function update(id, data) {
  await pool.execute(
    `UPDATE vendors SET
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
  await pool.execute('UPDATE vendors SET is_active = 0 WHERE id = :id', { id });
}

module.exports = { list, findById, create, update, softDelete };
