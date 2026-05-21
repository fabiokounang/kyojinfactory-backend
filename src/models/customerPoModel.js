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

const TERM_COLS = [
  'id', 'customer_po_id', 'term_no', 'label',
  'amount_type', 'amount_value', 'term_days', 'due_date', 'paid_at',
  'created_at', 'updated_at',
].join(', ');

/** Status yang masih boleh diubah isian PO (koreksi) */
const EDITABLE_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_PRODUCTION'];

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

/**
 * Compute due_date per term based on trigger and relevant date.
 * Returns the same term object with due_date filled in.
 */
function calcTermsDueDates(terms, { trigger, poDate, customerReceivedAt }) {
  return terms.map((t) => {
    let due = null;
    if (trigger === 'AFTER_PO_ISSUED' && poDate) {
      due = addDays(poDate, t.term_days ?? t.termDays ?? 0);
    } else if (trigger === 'AFTER_GOODS_RECEIVED' && customerReceivedAt) {
      due = addDays(customerReceivedAt, t.term_days ?? t.termDays ?? 0);
    }
    return { ...t, due_date: due };
  });
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
  const [terms] = await pool.execute(
    `SELECT ${TERM_COLS} FROM customer_po_payment_terms WHERE customer_po_id = :id ORDER BY term_no ASC`,
    { id }
  );
  return { ...header, lines, paymentTerms: terms };
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
    if (data.paymentTerms && data.paymentTerms.length > 0) {
      await insertTerms(conn, poId, data.paymentTerms, {
        trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        poDate: data.poDate,
      });
      // Update header due_date to the max term due_date (for list compatibility)
      const withDates = calcTermsDueDates(data.paymentTerms, {
        trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        poDate: data.poDate,
      });
      const maxDue = withDates.reduce((m, t) => (!t.due_date ? m : (!m || t.due_date > m ? t.due_date : m)), null);
      if (maxDue) {
        await conn.execute(`UPDATE customer_pos SET due_date = :due WHERE id = :id`, { due: maxDue, id: poId });
      }
    }
    await applyConfirm(conn, poId, userId);
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

async function update(id, data, userId) {
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
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      const err = new Error('PO dengan status ' + existing.status + ' tidak dapat diubah');
      err.status = 400;
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
    if (existing.status === 'DRAFT') {
      await conn.execute('DELETE FROM customer_po_lines WHERE customer_po_id = :id', { id });
      await insertLines(conn, id, data.lines || [], ppnRate);
    } else {
      await syncLinesForConfirmedPo(conn, id, data.lines || [], ppnRate, existing, userId);
    }
    if (data.paymentTerms && data.paymentTerms.length > 0) {
      await conn.execute('DELETE FROM customer_po_payment_terms WHERE customer_po_id = :id', { id });
      await insertTerms(conn, id, data.paymentTerms, {
        trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        poDate: data.poDate,
        customerReceivedAt: existing.customer_received_at || null,
      });
      const withDates = calcTermsDueDates(data.paymentTerms, {
        trigger: data.paymentTermTrigger || 'AFTER_PO_ISSUED',
        poDate: data.poDate,
        customerReceivedAt: existing.customer_received_at || null,
      });
      const maxDue = withDates.reduce((m, t) => (!t.due_date ? m : (!m || t.due_date > m ? t.due_date : m)), null);
      if (maxDue) {
        await conn.execute(`UPDATE customer_pos SET due_date = :due WHERE id = :id`, { due: maxDue, id });
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

async function insertTerms(conn, poId, terms, { trigger, poDate, customerReceivedAt } = {}) {
  const withDates = calcTermsDueDates(terms, { trigger, poDate, customerReceivedAt });
  let termNo = 1;
  for (const t of withDates) {
    await conn.execute(
      `INSERT INTO customer_po_payment_terms
         (customer_po_id, term_no, label, amount_type, amount_value, term_days, due_date)
       VALUES (:po_id, :term_no, :label, :amount_type, :amount_value, :term_days, :due_date)`,
      {
        po_id: poId,
        term_no: termNo++,
        label: t.label || null,
        amount_type: t.amountType || t.amount_type || 'PERCENT',
        amount_value: Number(t.amountValue ?? t.amount_value ?? 0),
        term_days: Number(t.termDays ?? t.term_days ?? 0),
        due_date: t.due_date || null,
      }
    );
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

async function confirmLine(conn, header, line, userId) {
  if (line.master_item_id && line.item_code) return;

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

  const existingTask = await taskModel.findOpenForLine(conn, 'CREATE_BOM', line.id);
  if (!existingTask) {
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

async function applyConfirm(conn, poId, userId) {
  const header = await findHeaderByConn(conn, poId);
  if (!header) {
    const err = new Error('PO tidak ditemukan');
    err.status = 404;
    throw err;
  }

  const [lines] = await conn.execute(
    `SELECT ${LINE_COLS} FROM customer_po_lines WHERE customer_po_id = :id ORDER BY line_no ASC`,
    { id: poId }
  );
  if (lines.length === 0) {
    const err = new Error('PO tidak memiliki baris item');
    err.status = 400;
    throw err;
  }

  for (const line of lines) {
    await confirmLine(conn, header, line, userId);
  }

  await conn.execute(
    `UPDATE customer_pos
       SET status = 'CONFIRMED',
           confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP)
     WHERE id = :id`,
    { id: poId }
  );
}

async function syncLinesForConfirmedPo(conn, poId, newLines, ppnRate, header, userId) {
  const [existing] = await conn.execute(
    `SELECT ${LINE_COLS} FROM customer_po_lines WHERE customer_po_id = :id ORDER BY line_no ASC, id ASC`,
    { id: poId }
  );

  for (let i = 0; i < newLines.length; i++) {
    const nl = newLines[i];
    const qty = Number(nl.qty || 0);
    const unitPrice = Number(nl.unitPrice || 0);
    const ppnIncluded = nl.ppnIncluded !== false;
    const lineAmount = calcLineAmount(qty, unitPrice, ppnIncluded, ppnRate);

    if (i < existing.length) {
      const el = existing[i];
      await conn.execute(
        `UPDATE customer_po_lines SET
           line_no = :line_no,
           item_name = :item_name,
           qty = :qty,
           unit = :unit,
           unit_price = :unit_price,
           ppn_included = :ppn_included,
           line_amount = :line_amount
         WHERE id = :id`,
        {
          id: el.id,
          line_no: i + 1,
          item_name: nl.itemName,
          qty,
          unit: nl.unit || 'pcs',
          unit_price: unitPrice,
          ppn_included: ppnIncluded ? 1 : 0,
          line_amount: lineAmount,
        }
      );
      if (el.master_item_id) {
        await conn.execute(
          `UPDATE master_items SET name = :name, unit = :unit WHERE id = :id`,
          { id: el.master_item_id, name: nl.itemName, unit: nl.unit || 'pcs' }
        );
      }
    } else {
      const [result] = await conn.execute(
        `INSERT INTO customer_po_lines
           (customer_po_id, line_no, item_name, qty, unit, unit_price, ppn_included, line_amount)
         VALUES (:po_id, :line_no, :item_name, :qty, :unit, :unit_price, :ppn_included, :line_amount)`,
        {
          po_id: poId,
          line_no: i + 1,
          item_name: nl.itemName,
          qty,
          unit: nl.unit || 'pcs',
          unit_price: unitPrice,
          ppn_included: ppnIncluded ? 1 : 0,
          line_amount: lineAmount,
        }
      );
      const [inserted] = await conn.execute(
        `SELECT ${LINE_COLS} FROM customer_po_lines WHERE id = :id LIMIT 1`,
        { id: result.insertId }
      );
      if (inserted[0]) await confirmLine(conn, header, inserted[0], userId);
    }
  }
}

async function confirm(id, userId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const header = await findHeaderByConn(conn, id);
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

    await applyConfirm(conn, id, userId);
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

  // Legacy due_date for header (single-term backward compat)
  const dueDate = existing.payment_term_trigger === 'AFTER_GOODS_RECEIVED'
    ? calcDueDate({
        trigger: 'AFTER_GOODS_RECEIVED',
        days: existing.payment_term_days,
        customerReceivedAt: receivedDate,
      })
    : existing.due_date;

  const newStatus = markCompleted === false ? existing.status : 'COMPLETED';

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
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

    // Recalculate term due_dates if trigger is AFTER_GOODS_RECEIVED
    if (existing.payment_term_trigger === 'AFTER_GOODS_RECEIVED' && existing.paymentTerms?.length > 0) {
      const withDates = calcTermsDueDates(existing.paymentTerms, {
        trigger: 'AFTER_GOODS_RECEIVED',
        customerReceivedAt: receivedDate,
      });
      for (const t of withDates) {
        await conn.execute(
          `UPDATE customer_po_payment_terms SET due_date = :due WHERE id = :id`,
          { due: t.due_date || null, id: t.id }
        );
      }
      // Update header due_date to max term due_date
      const maxDue = withDates.reduce((m, t) => (!t.due_date ? m : (!m || t.due_date > m ? t.due_date : m)), null);
      if (maxDue) {
        await conn.execute(`UPDATE customer_pos SET due_date = :due WHERE id = :id`, { due: maxDue, id });
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

async function markTermPaid(id, termId, paidAt) {
  await pool.execute(
    `UPDATE customer_po_payment_terms
        SET paid_at = :paid_at
      WHERE id = :term_id AND customer_po_id = :po_id`,
    { term_id: termId, po_id: id, paid_at: paidAt || null }
  );
  return findById(id);
}

module.exports = { list, findById, create, update, destroy, confirm, cancel, recordReceipt, markTermPaid };
