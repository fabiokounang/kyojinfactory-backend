/**
 * Nomor PO atomik per tahun — satu baris dikunci per tahun, hindari deadlock scan LIKE.
 */
async function nextPoNumber(conn, year) {
  await conn.execute(
    `INSERT INTO po_number_sequences (year, last_seq)
     VALUES (:year, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    { year }
  );
  const [rows] = await conn.execute(
    'SELECT last_seq FROM po_number_sequences WHERE year = :year LIMIT 1',
    { year }
  );
  const seq = rows[0]?.last_seq ?? 1;
  return `PO-C-${year}-${String(seq).padStart(4, '0')}`;
}

module.exports = { nextPoNumber };
