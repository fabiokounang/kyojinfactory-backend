const { validationResult } = require('express-validator');
const customerPoModel = require('../models/customerPoModel');
const customerModel = require('../models/customerModel');
const { previewFgCode } = require('../services/itemCodeService');

function toPublicLine(l) {
  return {
    id: l.id,
    lineNo: l.line_no,
    itemName: l.item_name,
    itemCode: l.item_code,
    qty: Number(l.qty),
    unit: l.unit,
    unitPrice: Number(l.unit_price),
    ppnIncluded: !!l.ppn_included,
    lineAmount: Number(l.line_amount),
    masterItemId: l.master_item_id,
    stdSize: l.std_size,
  };
}

function toPublic(po) {
  if (!po) return null;
  return {
    id: po.id,
    poNumber: po.po_number,
    customerPoRef: po.customer_po_ref,
    poDate: po.po_date,
    customer: {
      id: po.customer_id,
      code: po.customer_code,
      name: po.customer_name,
    },
    paymentTermTrigger: po.payment_term_trigger,
    paymentTermDays: po.payment_term_days,
    dueDate: po.due_date,
    ppnRate: Number(po.ppn_rate ?? 11),
    status: po.status,
    notes: po.notes,
    createdBy: po.created_by,
    confirmedAt: po.confirmed_at,
    customerReceivedAt: po.customer_received_at,
    customerReceivedNotes: po.customer_received_notes,
    customerReceivedBy: po.customer_received_by,
    createdAt: po.created_at,
    updatedAt: po.updated_at,
    lines: (po.lines || []).map(toPublicLine),
  };
}

function toPublicListItem(po) {
  return {
    id: po.id,
    poNumber: po.po_number,
    customerPoRef: po.customer_po_ref,
    poDate: po.po_date,
    customer: {
      id: po.customer_id,
      code: po.customer_code,
      name: po.customer_name,
    },
    paymentTermTrigger: po.payment_term_trigger,
    paymentTermDays: po.payment_term_days,
    dueDate: po.due_date,
    ppnRate: Number(po.ppn_rate ?? 11),
    status: po.status,
    confirmedAt: po.confirmed_at,
    customerReceivedAt: po.customer_received_at,
    createdAt: po.created_at,
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
    const list = await customerPoModel.list({
      status: req.query.status,
      customerId: req.query.customerId,
      search: req.query.search,
    });
    res.json({ data: list.map(toPublicListItem) });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const po = await customerPoModel.findById(req.params.id);
    if (!po) return res.status(404).json({ message: 'PO tidak ditemukan' });
    res.json({ data: toPublic(po) });
  } catch (err) {
    next(err);
  }
}

async function store(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const customer = await customerModel.findById(req.body.customerId);
    if (!customer) return res.status(400).json({ message: 'Customer tidak ditemukan' });
    const po = await customerPoModel.create(req.body, req.user?.id);
    res.status(201).json({ data: toPublic(po) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const existing = await customerPoModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'PO tidak ditemukan' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya PO DRAFT yang dapat diubah' });
    }
    const customer = await customerModel.findById(req.body.customerId);
    if (!customer) return res.status(400).json({ message: 'Customer tidak ditemukan' });
    const po = await customerPoModel.update(req.params.id, req.body);
    res.json({ data: toPublic(po) });
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const existing = await customerPoModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'PO tidak ditemukan' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya PO DRAFT yang dapat dihapus' });
    }
    await customerPoModel.destroy(req.params.id);
    res.json({ message: 'PO dihapus' });
  } catch (err) {
    next(err);
  }
}

async function confirm(req, res, next) {
  try {
    const po = await customerPoModel.confirm(req.params.id, req.user?.id);
    res.json({ data: toPublic(po) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const po = await customerPoModel.cancel(req.params.id);
    if (!po) return res.status(404).json({ message: 'PO tidak ditemukan' });
    res.json({ data: toPublic(po) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
}

async function recordReceipt(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const po = await customerPoModel.recordReceipt(req.params.id, {
      receivedDate: req.body.receivedDate,
      notes: req.body.notes,
      markCompleted: req.body.markCompleted,
      userId: req.user?.id,
    });
    res.json({ data: toPublic(po) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

async function previewCode(req, res, next) {
  try {
    const code = await previewFgCode(req.query.name || '');
    res.json({ data: { code } });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, show, store, update, destroy, confirm, cancel, recordReceipt, previewCode };
