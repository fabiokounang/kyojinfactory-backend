const { pool } = require('../config/database');
const customerPoModel = require('./customerPoModel');
const { nextCustomerInvoiceNumber } = require('../services/invoiceNumberService');
const { poGrandTotal, termAmount, totalToBreakdown } = require('../services/invoiceAmountService');

const HEADER_COLS = [
  'ci.id',
  'ci.invoice_number',
  'ci.customer_po_id',
  'ci.customer_po_payment_term_id',
  'ci.invoice_date',
  'ci.due_date',
  'ci.subtotal',
  'ci.ppn_amount',
  'ci.total',
  'ci.status',
  'ci.paid_at',
  'ci.notes',
  'ci.created_by',
  'ci.created_at',
  'ci.updated_at',
  'cp.po_number',
  'cp.status AS cpo_status',
  'cp.ppn_rate',
  'c.id AS customer_id',
  'c.code AS customer_code',
  'c.name AS customer_name',
  'cpt.label AS term_label',
  'cpt.term_no',
  'u.full_name AS created_by_name',
].join(', ');

async function headerQuery(where, params, limit = '') {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM customer_invoices ci
       JOIN customer_pos cp ON cp.id = ci.customer_po_id
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN customer_po_payment_terms cpt ON cpt.id = ci.customer_po_payment_term_id
       LEFT JOIN users u ON u.id = ci.created_by
      ${where}
      ORDER BY ci.invoice_date DESC, ci.id DESC
      ${limit}`,
    params
  );
}

async function list({ status, customerPoId, search } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('ci.status = :status'); params.status = status; }
  if (customerPoId) { where.push('ci.customer_po_id = :customer_po_id'); params.customer_po_id = customerPoId; }
  if (search) {
    where.push('(ci.invoice_number LIKE :s OR cp.po_number LIKE :s OR c.name LIKE :s)');
    params.s = `%${search}%`;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await headerQuery(clause, params);
  return rows;
}

async function findById(id) {
  const [rows] = await headerQuery('WHERE ci.id = :id', { id }, 'LIMIT 1');
  return rows[0] || null;
}

async function findEligiblePos() {
  const [rows] = await pool.execute(
    `SELECT cp.id, cp.po_number, cp.po_date, cp.status,
            c.id AS customer_id, c.code AS customer_code, c.name AS customer_name,
            COALESCE(SUM(cpl.line_amount), 0) AS po_total
       FROM customer_pos cp
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN customer_po_lines cpl ON cpl.customer_po_id = cp.id
      WHERE cp.status IN ('CONFIRMED', 'IN_PRODUCTION', 'COMPLETED')
      GROUP BY cp.id, cp.po_number, cp.po_date, cp.status, c.id, c.code, c.name
      ORDER BY cp.po_date DESC`
  );
  return rows.map((r) => ({ ...r, po_total: Number(r.po_total) }));
}

async function prefill(customerPoId, paymentTermId = null) {
  const po = await customerPoModel.findById(customerPoId);
  if (!po) return null;
  if (!['CONFIRMED', 'IN_PRODUCTION', 'COMPLETED'].includes(po.status)) {
    const err = new Error('PO Customer belum dikonfirmasi — tidak bisa buat faktur');
    err.status = 400;
    throw err;
  }
  const grandTotal = poGrandTotal(po.lines);
  const term = paymentTermId
    ? (po.paymentTerms || []).find((t) => t.id === Number(paymentTermId))
    : null;
  const suggestedTotal = term ? termAmount(term, grandTotal) : grandTotal;
  const breakdown = totalToBreakdown(suggestedTotal, po.ppn_rate);

  return {
    po: {
      id: po.id,
      poNumber: po.po_number,
      poDate: po.po_date,
      status: po.status,
      ppnRate: Number(po.ppn_rate),
      customer: { id: po.customer_id, code: po.customer_code, name: po.customer_name },
      grandTotal,
    },
    paymentTerms: (po.paymentTerms || []).map((t) => ({
      id: t.id,
      termNo: t.term_no,
      label: t.label,
      amountType: t.amount_type,
      amountValue: Number(t.amount_value),
      termDays: t.term_days,
      dueDate: t.due_date,
      paidAt: t.paid_at,
      suggestedAmount: termAmount(t, grandTotal),
    })),
    suggested: {
      customerPoPaymentTermId: term?.id ?? null,
      dueDate: term?.due_date ?? po.due_date ?? null,
      ...breakdown,
    },
  };
}

async function create(data, userId) {
  const pre = await prefill(data.customerPoId, data.customerPoPaymentTermId || null);
  if (!pre) {
    const err = new Error('PO Customer tidak ditemukan');
    err.status = 404;
    throw err;
  }

  const total = Number(data.total ?? pre.suggested.total);
  if (total <= 0) {
    const err = new Error('Total faktur harus lebih dari 0');
    err.status = 400;
    throw err;
  }
  const breakdown = totalToBreakdown(total, pre.po.ppnRate);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const invoiceNumber = await nextCustomerInvoiceNumber(conn, data.invoiceDate);
    const [result] = await conn.execute(
      `INSERT INTO customer_invoices
         (invoice_number, customer_po_id, customer_po_payment_term_id,
          invoice_date, due_date, subtotal, ppn_amount, total,
          status, notes, created_by)
       VALUES (:invoice_number, :customer_po_id, :term_id,
               :invoice_date, :due_date, :subtotal, :ppn_amount, :total,
               'DRAFT', :notes, :created_by)`,
      {
        invoice_number: invoiceNumber,
        customer_po_id: data.customerPoId,
        term_id: data.customerPoPaymentTermId || null,
        invoice_date: data.invoiceDate,
        due_date: data.dueDate || pre.suggested.dueDate || null,
        subtotal: breakdown.subtotal,
        ppn_amount: breakdown.ppnAmount,
        total: breakdown.total,
        notes: data.notes || null,
        created_by: userId || null,
      }
    );
    await conn.commit();
    return findById(result.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function update(id, data) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error('Hanya faktur DRAFT yang dapat diubah');
    err.status = 400;
    throw err;
  }

  const total = Number(data.total ?? existing.total);
  const breakdown = totalToBreakdown(total, existing.ppn_rate);

  await pool.execute(
    `UPDATE customer_invoices
        SET customer_po_payment_term_id = :term_id,
            invoice_date = :invoice_date,
            due_date = :due_date,
            subtotal = :subtotal,
            ppn_amount = :ppn_amount,
            total = :total,
            notes = :notes
      WHERE id = :id AND status = 'DRAFT'`,
    {
      id,
      term_id: data.customerPoPaymentTermId ?? existing.customer_po_payment_term_id,
      invoice_date: data.invoiceDate ?? existing.invoice_date,
      due_date: data.dueDate ?? existing.due_date,
      subtotal: breakdown.subtotal,
      ppn_amount: breakdown.ppnAmount,
      total: breakdown.total,
      notes: data.notes ?? existing.notes,
    }
  );
  return findById(id);
}

async function issue(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error('Hanya faktur DRAFT yang dapat diterbitkan');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `UPDATE customer_invoices SET status = 'ISSUED' WHERE id = :id`,
    { id }
  );
  return findById(id);
}

async function markPaid(id, paidAt) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'ISSUED') {
    const err = new Error('Hanya faktur ISSUED yang dapat ditandai lunas');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `UPDATE customer_invoices SET status = 'PAID', paid_at = :paid_at WHERE id = :id`,
    { id, paid_at: paidAt || new Date().toISOString().slice(0, 10) }
  );
  return findById(id);
}

async function cancel(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status === 'PAID') {
    const err = new Error('Faktur yang sudah lunas tidak dapat dibatalkan');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `UPDATE customer_invoices SET status = 'CANCELLED' WHERE id = :id`,
    { id }
  );
  return findById(id);
}

async function destroy(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error('Hanya faktur DRAFT yang dapat dihapus');
    err.status = 400;
    throw err;
  }
  await pool.execute(`DELETE FROM customer_invoices WHERE id = :id`, { id });
  return true;
}

module.exports = {
  list,
  findById,
  findEligiblePos,
  prefill,
  create,
  update,
  issue,
  markPaid,
  cancel,
  destroy,
};
