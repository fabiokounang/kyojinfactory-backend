/**
 * Nomor POF atomik per tanggal — pola: POF/{ddmmyyyy}/{urut 3 digit}
 * Contoh: POF/20052026/001
 */
async function nextPofNumber(conn, dateKey) {
  await conn.execute(
    `INSERT INTO pof_number_sequences (pof_date, last_seq)
     VALUES (:dateKey, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    { dateKey }
  );
  const [rows] = await conn.execute(
    'SELECT last_seq FROM pof_number_sequences WHERE pof_date = :dateKey LIMIT 1',
    { dateKey }
  );
  const seq = rows[0]?.last_seq ?? 1;
  return `POF/${dateKey}/${String(seq).padStart(3, '0')}`;
}

module.exports = { nextPofNumber };
