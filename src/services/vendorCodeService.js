const { pool } = require('../config/database');
const { slugify } = require('./itemCodeService');

async function nextVendorCode(conn, slug) {
  const prefix = `VND-${slug}-`;
  const [rows] = await (conn || pool).execute(
    `SELECT code FROM vendors WHERE code LIKE :prefix ORDER BY id DESC`,
    { prefix: `${prefix}%` }
  );
  let max = 0;
  for (const row of rows) {
    const match = row.code.match(new RegExp(`^VND-${slug}-(\\d+)$`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

async function generateVendorCode(name) {
  const slug = slugify(name).slice(0, 10);
  if (!slug) throw new Error('Nama vendor tidak valid untuk kode');
  return nextVendorCode(null, slug);
}

module.exports = { generateVendorCode };
