const { pool } = require('../config/database');
const { nextPovNumber } = require('../services/povNumberService');
const { calcLineAmount } = require('../services/taxService');
const settingsModel = require('./settingsModel');

const HEADER_COLS = [
  'vp.id',
  'vp.po_number',
  'vp.vendor_ref',
  'vp.po_date',
  'vp.vendor_id',
  'vp.payment_mode',
  'vp.dp_amount',
  'vp.dp_due_date',
  'vp.balance_due_date',
  'vp.payment_term_days',
  'vp.ppn_rate',
  'vp.status',
  'vp.notes',
  'vp.created_by',
  'vp.confirmed_at',
  'vp.received_at',
  'vp.received_notes',
  'vp.received_by',
  'vp.created_at',
  'vp.updated_at',
  'v.code AS vendor_code',
  'v.name AS vendor_name',
  'v.phone AS vendor_phone',
  'u.full_name AS created_by_name',
  'ru.full_name AS received_by_name',
].join(', ');

const LINE_COLS = [
  'id',
  'vendor_po_id',
  'line_no',
  'item_name',
  'master_item_id',
  'qty',
  'unit',
  'unit_price',
  'ppn_included',
  'line_amount',
  'std_size',
  'created_at',
  'updated_at',
].join(', ');

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * Calculate due dates based on payment mode at confirm time.
 * ON_RECEIPT and DP_THEN_RECEIPT balance is calculated later (at receive).
 */
function calcDueDatesOnConfirm({ poDate, paymentMode, paymentTermDays, dpAmount }) {
  const days = Number(paymentTermDays || 0);
  switch (paymentMode) {
    case 'UPFRONT':
      return { dpDueDate: null, balanceDueDate: addDays(poDate, days) };
    case 'DP_THEN_RECEIPT':
      return { dpDueDate: addDays(poDate, days), balanceDueDate: null };
    case 'ON_RECEIPT':
    default:
      return { dpDueDate: null, balanceDueDate: null };
  }
}

async function headerQuery(where, params) {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM vendor_pos vp
       JOIN vendors v ON v.id = vp.vendor_id
       LEFT JOIN users u ON u.id = vp.created_by
       LEFT JOIN users ru ON ru.id = vp.received_by
      ${where}
      ORDER BY vp.po_date DESC, vp.id DESC`,
    params
  );
}

async function list({ status, vendorId, search } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('vp.status = :status'); params.status = status; }
  if (vendorId) { where.push('vp.vendor_id = :vendor_id'); params.vendor_id = vendorId; }
  if (search) {
    where.push('(vp.po_number LIKE :s OR v.name LIKE :s OR vp.vendor_ref LIKE :s)');
    params.s = `%${search}%`;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await headerQuery(clause, params);
  return rows;
}

async function findById(id) {
  const [rows] = await headerQuery('WHERE vp.id = :id LIMIT 1', { id });
  const header = rows[0] || null;
  if (!header) return null;
  const [lines] = await pool.execute(
    `SELECT ${LINE_COLS} FROM vendor_po_lines WHERE vendor_po_id = :id ORDER BY line_no ASC`,
    { id }
  );
  return { ...header, lines };
}

async function create(data, userId) {
  const ppnRate = await settingsModel.getPpnRate();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const year = new Date(data.poDate).getFullYear() || new Date().getFullYear();
    const poNumber = await nextPovNumber(conn, year);

    const [result] = await conn.execute(
      `INSERT INTO vendor_pos
         (po_number, vendor_ref, po_date, vendor_id, payment_mode,
          dp_amount, payment_term_days, ppn_rate, status, notes, created_by)
       VALUES (:po_number, :vendor_ref, :po_date, :vendor_id, :payment_mode,
               :dp_amount, :payment_term_days, :ppn_rate, 'DRAFT', :notes, :created_by)`,
      {
        po_number: poNumber,
        vendor_ref: data.vendorRef || null,
        po_date: data.poDate,
        vendor_id: data.vendorId,
        payment_mode: data.paymentMode || 'ON_RECEIPT',
        dp_amount: data.dpAmount || null,
        payment_term_days: data.paymentTermDays ?? 14,
        ppn_rate: ppnRate,
        notes: data.notes || null,
        created_by: userId || null,
      }
    );
    const vpoId = result.insertId;
    await insertLines(conn, vpoId, data.lines || [], ppnRate);
    await conn.commit();
    return findById(vpoId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function update(id, data) {
  const ppnRate = await settingsModel.getPpnRate();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE vendor_pos SET
         vendor_ref = :vendor_ref,
         po_date = :po_date,
         vendor_id = :vendor_id,
         payment_mode = :payment_mode,
         dp_amount = :dp_amount,
         payment_term_days = :payment_term_days,
         ppn_rate = :ppn_rate,
         notes = :notes
       WHERE id = :id AND status = 'DRAFT'`,
      {
        id,
        vendor_ref: data.vendorRef || null,
        po_date: data.poDate,
        vendor_id: data.vendorId,
        payment_mode: data.paymentMode || 'ON_RECEIPT',
        dp_amount: data.dpAmount || null,
        payment_term_days: data.paymentTermDays ?? 14,
        ppn_rate: ppnRate,
        notes: data.notes || null,
      }
    );
    await conn.execute('DELETE FROM vendor_po_lines WHERE vendor_po_id = :id', { id });
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

async function confirm(id) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status !== 'DRAFT') { const e = new Error('Hanya PO berstatus DRAFT yang dapat dikonfirmasi'); e.status = 400; throw e; }
  if (!vpo.lines || vpo.lines.length === 0) { const e = new Error('PO tidak memiliki baris item'); e.status = 400; throw e; }

  const { dpDueDate, balanceDueDate } = calcDueDatesOnConfirm({
    poDate: vpo.po_date,
    paymentMode: vpo.payment_mode,
    paymentTermDays: vpo.payment_term_days,
    dpAmount: vpo.dp_amount,
  });

  await pool.execute(
    `UPDATE vendor_pos
        SET status = 'CONFIRMED',
            confirmed_at = CURRENT_TIMESTAMP,
            dp_due_date = :dp_due_date,
            balance_due_date = :balance_due_date
      WHERE id = :id`,
    { id, dp_due_date: dpDueDate, balance_due_date: balanceDueDate }
  );
  return findById(id);
}

async function recordReceipt(id, { receivedDate, receivedNotes, userId }) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status !== 'CONFIRMED') { const e = new Error('Hanya PO berstatus CONFIRMED yang dapat dicatat penerimaannya'); e.status = 400; throw e; }

  let balanceDueDate = vpo.balance_due_date;
  if (vpo.payment_mode === 'ON_RECEIPT') {
    balanceDueDate = addDays(receivedDate, vpo.payment_term_days);
  } else if (vpo.payment_mode === 'DP_THEN_RECEIPT') {
    balanceDueDate = addDays(receivedDate, vpo.payment_term_days);
  }

  await pool.execute(
    `UPDATE vendor_pos
        SET status = 'RECEIVED',
            received_at = :received_at,
            received_notes = :received_notes,
            received_by = :received_by,
            balance_due_date = :balance_due_date
      WHERE id = :id`,
    {
      id,
      received_at: receivedDate,
      received_notes: receivedNotes || null,
      received_by: userId || null,
      balance_due_date: balanceDueDate,
    }
  );
  return findById(id);
}

async function complete(id) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status !== 'RECEIVED') { const e = new Error('Hanya PO berstatus RECEIVED yang dapat diselesaikan'); e.status = 400; throw e; }
  await pool.execute(`UPDATE vendor_pos SET status = 'COMPLETED' WHERE id = :id`, { id });
  return findById(id);
}

async function cancel(id) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status === 'COMPLETED') { const e = new Error('PO yang sudah selesai tidak dapat dibatalkan'); e.status = 400; throw e; }
  if (vpo.status === 'RECEIVED') { const e = new Error('PO yang sudah diterima tidak dapat dibatalkan'); e.status = 400; throw e; }
  await pool.execute(`UPDATE vendor_pos SET status = 'CANCELLED' WHERE id = :id`, { id });
  return findById(id);
}

async function destroy(id) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status !== 'DRAFT') { const e = new Error('Hanya PO berstatus DRAFT yang dapat dihapus'); e.status = 400; throw e; }
  await pool.execute('DELETE FROM vendor_pos WHERE id = :id', { id });
}

async function insertLines(conn, vpoId, lines, ppnRate) {
  let lineNo = 1;
  for (const line of lines) {
    const qty = Number(line.qty || 0);
    const unitPrice = Number(line.unitPrice || 0);
    const ppnIncluded = line.ppnIncluded !== false;
    await conn.execute(
      `INSERT INTO vendor_po_lines
         (vendor_po_id, line_no, item_name, master_item_id, qty, unit, unit_price, ppn_included, line_amount, std_size)
       VALUES (:vpo_id, :line_no, :item_name, :master_item_id, :qty, :unit, :unit_price, :ppn_included, :line_amount, :std_size)`,
      {
        vpo_id: vpoId,
        line_no: lineNo++,
        item_name: line.itemName,
        master_item_id: line.masterItemId || null,
        qty,
        unit: line.unit || 'pcs',
        unit_price: unitPrice,
        ppn_included: ppnIncluded ? 1 : 0,
        line_amount: calcLineAmount(qty, unitPrice, ppnIncluded, ppnRate),
        std_size: line.stdSize || null,
      }
    );
  }
}

module.exports = { list, findById, create, update, confirm, recordReceipt, complete, cancel, destroy };
