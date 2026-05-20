const { pool } = require('../config/database');
const { nextPoNumber } = require('../services/poNumberService');
const { generateFgCode } = require('../services/itemCodeService');
const masterItemModel = require('./masterItemModel');
const taskModel = require('./taskModel');
const settingsModel = require('./settingsModel');
const { calcLineAmount } = require('../services/taxService');

const HEADER_FIELDS = [
  'id', 'po_number', 'customer_po_ref', 'po_date', 'customer_id',
  'payment_term_trigger', 'payment_term_days', 'due_date', 'ppn_rate',
  'status', 'notes', 'created_by', 'confirmed_at',
  'customer_received_at', 'customer_received_notes', 'customer_received_by',
  'created_at', 'updated_at',
];
const HEADER_COLS = HEADER_FIELDS.join(', ');
const HEADER_COLS_P = HEADER_FIELDS.map((f) => `p.${f}`).join(', ');

const LINE_COLS = [
  'id', 'customer_po_id', 'line_no', 'item_name', 'item_code',
  'qty', 'unit', 'unit_price', 'ppn_included', 'line_amount',
  'master_item_id', 'std_size', 'created_at', 'updated_at',
].join(', ');

function addDays(dateStr, days) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function calcDueDate({ poDate, days, trigger, customerReceivedAt } = {}) {
  if (trigger === 'AFTER_PO_ISSUED') return addDays(poDate, days);
  if (trigger === 'AFTER_GOODS_RECEIVED' && customerReceivedAt) return addDays(customerReceivedAt, days);
  return null;
}

async function list({ status, customerId, search } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('p.status = :status');
    params.status = status;
  }
  if (customerId) {
    where.push('p.customer_id = :customer_id');
    params.customer_id = customerId;
  }
  if (search) {
    where.push('(p.po_number LIKE :q OR p.customer_po_ref LIKE :q OR c.name LIKE :q)');
    params.q = `%${search}%`;
  }
  const sql = `
    SELECT ${HEADER_COLS_P},
           c.name AS customer_name, c.code AS customer_code
    FROM customer_pos p
    JOIN customers c ON c.id = p.customer_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY p.po_date DESC, p.id DESC
  `;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findHeaderByConn(conn, id) {
  const [headers] = await conn.execute(
    `SELECT ${HEADER_COLS} FROM customer_pos WHERE id = :id LIMIT 1`,
    { id }
  );
  return headers[0] || null;
}

async function findById(id) {
  const [headers] = await pool.execute(
    `SELECT ${HEADER_COLS_P},
            c.name AS customer_name, c.code AS customer_code
     FROM customer_pos p
     JOIN customers c ON c.id = p.customer_id
     WHERE p.id = :id LIMIT 1`,
    { id }
  );
  const header = headers[0];
  if (!header) return null;
  const [lines] = await pool.execute(
    `SELECT ${LINE_COLS} FROM customer_po_lines WHERE customer_po_id = :id ORDER BY line_no ASC, id ASC`,
    { id }
  );
  return { ...header, lines };
}

async function createOnce(data, userId) {
  const ppnRate = await settingsModel.getPpnRate();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const year = new Date(data.poDate).getFullYear() || new Date().getFullYear();
    const poNumber = await nextPoNumber(conn, year);
    const dueDate = calcDueDate({
      poDate: data.poDate,
      days: data.paymentTermDays,
      trigger: data.paymentTermTrigger,
    });

    const [result] = await conn.execute(
      `INSERT INTO customer_pos
        (po_number, customer_po_ref, po_date, customer_id,
         payment_term_trigger, payment_term_days, due_date, ppn_rate,
         status, notes, created_by)
       VALUES (:po_number, :customer_po_ref, :po_date, :customer_id,
               :payment_term_trigger, :payment_term_days, :due_date, :ppn_rate,
               'DRAFT', :notes, :created_by)`,
      {
        po_number: poNumber,
        customer_po_ref: data.customerPoRef || null,
        po_date: data.poDate,
        customer_id: data.customerId,
        payment_term_trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        payment_term_days: data.paymentTermDays ?? 14,
        due_date: dueDate,
        ppn_rate: ppnRate,
        notes: data.notes || null,
        created_by: userId || null,
      }
    );
    const poId = result.insertId;
    await insertLines(conn, poId, data.lines || [], ppnRate);
    await conn.commit();
    return findById(poId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function create(data, userId) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await createOnce(data, userId);
    } catch (err) {
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < maxAttempts) continue;
      throw err;
    }
  }
  throw new Error('Gagal membuat PO setelah beberapa percobaan');
}

async function update(id, data) {
  const ppnRate = await settingsModel.getPpnRate();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const existing = await findHeaderByConn(conn, id);
    if (!existing) {
      const err = new Error('PO tidak ditemukan');
      err.status = 404;
      throw err;
    }
    const dueDate = calcDueDate({
      poDate: data.poDate,
      days: data.paymentTermDays,
      trigger: data.paymentTermTrigger,
      customerReceivedAt: existing.customer_received_at || null,
    });
    await conn.execute(
      `UPDATE customer_pos SET
         customer_po_ref = :customer_po_ref,
         po_date = :po_date,
         customer_id = :customer_id,
         payment_term_trigger = :payment_term_trigger,
         payment_term_days = :payment_term_days,
         due_date = :due_date,
         ppn_rate = :ppn_rate,
         notes = :notes
       WHERE id = :id`,
      {
        id,
        customer_po_ref: data.customerPoRef || null,
        po_date: data.poDate,
        customer_id: data.customerId,
        payment_term_trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        payment_term_days: data.paymentTermDays ?? 14,
        due_date: dueDate,
        ppn_rate: ppnRate,
        notes: data.notes || null,
      }
    );
    await conn.execute('DELETE FROM customer_po_lines WHERE customer_po_id = :id', { id });
    await insertLines(conn, id, data.lines || [], ppnRate);
    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function insertLines(conn, poId, lines, ppnRate) {
  let lineNo = 1;
  for (const line of lines) {
    const qty = Number(line.qty || 0);
    const unitPrice = Number(line.unitPrice || 0);
    const ppnIncluded = line.ppnIncluded !== false;
    await conn.execute(
      `INSERT INTO customer_po_lines
         (customer_po_id, line_no, item_name, qty, unit, unit_price, ppn_included, line_amount)
       VALUES (:po_id, :line_no, :item_name, :qty, :unit, :unit_price, :ppn_included, :line_amount)`,
      {
        po_id: poId,
        line_no: lineNo++,
        item_name: line.itemName,
        qty,
        unit: line.unit || 'pcs',
        unit_price: unitPrice,
        ppn_included: ppnIncluded ? 1 : 0,
        line_amount: calcLineAmount(qty, unitPrice, ppnIncluded, ppnRate),
      }
    );
  }
}

async function destroy(id) {
  await pool.execute('DELETE FROM customer_pos WHERE id = :id', { id });
}

async function confirm(id, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [headers] = await conn.execute(
      `SELECT ${HEADER_COLS} FROM customer_pos WHERE id = :id LIMIT 1`,
      { id }
    );
    const header = headers[0];
    if (!header) {
      const err = new Error('PO tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (header.status !== 'DRAFT') {
      const err = new Error('Hanya PO berstatus DRAFT yang bisa dikonfirmasi');
      err.status = 400;
      throw err;
    }

    const [lines] = await conn.execute(
      `SELECT ${LINE_COLS} FROM customer_po_lines WHERE customer_po_id = :id ORDER BY line_no ASC`,
      { id }
    );
    if (lines.length === 0) {
      const err = new Error('PO tidak memiliki baris item');
      err.status = 400;
      throw err;
    }

    for (const line of lines) {
      const code = await generateFgCode(conn, line.item_name, 'V1');
      const masterItemId = await masterItemModel.createWithConn(conn, {
        code,
        name: line.item_name,
        category: 'FG',
        unit: line.unit,
        version: 'V1',
        sourcePoLineId: line.id,
      });
      await conn.execute(
        `UPDATE customer_po_lines SET item_code = :code, master_item_id = :mid WHERE id = :id`,
        { code, mid: masterItemId, id: line.id }
      );

      const existing = await taskModel.findOpenForLine(conn, 'CREATE_BOM', line.id);
      if (!existing) {
        const taskDueDate = new Date(header.po_date);
        taskDueDate.setDate(taskDueDate.getDate() + 3);
        await taskModel.createWithConn(conn, {
          type: 'CREATE_BOM',
          referenceType: 'customer_po_line',
          referenceId: line.id,
          title: `Buat BOM untuk ${code}`,
          assigneeUserId: userId || header.created_by,
          dueDate: taskDueDate.toISOString().slice(0, 10),
        });
      }
    }

    await conn.execute(
      `UPDATE customer_pos
         SET status = 'CONFIRMED', confirmed_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      { id }
    );

    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cancel(id) {
  const existing = await findById(id);
  if (!existing) return null;
  if (existing.status === 'COMPLETED') {
    const err = new Error('PO yang sudah selesai tidak dapat dibatalkan');
    err.status = 400;
    throw err;
  }
  await pool.execute(`UPDATE customer_pos SET status = 'CANCELLED' WHERE id = :id`, { id });
  return findById(id);
}

async function recordReceipt(id, { receivedDate, notes, markCompleted, userId }) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('PO tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status === 'DRAFT' || existing.status === 'CANCELLED') {
    const err = new Error('Tidak dapat mencatat penerimaan pada PO berstatus ' + existing.status);
    err.status = 400;
    throw err;
  }
  if (existing.payment_term_trigger !== 'AFTER_GOODS_RECEIVED') {
    const err = new Error('PO ini menggunakan termin setelah PO terbit, bukan setelah terima barang');
    err.status = 400;
    throw err;
  }

  const dueDate = calcDueDate({
    trigger: 'AFTER_GOODS_RECEIVED',
    days: existing.payment_term_days,
    customerReceivedAt: receivedDate,
  });

  const newStatus = markCompleted === false ? existing.status : 'COMPLETED';

  await pool.execute(
    `UPDATE customer_pos SET
       customer_received_at = :received_at,
       customer_received_notes = :received_notes,
       customer_received_by = :received_by,
       due_date = :due_date,
       status = :status
     WHERE id = :id`,
    {
      id,
      received_at: receivedDate,
      received_notes: notes || null,
      received_by: userId || null,
      due_date: dueDate,
      status: newStatus,
    }
  );

  return findById(id);
}

module.exports = { list, findById, create, update, destroy, confirm, cancel, recordReceipt };
