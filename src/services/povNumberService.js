/**
 * Nomor PO Vendor atomik per tahun — pola: PO-V-{YYYY}-{XXXX}
 * Contoh: PO-V-2026-0001
 */
async function nextPovNumber(conn, year) {
  await conn.execute(
    `INSERT INTO pov_number_sequences (year, last_seq)
     VALUES (:year, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    { year }
  );
  const [rows] = await conn.execute(
    'SELECT last_seq FROM pov_number_sequences WHERE year = :year LIMIT 1',
    { year }
  );
  const seq = rows[0]?.last_seq ?? 1;
  return `PO-V-${year}-${String(seq).padStart(4, '0')}`;
}

module.exports = { nextPovNumber };
