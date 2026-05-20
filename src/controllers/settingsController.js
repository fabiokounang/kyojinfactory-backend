const { validationResult } = require('express-validator');
const settingsModel = require('../models/settingsModel');

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

async function show(req, res, next) {
  try {
    const data = await settingsModel.getPublicSettings();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

async function updatePpnRate(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ message: 'Hanya admin yang dapat mengubah tarif PPN' });
    }
    const ppnRate = await settingsModel.setPpnRate(req.body.ppnRate);
    res.json({
      data: {
        ppnRate,
        defaultPpnRate: settingsModel.DEFAULT_PPN_RATE,
      },
      message: 'Tarif PPN berhasil disimpan',
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

module.exports = { show, updatePpnRate };
