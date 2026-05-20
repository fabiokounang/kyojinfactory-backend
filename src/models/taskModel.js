const { pool } = require('../config/database');

const COLS =
  'id, type, reference_type, reference_id, title, notes, assignee_user_id, due_date, status, done_at, created_at, updated_at';

async function list({ status } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('status = :status');
    params.status = status;
  }
  const sql = `SELECT ${COLS} FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY
    CASE status WHEN 'OPEN' THEN 0 WHEN 'DONE' THEN 1 ELSE 2 END,
    COALESCE(due_date, '9999-12-31') ASC,
    created_at DESC`;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${COLS} FROM tasks WHERE id = :id LIMIT 1`, { id });
  return rows[0] || null;
}

async function findOpenForLine(conn, type, lineId) {
  const [rows] = await conn.execute(
    `SELECT ${COLS} FROM tasks
     WHERE type = :type AND reference_type = 'customer_po_line' AND reference_id = :id AND status = 'OPEN'
     LIMIT 1`,
    { type, id: lineId }
  );
  return rows[0] || null;
}

async function createWithConn(conn, data) {
  const [result] = await conn.execute(
    `INSERT INTO tasks (type, reference_type, reference_id, title, notes, assignee_user_id, due_date, status)
     VALUES (:type, :reference_type, :reference_id, :title, :notes, :assignee_user_id, :due_date, 'OPEN')`,
    {
      type: data.type,
      reference_type: data.referenceType,
      reference_id: data.referenceId,
      title: data.title,
      notes: data.notes || null,
      assignee_user_id: data.assigneeUserId || null,
      due_date: data.dueDate || null,
    }
  );
  return result.insertId;
}

async function markDone(id) {
  await pool.execute(
    `UPDATE tasks SET status = 'DONE', done_at = CURRENT_TIMESTAMP WHERE id = :id AND status = 'OPEN'`,
    { id }
  );
  return findById(id);
}

async function reopen(id) {
  await pool.execute(`UPDATE tasks SET status = 'OPEN', done_at = NULL WHERE id = :id`, { id });
  return findById(id);
}

/**
 * Tandai semua todo CREATE_BOM yang masih OPEN sebagai DONE untuk semua
 * customer_po_lines yang memakai master_item ini (FG).
 * Dipanggil saat versi BOM untuk FG tersebut diaktifkan.
 */
async function markBomDoneForFg(fgId) {
  const [result] = await pool.execute(
    `UPDATE tasks t
       JOIN customer_po_lines l ON l.id = t.reference_id
        SET t.status = 'DONE', t.done_at = CURRENT_TIMESTAMP
      WHERE t.type = 'CREATE_BOM'
        AND t.reference_type = 'customer_po_line'
        AND t.status = 'OPEN'
        AND l.master_item_id = :fg_id`,
    { fg_id: fgId }
  );
  return result.affectedRows || 0;
}

module.exports = {
  list,
  findById,
  findOpenForLine,
  createWithConn,
  markDone,
  reopen,
  markBomDoneForFg,
};
