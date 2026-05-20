const { pool } = require('../config/database');

function slugify(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

async function nextSeqForSlug(conn, slug) {
  const prefix = `FG-${slug}-`;
  const [rows] = await conn.execute(
    `SELECT code FROM master_items WHERE code LIKE :prefix ORDER BY id DESC`,
    { prefix: `${prefix}%` }
  );
  let max = 0;
  for (const row of rows) {
    const match = row.code.match(new RegExp(`^FG-${slug}-(\\d+)-`));
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

async function generateFgCode(conn, itemName, version = 'V1') {
  const slug = slugify(itemName);
  if (!slug) throw new Error('Nama item tidak valid untuk kode FG');
  const seq = await nextSeqForSlug(conn, slug);
  return `FG-${slug}-${String(seq).padStart(3, '0')}-${version}`;
}

async function previewFgCode(itemName, version = 'V1') {
  const slug = slugify(itemName);
  if (!slug) return null;
  const conn = await pool.getConnection();
  try {
    const seq = await nextSeqForSlug(conn, slug);
    return `FG-${slug}-${String(seq).padStart(3, '0')}-${version}`;
  } finally {
    conn.release();
  }
}

module.exports = { slugify, generateFgCode, previewFgCode };
