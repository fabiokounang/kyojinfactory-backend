const { validationResult } = require('express-validator');
const customerInvoiceModel = require('../models/customerInvoiceModel');

const STATUS_LABELS = {
  DRAFT: 'Draft',
  ISSUED: 'Diterbitkan',
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
};

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    customerPoId: row.customer_po_id,
    poNumber: row.po_number,
    cpoStatus: row.cpo_status,
    customerPoPaymentTermId: row.customer_po_payment_term_id,
    termLabel: row.term_label,
    termNo: row.term_no,
    customer: {
      id: row.customer_id,
      code: row.customer_code,
      name: row.customer_name,
    },
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    subtotal: Number(row.subtotal),
    ppnAmount: Number(row.ppn_amount),
    total: Number(row.total),
    ppnRate: Number(row.ppn_rate ?? 11),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    paidAt: row.paid_at,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      message: 'Permintaan tidak valid',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
    return true;
  }
  return false;
}

async function listInvoices(req, res, next) {
  try {
    const { status, customerPoId, search } = req.query;
    const rows = await customerInvoiceModel.list({
      status,
      customerPoId: customerPoId ? Number(customerPoId) : undefined,
      search,
    });
    res.json({ data: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function getEligiblePos(req, res, next) {
  try {
    const rows = await customerInvoiceModel.findEligiblePos();
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        poNumber: r.po_number,
        poDate: r.po_date,
        status: r.status,
        poTotal: r.po_total,
        customer: { id: r.customer_id, code: r.customer_code, name: r.customer_name },
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getPrefill(req, res, next) {
  try {
    const termId = req.query.paymentTermId ? Number(req.query.paymentTermId) : null;
    const result = await customerInvoiceModel.prefill(req.params.customerPoId, termId);
    if (!result) return res.status(404).json({ message: 'PO Customer tidak ditemukan' });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function getInvoice(req, res, next) {
  try {
    const row = await customerInvoiceModel.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Faktur tidak ditemukan' });
    res.json({ data: toPublic(row) });
  } catch (err) {
    next(err);
  }
}

async function createInvoice(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const inv = await customerInvoiceModel.create(req.body, req.user?.id);
    res.status(201).json({ data: toPublic(inv), message: 'Faktur penjualan berhasil dibuat' });
  } catch (err) {
    next(err);
  }
}

async function updateInvoice(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const inv = await customerInvoiceModel.update(req.params.id, req.body);
    res.json({ data: toPublic(inv), message: 'Faktur berhasil diperbarui' });
  } catch (err) {
    next(err);
  }
}

async function deleteInvoice(req, res, next) {
  try {
    await customerInvoiceModel.destroy(req.params.id);
    res.json({ message: 'Faktur berhasil dihapus' });
  } catch (err) {
    next(err);
  }
}

async function issueInvoice(req, res, next) {
  try {
    const inv = await customerInvoiceModel.issue(req.params.id);
    res.json({ data: toPublic(inv), message: 'Faktur diterbitkan' });
  } catch (err) {
    next(err);
  }
}

async function markPaid(req, res, next) {
  try {
    const { paidAt } = req.body || {};
    const inv = await customerInvoiceModel.markPaid(req.params.id, paidAt || null);
    res.json({ data: toPublic(inv), message: 'Faktur ditandai lunas' });
  } catch (err) {
    next(err);
  }
}

async function cancelInvoice(req, res, next) {
  try {
    const inv = await customerInvoiceModel.cancel(req.params.id);
    res.json({ data: toPublic(inv), message: 'Faktur dibatalkan' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listInvoices,
  getEligiblePos,
  getPrefill,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  issueInvoice,
  markPaid,
  cancelInvoice,
};
