const { validationResult } = require('express-validator');
const vendorModel = require('../models/vendorModel');

function toPublic(v) {
  if (!v) return null;
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    contactPerson: v.contact_person,
    phone: v.phone,
    email: v.email,
    address: v.address,
    isActive: !!v.is_active,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
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
    const { search, includeInactive } = req.query;
    const rows = await vendorModel.list({ search, includeInactive: includeInactive === 'true' });
    res.json({ data: rows.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const vendor = await vendorModel.findById(req.params.id);
    if (!vendor) return res.status(404).json({ message: 'Vendor tidak ditemukan' });
    res.json({ data: toPublic(vendor) });
  } catch (err) {
    next(err);
  }
}

async function store(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const vendor = await vendorModel.create(req.body);
    res.status(201).json({ data: toPublic(vendor), message: 'Vendor berhasil dibuat' });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  if (handleValidation(req, res)) return;
  try {
    const existing = await vendorModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Vendor tidak ditemukan' });
    const vendor = await vendorModel.update(req.params.id, req.body);
    res.json({ data: toPublic(vendor), message: 'Vendor berhasil diperbarui' });
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const existing = await vendorModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Vendor tidak ditemukan' });
    await vendorModel.softDelete(req.params.id);
    res.json({ message: 'Vendor dinonaktifkan' });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, show, store, update, destroy };
