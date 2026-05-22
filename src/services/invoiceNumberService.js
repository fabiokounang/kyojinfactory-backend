/** FJ-YYYYMM-XXXX — Faktur Jual ke customer */
async function nextCustomerInvoiceNumber(conn, invoiceDate) {
  const d = new Date(invoiceDate);
  const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  await conn.execute(
    `INSERT INTO cinv_number_sequences (inv_month, last_seq)
     VALUES (:month, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    { month }
  );
  const [rows] = await conn.execute(
    'SELECT last_seq FROM cinv_number_sequences WHERE inv_month = :month LIMIT 1',
    { month }
  );
  const seq = rows[0]?.last_seq ?? 1;
  return `FJ-${month}-${String(seq).padStart(4, '0')}`;
}

/** FP-YYYYMM-XXXX — Faktur Pembelian dari vendor */
async function nextVendorInvoiceNumber(conn, invoiceDate) {
  const d = new Date(invoiceDate);
  const month = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  await conn.execute(
    `INSERT INTO vinv_number_sequences (inv_month, last_seq)
     VALUES (:month, 1)
     ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
    { month }
  );
  const [rows] = await conn.execute(
    'SELECT last_seq FROM vinv_number_sequences WHERE inv_month = :month LIMIT 1',
    { month }
  );
  const seq = rows[0]?.last_seq ?? 1;
  return `FP-${month}-${String(seq).padStart(4, '0')}`;
}

module.exports = { nextCustomerInvoiceNumber, nextVendorInvoiceNumber };
