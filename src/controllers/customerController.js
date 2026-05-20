const { validationResult } = require('express-validator');
const customerModel = require('../models/customerModel');

function toPublic(c) {
  if (!c) return null;
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    contactPerson: c.contact_person,
    phone: c.phone,
    email: c.email,
    address: c.address,
    isActive: !!c.is_active,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
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
    const customers = await customerModel.list({
      search: req.query.search,
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ data: customers.map(toPublic) });
  } catch (err) {
    next(err);
  }
}

async function show(req, res, next) {
  try {
    const customer = await customerModel.findById(req.params.id);
    if (!customer) return res.status(404).json({ message: 'Customer tidak ditemukan' });
    res.json({ data: toPublic(customer) });
  } catch (err) {
    next(err);
  }
}

async function store(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    if (req.body.code) {
      const existing = await customerModel.findByCode(req.body.code);
      if (existing) {
        return res.status(409).json({ message: 'Kode customer sudah dipakai' });
      }
    }
    const created = await customerModel.create(req.body);
    res.status(201).json({ data: toPublic(created) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const existing = await customerModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Customer tidak ditemukan' });
    const updated = await customerModel.update(req.params.id, req.body);
    res.json({ data: toPublic(updated) });
  } catch (err) {
    next(err);
  }
}

async function destroy(req, res, next) {
  try {
    const existing = await customerModel.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Customer tidak ditemukan' });
    await customerModel.softDelete(req.params.id);
    res.json({ message: 'Customer dinonaktifkan' });
  } catch (err) {
    next(err);
  }
}

module.exports = { index, show, store, update, destroy };
