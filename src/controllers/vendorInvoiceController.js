const { validationResult } = require('express-validator');
const vendorInvoiceModel = require('../models/vendorInvoiceModel');

const STATUS_LABELS = {
  DRAFT: 'Draft',
  VERIFIED: 'Terverifikasi',
  PAID: 'Lunas',
  CANCELLED: 'Dibatalkan',
};

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    vendorPoId: row.vendor_po_id,
    poNumber: row.po_number,
    vpoStatus: row.vpo_status,
    vendorInvoiceNumber: row.vendor_invoice_number,
    vendorPoPaymentTermId: row.vendor_po_payment_term_id,
    termLabel: row.term_label,
    termNo: row.term_no,
    vendor: {
      id: row.vendor_id,
      code: row.vendor_code,
      name: row.vendor_name,
    },
    receivedDate: row.received_date,
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
    const { status, vendorPoId, search } = req.query;
    const rows = await vendorInvoiceModel.list({
      status,
      vendorPoId: vendorPoId ? Number(vendorPoId) : undefined,
      search,
    });
    res.json({ data: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function getEligiblePos(req, res, next) {
  try {
    const rows = await vendorInvoiceModel.findEligiblePos();
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        poNumber: r.po_number,
        poDate: r.po_date,
        status: r.status,
        poTotal: r.po_total,
        vendor: { id: r.vendor_id, code: r.vendor_code, name: r.vendor_name },
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getPrefill(req, res, next) {
  try {
    const termId = req.query.paymentTermId ? Number(req.query.paymentTermId) : null;
    const result = await vendorInvoiceModel.prefill(req.params.vendorPoId, termId);
    if (!result) return res.status(404).json({ message: 'PO Vendor tidak ditemukan' });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
}

async function getInvoice(req, res, next) {
  try {
    const row = await vendorInvoiceModel.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Faktur tidak ditemukan' });
    res.json({ data: toPublic(row) });
  } catch (err) {
    next(err);
  }
}

async function createInvoice(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const inv = await vendorInvoiceModel.create(req.body, req.user?.id);
    res.status(201).json({ data: toPublic(inv), message: 'Faktur pembelian berhasil dibuat' });
  } catch (err) {
    next(err);
  }
}

async function updateInvoice(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const inv = await vendorInvoiceModel.update(req.params.id, req.body);
    res.json({ data: toPublic(inv), message: 'Faktur berhasil diperbarui' });
  } catch (err) {
    next(err);
  }
}

async function deleteInvoice(req, res, next) {
  try {
    await vendorInvoiceModel.destroy(req.params.id);
    res.json({ message: 'Faktur berhasil dihapus' });
  } catch (err) {
    next(err);
  }
}

async function verifyInvoice(req, res, next) {
  try {
    const inv = await vendorInvoiceModel.verify(req.params.id);
    res.json({ data: toPublic(inv), message: 'Faktur diverifikasi' });
  } catch (err) {
    next(err);
  }
}

async function markPaid(req, res, next) {
  try {
    const { paidAt } = req.body || {};
    const inv = await vendorInvoiceModel.markPaid(req.params.id, paidAt || null);
    res.json({ data: toPublic(inv), message: 'Faktur ditandai lunas' });
  } catch (err) {
    next(err);
  }
}

async function cancelInvoice(req, res, next) {
  try {
    const inv = await vendorInvoiceModel.cancel(req.params.id);
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
  verifyInvoice,
  markPaid,
  cancelInvoice,
};
