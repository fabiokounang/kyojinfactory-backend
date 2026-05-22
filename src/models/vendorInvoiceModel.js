const { pool } = require('../config/database');
const vendorPoModel = require('./vendorPoModel');
const { nextVendorInvoiceNumber } = require('../services/invoiceNumberService');
const { poGrandTotal, termAmount, totalToBreakdown } = require('../services/invoiceAmountService');

const HEADER_COLS = [
  'vi.id',
  'vi.invoice_number',
  'vi.vendor_po_id',
  'vi.vendor_invoice_number',
  'vi.vendor_po_payment_term_id',
  'vi.received_date',
  'vi.invoice_date',
  'vi.due_date',
  'vi.subtotal',
  'vi.ppn_amount',
  'vi.total',
  'vi.status',
  'vi.paid_at',
  'vi.notes',
  'vi.created_by',
  'vi.created_at',
  'vi.updated_at',
  'vp.po_number',
  'vp.status AS vpo_status',
  'vp.ppn_rate',
  'v.id AS vendor_id',
  'v.code AS vendor_code',
  'v.name AS vendor_name',
  'vpt.label AS term_label',
  'vpt.term_no',
  'u.full_name AS created_by_name',
].join(', ');

async function headerQuery(where, params, limit = '') {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM vendor_invoices vi
       JOIN vendor_pos vp ON vp.id = vi.vendor_po_id
       JOIN vendors v ON v.id = vp.vendor_id
       LEFT JOIN vendor_po_payment_terms vpt ON vpt.id = vi.vendor_po_payment_term_id
       LEFT JOIN users u ON u.id = vi.created_by
      ${where}
      ORDER BY vi.invoice_date DESC, vi.id DESC
      ${limit}`,
    params
  );
}

async function list({ status, vendorPoId, search } = {}) {
  const where = [];
  const params = {};
  if (status) { where.push('vi.status = :status'); params.status = status; }
  if (vendorPoId) { where.push('vi.vendor_po_id = :vendor_po_id'); params.vendor_po_id = vendorPoId; }
  if (search) {
    where.push('(vi.invoice_number LIKE :s OR vi.vendor_invoice_number LIKE :s OR vp.po_number LIKE :s OR v.name LIKE :s)');
    params.s = `%${search}%`;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await headerQuery(clause, params);
  return rows;
}

async function findById(id) {
  const [rows] = await headerQuery('WHERE vi.id = :id', { id }, 'LIMIT 1');
  return rows[0] || null;
}

async function findEligiblePos() {
  const [rows] = await pool.execute(
    `SELECT vp.id, vp.po_number, vp.po_date, vp.status,
            v.id AS vendor_id, v.code AS vendor_code, v.name AS vendor_name,
            COALESCE(SUM(vpl.line_amount), 0) AS po_total
       FROM vendor_pos vp
       JOIN vendors v ON v.id = vp.vendor_id
       LEFT JOIN vendor_po_lines vpl ON vpl.vendor_po_id = vp.id
      WHERE vp.status IN ('CONFIRMED', 'RECEIVED', 'COMPLETED')
      GROUP BY vp.id, vp.po_number, vp.po_date, vp.status, v.id, v.code, v.name
      ORDER BY vp.po_date DESC`
  );
  return rows.map((r) => ({ ...r, po_total: Number(r.po_total) }));
}

async function prefill(vendorPoId, paymentTermId = null) {
  const po = await vendorPoModel.findById(vendorPoId);
  if (!po) return null;
  if (!['CONFIRMED', 'RECEIVED', 'COMPLETED'].includes(po.status)) {
    const err = new Error('PO Vendor belum dikonfirmasi — tidak bisa buat faktur');
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
      vendor: { id: po.vendor_id, code: po.vendor_code, name: po.vendor_name },
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
      vendorPoPaymentTermId: term?.id ?? null,
      dueDate: term?.due_date ?? po.balance_due_date ?? null,
      ...breakdown,
    },
  };
}

async function create(data, userId) {
  const pre = await prefill(data.vendorPoId, data.vendorPoPaymentTermId || null);
  if (!pre) {
    const err = new Error('PO Vendor tidak ditemukan');
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
    const invoiceNumber = await nextVendorInvoiceNumber(conn, data.invoiceDate);
    const [result] = await conn.execute(
      `INSERT INTO vendor_invoices
         (invoice_number, vendor_po_id, vendor_invoice_number, vendor_po_payment_term_id,
          received_date, invoice_date, due_date, subtotal, ppn_amount, total,
          status, notes, created_by)
       VALUES (:invoice_number, :vendor_po_id, :vendor_invoice_number, :term_id,
               :received_date, :invoice_date, :due_date, :subtotal, :ppn_amount, :total,
               'DRAFT', :notes, :created_by)`,
      {
        invoice_number: invoiceNumber,
        vendor_po_id: data.vendorPoId,
        vendor_invoice_number: data.vendorInvoiceNumber || null,
        term_id: data.vendorPoPaymentTermId || null,
        received_date: data.receivedDate || data.invoiceDate,
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
    `UPDATE vendor_invoices
        SET vendor_invoice_number = :vendor_invoice_number,
            vendor_po_payment_term_id = :term_id,
            received_date = :received_date,
            invoice_date = :invoice_date,
            due_date = :due_date,
            subtotal = :subtotal,
            ppn_amount = :ppn_amount,
            total = :total,
            notes = :notes
      WHERE id = :id AND status = 'DRAFT'`,
    {
      id,
      vendor_invoice_number: data.vendorInvoiceNumber ?? existing.vendor_invoice_number,
      term_id: data.vendorPoPaymentTermId ?? existing.vendor_po_payment_term_id,
      received_date: data.receivedDate ?? existing.received_date,
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

async function verify(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('Faktur tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error('Hanya faktur DRAFT yang dapat diverifikasi');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `UPDATE vendor_invoices SET status = 'VERIFIED' WHERE id = :id`,
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
  if (existing.status !== 'VERIFIED') {
    const err = new Error('Hanya faktur VERIFIED yang dapat ditandai lunas');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `UPDATE vendor_invoices SET status = 'PAID', paid_at = :paid_at WHERE id = :id`,
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
    `UPDATE vendor_invoices SET status = 'CANCELLED' WHERE id = :id`,
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
  await pool.execute(`DELETE FROM vendor_invoices WHERE id = :id`, { id });
  return true;
}

module.exports = {
  list,
  findById,
  findEligiblePos,
  prefill,
  create,
  update,
  verify,
  markPaid,
  cancel,
  destroy,
};
