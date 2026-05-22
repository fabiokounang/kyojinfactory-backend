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
  'vp.payment_term_trigger',
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

const TERM_COLS = [
  'id', 'vendor_po_id', 'term_no', 'label',
  'amount_type', 'amount_value', 'term_days', 'due_date', 'paid_at',
  'created_at', 'updated_at',
].join(', ');

const EDITABLE_STATUSES = ['CONFIRMED'];

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function calcTermsDueDates(terms, { trigger, poDate, receivedAt }) {
  return terms.map((t) => {
    let due = null;
    if (trigger === 'AFTER_PO_ISSUED' && poDate) {
      due = addDays(poDate, t.term_days ?? t.termDays ?? 0);
    } else if (trigger === 'AFTER_GOODS_RECEIVED' && receivedAt) {
      due = addDays(receivedAt, t.term_days ?? t.termDays ?? 0);
    }
    return { ...t, due_date: due };
  });
}

function maxDueDate(terms) {
  return terms.reduce((m, t) => (!t.due_date ? m : !m || t.due_date > m ? t.due_date : m), null);
}

async function headerQuery(where, params, limit = '') {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM vendor_pos vp
       JOIN vendors v ON v.id = vp.vendor_id
       LEFT JOIN users u ON u.id = vp.created_by
       LEFT JOIN users ru ON ru.id = vp.received_by
      ${where}
      ORDER BY vp.po_date DESC, vp.id DESC
      ${limit}`,
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
  const [rows] = await headerQuery('WHERE vp.id = :id', { id }, 'LIMIT 1');
  const header = rows[0] || null;
  if (!header) return null;
  const [lines] = await pool.execute(
    `SELECT ${LINE_COLS} FROM vendor_po_lines WHERE vendor_po_id = :id ORDER BY line_no ASC`,
    { id }
  );
  const [terms] = await pool.execute(
    `SELECT ${TERM_COLS} FROM vendor_po_payment_terms WHERE vendor_po_id = :id ORDER BY term_no ASC`,
    { id }
  );
  return { ...header, lines, paymentTerms: terms };
}

async function insertTerms(conn, vpoId, terms, { trigger, poDate, receivedAt } = {}) {
  const withDates = calcTermsDueDates(terms, { trigger, poDate, receivedAt });
  let termNo = 1;
  for (const t of withDates) {
    await conn.execute(
      `INSERT INTO vendor_po_payment_terms
         (vendor_po_id, term_no, label, amount_type, amount_value, term_days, due_date)
       VALUES (:vpo_id, :term_no, :label, :amount_type, :amount_value, :term_days, :due_date)`,
      {
        vpo_id: vpoId,
        term_no: termNo++,
        label: t.label || null,
        amount_type: t.amountType || t.amount_type || 'PERCENT',
        amount_value: Number(t.amountValue ?? t.amount_value ?? 0),
        term_days: Number(t.termDays ?? t.term_days ?? 0),
        due_date: t.due_date || null,
      }
    );
  }
  return maxDueDate(withDates);
}

async function applyConfirm(conn, id) {
  const [headerRows] = await conn.execute(
    `SELECT po_date, payment_term_trigger FROM vendor_pos WHERE id = :id LIMIT 1`,
    { id }
  );
  const header = headerRows[0];
  if (!header) {
    const err = new Error('PO Vendor tidak ditemukan');
    err.status = 404;
    throw err;
  }

  const [termRows] = await conn.execute(
    `SELECT id, term_days FROM vendor_po_payment_terms WHERE vendor_po_id = :id ORDER BY term_no ASC`,
    { id }
  );

  let balanceDueDate = null;
  if (header.payment_term_trigger === 'AFTER_PO_ISSUED' && termRows.length > 0) {
    const withDates = calcTermsDueDates(termRows, {
      trigger: 'AFTER_PO_ISSUED',
      poDate: header.po_date,
    });
    for (const t of withDates) {
      await conn.execute(
        `UPDATE vendor_po_payment_terms SET due_date = :due WHERE id = :id`,
        { due: t.due_date || null, id: t.id }
      );
    }
    balanceDueDate = maxDueDate(withDates);
  }

  await conn.execute(
    `UPDATE vendor_pos SET status = 'CONFIRMED',
            confirmed_at = CURRENT_TIMESTAMP,
            balance_due_date = :balance_due_date
      WHERE id = :id`,
    { id, balance_due_date: balanceDueDate }
  );
}

async function create(data, userId) {
  const ppnRate = await settingsModel.getPpnRate();
  const trigger = data.paymentTermTrigger || 'AFTER_GOODS_RECEIVED';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const year = new Date(data.poDate).getFullYear() || new Date().getFullYear();
    const poNumber = await nextPovNumber(conn, year);
    const firstTermDays = data.paymentTerms?.[0]?.termDays ?? 14;

    const [result] = await conn.execute(
      `INSERT INTO vendor_pos
         (po_number, vendor_ref, po_date, vendor_id, payment_term_trigger,
          payment_mode, payment_term_days, ppn_rate, status, notes, created_by)
       VALUES (:po_number, :vendor_ref, :po_date, :vendor_id, :payment_term_trigger,
               'ON_RECEIPT', :payment_term_days, :ppn_rate, 'DRAFT', :notes, :created_by)`,
      {
        po_number: poNumber,
        vendor_ref: data.vendorRef || null,
        po_date: data.poDate,
        vendor_id: data.vendorId,
        payment_term_trigger: trigger,
        payment_term_days: firstTermDays,
        ppn_rate: ppnRate,
        notes: data.notes || null,
        created_by: userId || null,
      }
    );
    const vpoId = result.insertId;
    const lines = data.lines || [];
    if (!lines.length) {
      const err = new Error('PO tidak memiliki baris item');
      err.status = 400;
      throw err;
    }
    await insertLines(conn, vpoId, lines, ppnRate);
    if (data.paymentTerms?.length) {
      await insertTerms(conn, vpoId, data.paymentTerms, {
        trigger,
        poDate: data.poDate,
      });
    }
    await applyConfirm(conn, vpoId);
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
  const trigger = data.paymentTermTrigger || 'AFTER_GOODS_RECEIVED';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.execute(
      `SELECT status, received_at FROM vendor_pos WHERE id = :id LIMIT 1`,
      { id }
    );
    const existing = existingRows[0];
    if (!existing) {
      const err = new Error('PO Vendor tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      const err = new Error('PO dengan status ' + existing.status + ' tidak dapat diubah');
      err.status = 400;
      throw err;
    }
    const receivedAt = existing.received_at || null;
    const firstTermDays = data.paymentTerms?.[0]?.termDays ?? 14;

    await conn.execute(
      `UPDATE vendor_pos SET
         vendor_ref = :vendor_ref,
         po_date = :po_date,
         vendor_id = :vendor_id,
         payment_term_trigger = :payment_term_trigger,
         payment_term_days = :payment_term_days,
         ppn_rate = :ppn_rate,
         notes = :notes
       WHERE id = :id`,
      {
        id,
        vendor_ref: data.vendorRef || null,
        po_date: data.poDate,
        vendor_id: data.vendorId,
        payment_term_trigger: trigger,
        payment_term_days: firstTermDays,
        ppn_rate: ppnRate,
        notes: data.notes || null,
      }
    );
    await conn.execute('DELETE FROM vendor_po_lines WHERE vendor_po_id = :id', { id });
    await insertLines(conn, id, data.lines || [], ppnRate);
    if (data.paymentTerms?.length) {
      await conn.execute('DELETE FROM vendor_po_payment_terms WHERE vendor_po_id = :id', { id });
      const maxDue = await insertTerms(conn, id, data.paymentTerms, {
        trigger,
        poDate: data.poDate,
        receivedAt,
      });
      if (maxDue) {
        await conn.execute(
          `UPDATE vendor_pos SET balance_due_date = :due WHERE id = :id`,
          { due: maxDue, id }
        );
      }
    }
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
  if (!vpo.lines?.length) { const e = new Error('PO tidak memiliki baris item'); e.status = 400; throw e; }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await applyConfirm(conn, id);
    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function recordReceipt(id, { receivedDate, receivedNotes, userId }) {
  const vpo = await findById(id);
  if (!vpo) { const e = new Error('PO Vendor tidak ditemukan'); e.status = 404; throw e; }
  if (vpo.status !== 'CONFIRMED') { const e = new Error('Hanya PO berstatus CONFIRMED yang dapat dicatat penerimaannya'); e.status = 400; throw e; }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let balanceDueDate = vpo.balance_due_date;

    if (vpo.payment_term_trigger === 'AFTER_GOODS_RECEIVED' && vpo.paymentTerms?.length) {
      const withDates = calcTermsDueDates(vpo.paymentTerms, {
        trigger: 'AFTER_GOODS_RECEIVED',
        receivedAt: receivedDate,
      });
      for (const t of withDates) {
        await conn.execute(
          `UPDATE vendor_po_payment_terms SET due_date = :due WHERE id = :id`,
          { due: t.due_date || null, id: t.id }
        );
      }
      balanceDueDate = maxDueDate(withDates);
    }

    await conn.execute(
      `UPDATE vendor_pos SET status = 'RECEIVED',
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
    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function markTermPaid(id, termId, paidAt) {
  await pool.execute(
    `UPDATE vendor_po_payment_terms SET paid_at = :paid_at
      WHERE id = :term_id AND vendor_po_id = :vpo_id`,
    { term_id: termId, vpo_id: id, paid_at: paidAt || null }
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

module.exports = {
  list,
  findById,
  create,
  update,
  confirm,
  recordReceipt,
  complete,
  cancel,
  destroy,
  markTermPaid,
};
