const { validationResult } = require('express-validator');
const vendorPoModel = require('../models/vendorPoModel');

const STATUS_LABELS = {
  DRAFT: 'Draft',
  CONFIRMED: 'Dikonfirmasi',
  RECEIVED: 'Barang Diterima',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

function toPublicLine(l) {
  return {
    id: l.id,
    vendorPoId: l.vendor_po_id,
    lineNo: l.line_no,
    itemName: l.item_name,
    masterItemId: l.master_item_id,
    qty: Number(l.qty),
    unit: l.unit,
    unitPrice: Number(l.unit_price),
    ppnIncluded: !!l.ppn_included,
    lineAmount: Number(l.line_amount),
    stdSize: l.std_size,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    poNumber: row.po_number,
    vendorRef: row.vendor_ref,
    poDate: row.po_date,
    vendor: {
      id: row.vendor_id,
      code: row.vendor_code,
      name: row.vendor_name,
      phone: row.vendor_phone,
    },
    paymentMode: row.payment_mode,
    dpAmount: row.dp_amount ? Number(row.dp_amount) : null,
    dpDueDate: row.dp_due_date,
    balanceDueDate: row.balance_due_date,
    paymentTermDays: row.payment_term_days,
    ppnRate: Number(row.ppn_rate ?? 11),
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    confirmedAt: row.confirmed_at,
    receivedAt: row.received_at,
    receivedNotes: row.received_notes,
    receivedBy: row.received_by,
    receivedByName: row.received_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: (row.lines || []).map(toPublicLine),
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

async function index(req, res, next) {
  try {
    const { status, vendorId, search } = req.query;
    const rows = await vendorPoModel.list({ status, vendorId, search });
    res.json({ data: rows.map(toPublic) });
  } catch (err) { next(err); }
}

async function show(req, res, next) {
  try {
    const vpo = await vendorPoModel.findById(req.params.id);
    if (!vpo) return res.status(404).json({ message: 'PO Vendor tidak ditemukan' });
    res.json({ data: toPublic(vpo) });
  } catch (err) { next(err); }
}

async function store(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const vpo = await vendorPoModel.create(req.body, req.user?.id);
    res.status(201).json({ data: toPublic(vpo), message: 'PO Vendor berhasil dibuat' });
  } catch (err) { next(err); }
}

async function update(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const existing = await vendorPoModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'PO Vendor tidak ditemukan' });
    if (existing.status !== 'DRAFT') return res.status(400).json({ message: 'Hanya PO DRAFT yang dapat diubah' });
    const vpo = await vendorPoModel.update(req.params.id, req.body);
    res.json({ data: toPublic(vpo), message: 'PO Vendor berhasil diperbarui' });
  } catch (err) { next(err); }
}

async function destroy(req, res, next) {
  try {
    await vendorPoModel.destroy(req.params.id);
    res.json({ message: 'PO Vendor dihapus' });
  } catch (err) { next(err); }
}

async function confirmPo(req, res, next) {
  try {
    const vpo = await vendorPoModel.confirm(req.params.id);
    res.json({ data: toPublic(vpo), message: 'PO Vendor dikonfirmasi' });
  } catch (err) { next(err); }
}

async function receiveGoods(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const vpo = await vendorPoModel.recordReceipt(req.params.id, {
      receivedDate: req.body.receivedDate,
      receivedNotes: req.body.receivedNotes,
      userId: req.user?.id,
    });
    res.json({ data: toPublic(vpo), message: 'Penerimaan barang dicatat' });
  } catch (err) { next(err); }
}

async function completePo(req, res, next) {
  try {
    const vpo = await vendorPoModel.complete(req.params.id);
    res.json({ data: toPublic(vpo), message: 'PO Vendor diselesaikan' });
  } catch (err) { next(err); }
}

async function cancelPo(req, res, next) {
  try {
    const vpo = await vendorPoModel.cancel(req.params.id);
    res.json({ data: toPublic(vpo), message: 'PO Vendor dibatalkan' });
  } catch (err) { next(err); }
}

module.exports = { index, show, store, update, destroy, confirmPo, receiveGoods, completePo, cancelPo };
