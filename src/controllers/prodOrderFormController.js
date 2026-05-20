const { validationResult } = require('express-validator');
const prodOrderFormModel = require('../models/prodOrderFormModel');

function toPublicLine(l) {
  return {
    id: l.id,
    prodOrderFormId: l.prod_order_form_id,
    customerPoLineId: l.customer_po_line_id,
    lineNo: l.line_no,
    productNumber: l.product_number,
    itemName: l.item_name,
    cpoQty: l.cpo_qty ? Number(l.cpo_qty) : null,
    qtyToProduce: Number(l.qty_to_produce),
    unit: l.unit,
    bomVersionId: l.bom_version_id,
    bomVersionName: l.bom_version_name,
    bomVersionStatus: l.bom_version_status,
    startDate: l.start_date,
    endDate: l.end_date,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };
}

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    pofNumber: row.pof_number,
    customerPoId: row.customer_po_id,
    poNumber: row.po_number,
    cpoStatus: row.cpo_status,
    customer: {
      id: row.customer_id,
      code: row.customer_code,
      name: row.customer_name,
    },
    status: row.status,
    supervisorUserId: row.supervisor_user_id,
    supervisorName: row.supervisor_name,
    issuedByUserId: row.issued_by_user_id,
    issuedByName: row.issued_by_name,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    notes: row.notes,
    releasedAt: row.released_at,
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

async function listPofs(req, res, next) {
  try {
    const { status, search } = req.query;
    const rows = await prodOrderFormModel.list({ status, search });
    res.json({ data: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function getEligibleCustomerPos(req, res, next) {
  try {
    const rows = await prodOrderFormModel.findEligibleCustomerPos();
    res.json({
      data: rows.map((r) => ({
        id: r.id,
        poNumber: r.po_number,
        poDate: r.po_date,
        customer: { id: r.customer_id, code: r.customer_code, name: r.customer_name },
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getPrefill(req, res, next) {
  try {
    const result = await prodOrderFormModel.prefill(req.params.customerPoId);
    if (!result) return res.status(404).json({ message: 'PO Customer tidak ditemukan' });
    const { po, lines } = result;
    res.json({
      data: {
        po: {
          id: po.id,
          poNumber: po.po_number,
          poDate: po.po_date,
          customer: { id: po.customer_id, code: po.customer_code, name: po.customer_name },
        },
        lines: lines.map((l, i) => ({
          customerPoLineId: l.customer_po_line_id,
          lineNo: l.line_no || i + 1,
          itemName: l.item_name,
          productNumber: l.product_number,
          cpoQty: Number(l.qty),
          unit: l.unit,
          masterItemId: l.master_item_id,
          bomVersionId: l.bom_version_id,
          bomVersionName: l.bom_version_name,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getPof(req, res, next) {
  try {
    const row = await prodOrderFormModel.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'POF tidak ditemukan' });
    res.json({ data: toPublic(row) });
  } catch (err) {
    next(err);
  }
}

async function createPof(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const { customerPoId, supervisorUserId, issuedByUserId, notes, lines } = req.body;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const dateKey = `${dd}${mm}${yyyy}`;

    const pof = await prodOrderFormModel.create({
      customerPoId,
      supervisorUserId: supervisorUserId || null,
      issuedByUserId: issuedByUserId || req.user?.id || null,
      createdBy: req.user?.id || null,
      notes,
      lines,
      dateKey,
    });
    res.status(201).json({ data: toPublic(pof), message: 'POF berhasil dibuat' });
  } catch (err) {
    next(err);
  }
}

async function updatePof(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const existing = await prodOrderFormModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'POF tidak ditemukan' });
    if (existing.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya POF berstatus DRAFT yang dapat diubah' });
    }
    const { supervisorUserId, issuedByUserId, notes, lines } = req.body;
    const pof = await prodOrderFormModel.update(req.params.id, {
      supervisorUserId,
      issuedByUserId,
      notes,
      lines,
    });
    res.json({ data: toPublic(pof), message: 'POF berhasil diperbarui' });
  } catch (err) {
    next(err);
  }
}

async function deletePof(req, res, next) {
  try {
    await prodOrderFormModel.destroy(req.params.id);
    res.json({ message: 'POF berhasil dihapus' });
  } catch (err) {
    next(err);
  }
}

async function releasePof(req, res, next) {
  try {
    const pof = await prodOrderFormModel.release(req.params.id);
    res.json({ data: toPublic(pof), message: 'POF di-release — PO Customer beralih ke IN_PRODUCTION' });
  } catch (err) {
    next(err);
  }
}

async function cancelPof(req, res, next) {
  try {
    const pof = await prodOrderFormModel.cancel(req.params.id);
    res.json({ data: toPublic(pof), message: 'POF dibatalkan' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPofs,
  getEligibleCustomerPos,
  getPrefill,
  getPof,
  createPof,
  updatePof,
  deletePof,
  releasePof,
  cancelPof,
};
