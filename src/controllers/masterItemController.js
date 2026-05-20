const { validationResult } = require('express-validator');
const masterItemModel = require('../models/masterItemModel');

function toPublic(m) {
  if (!m) return null;
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    category: m.category,
    unit: m.unit,
    stdSize: m.std_size,
    version: m.version,
    sourcePoLineId: m.source_po_line_id,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
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
    const items = await masterItemModel.list({
      category: req.query.category,
      search: req.query.search,
    });
    res.json({ data: items.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const item = await masterItemModel.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item tidak ditemukan' });
    res.json({ data: toPublic(item) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const existing = await masterItemModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Item tidak ditemukan' });
    const item = await masterItemModel.update(req.params.id, req.body);
    res.json({ data: toPublic(item) });
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const existing = await masterItemModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Item tidak ditemukan' });
    await masterItemModel.remove(req.params.id);
    res.json({ message: 'Item dihapus' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

module.exports = { index, show, update, destroy };
