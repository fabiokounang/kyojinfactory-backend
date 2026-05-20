const { pool } = require('../config/database');

const COLS =
  'id, code, name, category, unit, std_size, version, source_po_line_id, created_at, updated_at';

async function list({ category, search } = {}) {
  const where = [];
  const params = {};
  if (category) {
    where.push('category = :category');
    params.category = category;
  }
  if (search) {
    where.push('(name LIKE :q OR code LIKE :q)');
    params.q = `%${search}%`;
  }
  const sql = `SELECT ${COLS} FROM master_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM master_items WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function findByCode(code) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM master_items WHERE code = :code LIMIT 1`, {
    code,
  });
  return rows[0] || null;
}

async function createWithConn(conn, data) {
  const [result] = await conn.execute(
    `INSERT INTO master_items (code, name, category, unit, std_size, version, source_po_line_id)
     VALUES (:code, :name, :category, :unit, :std_size, :version, :source_po_line_id)`,
    {
      code: data.code,
      name: data.name,
      category: data.category,
      unit: data.unit || 'pcs',
      std_size: data.stdSize || null,
      version: data.version || 'V1',
      source_po_line_id: data.sourcePoLineId || null,
    }
  );
  return result.insertId;
}

async function countPoLineReferences(id) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM customer_po_lines WHERE master_item_id = :id`,
    { id }
  );
  return rows[0]?.cnt || 0;
}

async function update(id, data) {
  await pool.execute(
    `UPDATE master_items
     SET name = :name, unit = :unit, std_size = :std_size
     WHERE id = :id`,
    {
      id,
      name: data.name,
      unit: data.unit || 'pcs',
      std_size: data.stdSize || null,
    }
  );
  return findById(id);
}

async function remove(id) {
  const refs = await countPoLineReferences(id);
  if (refs > 0) {
    const err = new Error('Item masih terhubung ke PO Customer dan tidak dapat dihapus');
    err.status = 400;
    throw err;
  }
  const [result] = await pool.execute(`DELETE FROM master_items WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

module.exports = { list, findById, findByCode, createWithConn, update, remove };
