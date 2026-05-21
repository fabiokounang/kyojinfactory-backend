const { pool } = require('../config/database');
const { nextPofNumber } = require('../services/pofNumberService');

const HEADER_COLS = [
  'p.id',
  'p.pof_number',
  'p.customer_po_id',
  'p.status',
  'p.supervisor_user_id',
  'p.issued_by_user_id',
  'p.notes',
  'p.created_by',
  'p.released_at',
  'p.created_at',
  'p.updated_at',
  // joins
  'cp.po_number',
  'cp.status AS cpo_status',
  'c.id AS customer_id',
  'c.name AS customer_name',
  'c.code AS customer_code',
  'su.full_name AS supervisor_name',
  'iu.full_name AS issued_by_name',
  'bu.full_name AS created_by_name',
].join(', ');

const LINE_COLS = [
  'l.id',
  'l.prod_order_form_id',
  'l.customer_po_line_id',
  'l.line_no',
  'l.product_number',
  'l.qty_to_produce',
  'l.unit',
  'l.bom_version_id',
  'l.start_date',
  'l.end_date',
  'l.created_at',
  'l.updated_at',
  // joins
  'cpl.item_name',
  'cpl.qty AS cpo_qty',
  'bv.version_name AS bom_version_name',
  'bv.status AS bom_version_status',
].join(', ');

function headerQuery(where = '', params = {}) {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM prod_order_forms p
       JOIN customer_pos cp ON cp.id = p.customer_po_id
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN users su ON su.id = p.supervisor_user_id
       LEFT JOIN users iu ON iu.id = p.issued_by_user_id
       LEFT JOIN users bu ON bu.id = p.created_by
      ${where}
      ORDER BY p.created_at DESC`,
    params
  );
}

async function list({ status, search } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('p.status = :status');
    params.status = status;
  }
  if (search) {
    where.push('(p.pof_number LIKE :s OR cp.po_number LIKE :s OR c.name LIKE :s)');
    params.s = `%${search}%`;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await headerQuery(clause, params);
  return rows;
}

async function findById(id) {
  const [rows] = await headerQuery('WHERE p.id = :id LIMIT 1', { id });
  const header = rows[0] || null;
  if (!header) return null;
  const [lines] = await pool.execute(
    `SELECT ${LINE_COLS}
       FROM prod_order_form_lines l
       JOIN customer_po_lines cpl ON cpl.id = l.customer_po_line_id
       LEFT JOIN bom_versions bv ON bv.id = l.bom_version_id
      WHERE l.prod_order_form_id = :id
      ORDER BY l.line_no ASC`,
    { id }
  );
  return { ...header, lines };
}

/**
 * Kandidat PO Customer untuk dropdown POF (termasuk yang BOM belum siap).
 * is_ready = true hanya jika semua baris punya BOM ACTIVE.
 */
async function findCandidateCustomerPos() {
  const [rows] = await pool.execute(
    `SELECT cp.id, cp.po_number, cp.po_date, cp.status AS cpo_status,
            c.id AS customer_id, c.name AS customer_name, c.code AS customer_code,
            COUNT(cpl.id) AS lines_total,
            SUM(
              CASE
                WHEN cpl.master_item_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM bom_versions bv
                   WHERE bv.fg_id = cpl.master_item_id AND bv.status = 'ACTIVE'
                ) THEN 1
                ELSE 0
              END
            ) AS lines_with_bom
       FROM customer_pos cp
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN customer_po_lines cpl ON cpl.customer_po_id = cp.id
      WHERE cp.status IN ('CONFIRMED', 'IN_PRODUCTION')
        AND NOT EXISTS (
          SELECT 1 FROM prod_order_forms pof
           WHERE pof.customer_po_id = cp.id AND pof.status <> 'CANCELLED'
        )
      GROUP BY cp.id, cp.po_number, cp.po_date, cp.status,
               c.id, c.name, c.code
     HAVING lines_total > 0
      ORDER BY cp.po_date DESC`
  );
  return rows.map((r) => ({
    ...r,
    lines_total: Number(r.lines_total),
    lines_with_bom: Number(r.lines_with_bom),
    is_ready: Number(r.lines_with_bom) === Number(r.lines_total),
  }));
}

/** PO yang sudah siap 100% (semua baris punya BOM ACTIVE) — untuk validasi create */
async function findEligibleCustomerPos() {
  const candidates = await findCandidateCustomerPos();
  return candidates.filter((r) => r.is_ready);
}

async function assertPoReadyForPof(customerPoId) {
  const candidates = await findCandidateCustomerPos();
  const po = candidates.find((r) => r.id === Number(customerPoId));
  if (!po) {
    const err = new Error('PO Customer tidak ditemukan atau sudah memiliki POF');
    err.status = 400;
    throw err;
  }
  if (!po.is_ready) {
    const err = new Error(
      `PO ${po.po_number} belum siap: BOM ACTIVE ${po.lines_with_bom}/${po.lines_total} item. Selesaikan todo BOM terlebih dahulu.`
    );
    err.status = 400;
    throw err;
  }
}

/**
 * Prefill data untuk membuat POF baru dari PO Customer:
 * header info + lines dengan bom ACTIVE per FG
 */
async function prefill(customerPoId) {
  const [poRows] = await pool.execute(
    `SELECT cp.id, cp.po_number, cp.po_date, cp.status,
            c.id AS customer_id, c.name AS customer_name, c.code AS customer_code
       FROM customer_pos cp
       JOIN customers c ON c.id = cp.customer_id
      WHERE cp.id = :id LIMIT 1`,
    { id: customerPoId }
  );
  if (!poRows.length) return null;
  const po = poRows[0];

  const [lines] = await pool.execute(
    `SELECT cpl.id AS customer_po_line_id, cpl.line_no, cpl.item_name, cpl.item_code AS product_number,
            cpl.qty, cpl.unit, cpl.master_item_id,
            bv.id AS bom_version_id, bv.version_name AS bom_version_name
       FROM customer_po_lines cpl
       LEFT JOIN bom_versions bv ON bv.fg_id = cpl.master_item_id AND bv.status = 'ACTIVE'
      WHERE cpl.customer_po_id = :id
      ORDER BY cpl.line_no ASC`,
    { id: customerPoId }
  );
  return { po, lines };
}

async function create(data) {
  const { customerPoId, supervisorUserId, issuedByUserId, createdBy, notes, lines, dateKey } = data;

  await assertPoReadyForPof(customerPoId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const pofNumber = await nextPofNumber(conn, dateKey);

    const [result] = await conn.execute(
      `INSERT INTO prod_order_forms
         (pof_number, customer_po_id, status, supervisor_user_id, issued_by_user_id, created_by, notes)
       VALUES (:pof_number, :cpo_id, 'DRAFT', :sup, :issued, :created_by, :notes)`,
      {
        pof_number: pofNumber,
        cpo_id: customerPoId,
        sup: supervisorUserId || null,
        issued: issuedByUserId || null,
        created_by: createdBy || null,
        notes: notes || null,
      }
    );
    const pofId = result.insertId;

    await insertLines(conn, pofId, lines);

    await conn.commit();
    return findById(pofId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function update(id, data) {
  const { supervisorUserId, issuedByUserId, notes, lines } = data;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE prod_order_forms
          SET supervisor_user_id = :sup, issued_by_user_id = :issued, notes = :notes
        WHERE id = :id AND status = 'DRAFT'`,
      { id, sup: supervisorUserId || null, issued: issuedByUserId || null, notes: notes || null }
    );

    await conn.execute(`DELETE FROM prod_order_form_lines WHERE prod_order_form_id = :id`, { id });
    await insertLines(conn, id, lines);

    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function release(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT p.id, p.status, p.customer_po_id FROM prod_order_forms p WHERE p.id = :id LIMIT 1`,
      { id }
    );
    const pof = rows[0];
    if (!pof) {
      const err = new Error('POF tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (pof.status !== 'DRAFT') {
      const err = new Error('Hanya POF berstatus DRAFT yang dapat di-release');
      err.status = 400;
      throw err;
    }

    const [lineRows] = await conn.execute(
      `SELECT id, qty_to_produce, bom_version_id, start_date, end_date
         FROM prod_order_form_lines WHERE prod_order_form_id = :id`,
      { id }
    );
    if (lineRows.length === 0) {
      const err = new Error('POF tidak memiliki baris — tambah minimal satu baris produksi');
      err.status = 400;
      throw err;
    }
    for (const line of lineRows) {
      if (!line.qty_to_produce || Number(line.qty_to_produce) <= 0) {
        const err = new Error('Qty produksi setiap baris harus lebih dari 0');
        err.status = 400;
        throw err;
      }
      if (!line.bom_version_id) {
        const err = new Error('Setiap baris harus memiliki referensi BOM');
        err.status = 400;
        throw err;
      }
      if (!line.start_date || !line.end_date) {
        const err = new Error('Setiap baris harus memiliki tanggal mulai dan selesai');
        err.status = 400;
        throw err;
      }
      if (new Date(line.end_date) < new Date(line.start_date)) {
        const err = new Error('Tanggal selesai tidak boleh sebelum tanggal mulai');
        err.status = 400;
        throw err;
      }
    }

    await conn.execute(
      `UPDATE prod_order_forms SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { id }
    );
    await conn.execute(
      `UPDATE customer_pos SET status = 'IN_PRODUCTION' WHERE id = :cpo_id AND status = 'CONFIRMED'`,
      { cpo_id: pof.customer_po_id }
    );

    await conn.commit();
    return findById(id);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function cancel(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('POF tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status === 'RELEASED') {
    const err = new Error('POF yang sudah di-release tidak dapat dibatalkan');
    err.status = 400;
    throw err;
  }
  await pool.execute(`UPDATE prod_order_forms SET status = 'CANCELLED' WHERE id = :id`, { id });
  return findById(id);
}

async function destroy(id) {
  const existing = await findById(id);
  if (!existing) {
    const err = new Error('POF tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (existing.status !== 'DRAFT') {
    const err = new Error('Hanya POF berstatus DRAFT yang dapat dihapus');
    err.status = 400;
    throw err;
  }
  await pool.execute(`DELETE FROM prod_order_forms WHERE id = :id`, { id });
  return true;
}

async function insertLines(conn, pofId, lines) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await conn.execute(
      `INSERT INTO prod_order_form_lines
         (prod_order_form_id, customer_po_line_id, line_no, product_number,
          qty_to_produce, unit, bom_version_id, start_date, end_date)
       VALUES (:pof_id, :cpl_id, :line_no, :product_number,
               :qty, :unit, :bom_version_id, :start_date, :end_date)`,
      {
        pof_id: pofId,
        cpl_id: line.customerPoLineId,
        line_no: i + 1,
        product_number: line.productNumber,
        qty: line.qtyToProduce,
        unit: line.unit || 'pcs',
        bom_version_id: line.bomVersionId || null,
        start_date: line.startDate || null,
        end_date: line.endDate || null,
      }
    );
  }
}

module.exports = {
  list,
  findById,
  findEligibleCustomerPos,
  findCandidateCustomerPos,
  prefill,
  create,
  update,
  release,
  cancel,
  destroy,
};
