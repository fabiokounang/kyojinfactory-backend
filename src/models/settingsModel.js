const { pool } = require('../config/database');
const { DEFAULT_PPN_RATE } = require('../services/taxService');

const PPN_RATE_KEY = 'ppn_rate';

async function getPpnRate(conn = pool) {
  const [rows] = await conn.execute(
    'SELECT setting_value FROM app_settings WHERE setting_key = :key LIMIT 1',
    { key: PPN_RATE_KEY }
  );
  if (!rows[0]) return DEFAULT_PPN_RATE;
  const rate = Number(rows[0].setting_value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : DEFAULT_PPN_RATE;
}

async function setPpnRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    const err = new Error('Tarif PPN harus antara 0 dan 100');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `INSERT INTO app_settings (setting_key, setting_value, description)
     VALUES (:key, :value, 'Tarif PPN (persen)')
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    { key: PPN_RATE_KEY, value: String(value) }
  );
  return getPpnRate();
}

async function getPublicSettings() {
  return {
    ppnRate: await getPpnRate(),
    defaultPpnRate: DEFAULT_PPN_RATE,
  };
}

module.exports = { getPpnRate, setPpnRate, getPublicSettings, DEFAULT_PPN_RATE };
