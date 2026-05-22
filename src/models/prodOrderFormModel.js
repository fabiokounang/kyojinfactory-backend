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
  'l.qty_produced',
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

function headerQuery(where = '', params = {}, limit = '') {
  return pool.execute(
    `SELECT ${HEADER_COLS}
       FROM prod_order_forms p
       JOIN customer_pos cp ON cp.id = p.customer_po_id
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN users su ON su.id = p.supervisor_user_id
       LEFT JOIN users iu ON iu.id = p.issued_by_user_id
       LEFT JOIN users bu ON bu.id = p.created_by
      ${where}
      ORDER BY p.created_at DESC
      ${limit}`,
    params
  );
}

async function list({ status, search, customerPoId } = {}) {
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
  if (customerPoId) {
    where.push('p.customer_po_id = :customerPoId');
    params.customerPoId = customerPoId;
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await headerQuery(clause, params);
  return rows;
}

async function findById(id) {
  const [rows] = await headerQuery('WHERE p.id = :id', { id }, 'LIMIT 1');
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
 * Menghitung alokasi qty per customer_po_line_id untuk suatu PO.
 * Mengembalikan Map: customerPoLineId -> { poQty, allocated, remaining }
 * excludePofId: abaikan POF tertentu (untuk saat edit DRAFT)
 */
async function getLineAllocation(customerPoId, excludePofId = null) {
  // Qty dari PO Customer
  const [poLines] = await pool.execute(
    `SELECT id AS customer_po_line_id, qty AS po_qty
       FROM customer_po_lines WHERE customer_po_id = :cpoid`,
    { cpoid: customerPoId }
  );

  // Total teralokasi per baris (dari semua POF non-CANCELLED kecuali yang di-exclude)
  const [allocRows] = await pool.execute(
    `SELECT pofl.customer_po_line_id, SUM(pofl.qty_to_produce) AS allocated
       FROM prod_order_form_lines pofl
       JOIN prod_order_forms pof ON pof.id = pofl.prod_order_form_id
      WHERE pof.customer_po_id = :cpoid
        AND pof.status <> 'CANCELLED'
        ${excludePofId ? 'AND pof.id <> :exclude_id' : ''}
      GROUP BY pofl.customer_po_line_id`,
    excludePofId ? { cpoid: customerPoId, exclude_id: excludePofId } : { cpoid: customerPoId }
  );

  const allocMap = new Map(allocRows.map((r) => [r.customer_po_line_id, Number(r.allocated)]));

  const result = new Map();
  for (const pl of poLines) {
    const poQty = Number(pl.po_qty);
    const allocated = allocMap.get(pl.customer_po_line_id) || 0;
    result.set(Number(pl.customer_po_line_id), {
      poQty,
      allocated,
      remaining: Math.max(0, poQty - allocated),
    });
  }
  return result;
}

/**
 * Kandidat PO Customer untuk dropdown POF.
 * Menggunakan multi-POF: PO muncul selama masih ada sisa qty belum teralokasi
 * dan BOM ACTIVE lengkap.
 */
async function findCandidateCustomerPos() {
  const [rows] = await pool.execute(
    `SELECT cp.id, cp.po_number, cp.po_date, cp.status AS cpo_status,
            c.id AS customer_id, c.name AS customer_name, c.code AS customer_code,
            COUNT(DISTINCT cpl.id) AS lines_total,
            SUM(
              CASE
                WHEN cpl.master_item_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM bom_versions bv
                   WHERE bv.fg_id = cpl.master_item_id AND bv.status = 'ACTIVE'
                ) THEN 1
                ELSE 0
              END
            ) AS lines_with_bom,
            SUM(cpl.qty) AS total_po_qty,
            COALESCE((
              SELECT SUM(pofl.qty_to_produce)
                FROM prod_order_form_lines pofl
                JOIN prod_order_forms pof ON pof.id = pofl.prod_order_form_id
               WHERE pof.customer_po_id = cp.id AND pof.status <> 'CANCELLED'
            ), 0) AS total_allocated
       FROM customer_pos cp
       JOIN customers c ON c.id = cp.customer_id
       LEFT JOIN customer_po_lines cpl ON cpl.customer_po_id = cp.id
      WHERE cp.status IN ('CONFIRMED', 'IN_PRODUCTION')
      GROUP BY cp.id, cp.po_number, cp.po_date, cp.status,
               c.id, c.name, c.code
     HAVING lines_total > 0
      ORDER BY cp.po_date DESC`
  );
  return rows.map((r) => ({
    ...r,
    lines_total: Number(r.lines_total),
    lines_with_bom: Number(r.lines_with_bom),
    total_po_qty: Number(r.total_po_qty),
    total_allocated: Number(r.total_allocated),
    remaining_qty: Math.max(0, Number(r.total_po_qty) - Number(r.total_allocated)),
    is_ready: Number(r.lines_with_bom) === Number(r.lines_total),
    has_remaining: Number(r.total_po_qty) > Number(r.total_allocated),
  }));
}

/** PO yang siap: BOM ACTIVE lengkap dan masih ada sisa qty */
async function findEligibleCustomerPos() {
  const candidates = await findCandidateCustomerPos();
  return candidates.filter((r) => r.is_ready && r.has_remaining);
}

async function assertPoReadyForPof(customerPoId) {
  const candidates = await findCandidateCustomerPos();
  const po = candidates.find((r) => r.id === Number(customerPoId));
  if (!po) {
    const err = new Error('PO Customer tidak ditemukan atau tidak valid untuk POF');
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
  if (!po.has_remaining) {
    const err = new Error(
      `PO ${po.po_number} sudah terisi penuh: semua qty sudah dialokasikan ke POF.`
    );
    err.status = 400;
    throw err;
  }
}

/**
 * Validasi baris POF: qty_to_produce tiap baris tidak melebihi sisa PO.
 * allocMap: hasil getLineAllocation
 */
function validateLineQty(lines, allocMap) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const alloc = allocMap.get(Number(line.customerPoLineId));
    if (!alloc) {
      const err = new Error(`Baris ${i + 1}: customer PO line tidak valid`);
      err.status = 400;
      throw err;
    }
    if (Number(line.qtyToProduce) > alloc.remaining) {
      const err = new Error(
        `Baris ${i + 1}: qty ${line.qtyToProduce} melebihi sisa PO (sisa: ${alloc.remaining})`
      );
      err.status = 400;
      throw err;
    }
    if (Number(line.qtyToProduce) <= 0) {
      const err = new Error(`Baris ${i + 1}: qty harus lebih dari 0`);
      err.status = 400;
      throw err;
    }
  }
}

/**
 * Prefill data untuk membuat POF baru dari PO Customer:
 * header info + lines dengan bom ACTIVE per FG + info sisa qty
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

  const allocMap = await getLineAllocation(customerPoId);

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

  const enrichedLines = lines.map((l) => {
    const alloc = allocMap.get(Number(l.customer_po_line_id)) || {
      poQty: Number(l.qty),
      allocated: 0,
      remaining: Number(l.qty),
    };
    return {
      ...l,
      po_qty: alloc.poQty,
      allocated_qty: alloc.allocated,
      remaining_qty: alloc.remaining,
    };
  });

  return { po, lines: enrichedLines };
}

async function create(data) {
  const { customerPoId, supervisorUserId, issuedByUserId, createdBy, notes, lines, dateKey } = data;

  await assertPoReadyForPof(customerPoId);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Validate qty against remaining within transaction
    const allocMap = await getLineAllocation(customerPoId);
    validateLineQty(lines, allocMap);

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

    const [existingRows] = await conn.execute(
      `SELECT id, status, customer_po_id FROM prod_order_forms WHERE id = :id LIMIT 1`,
      { id }
    );
    const existing = existingRows[0];
    if (!existing) {
      const err = new Error('POF tidak ditemukan');
      err.status = 404;
      throw err;
    }
    if (existing.status !== 'DRAFT') {
      const err = new Error('Hanya POF berstatus DRAFT yang dapat diubah');
      err.status = 400;
      throw err;
    }

    // Validate qty — exclude current POF from allocation count
    if (lines && lines.length > 0) {
      const allocMap = await getLineAllocation(existing.customer_po_id, id);
      validateLineQty(lines, allocMap);
    }

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

/**
 * Catat qty produksi untuk satu baris POF.
 * Jika semua baris POF sudah mencapai qty_to_produce → otomatis COMPLETED.
 */
async function recordProduction(pofId, lineId, qtyProduced) {
  const pof = await findById(pofId);
  if (!pof) {
    const err = new Error('POF tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (pof.status !== 'RELEASED') {
    const err = new Error('Hanya POF berstatus RELEASED yang dapat dicatat produksinya');
    err.status = 400;
    throw err;
  }
  const line = pof.lines.find((l) => l.id === Number(lineId));
  if (!line) {
    const err = new Error('Baris POF tidak ditemukan');
    err.status = 404;
    throw err;
  }
  if (Number(qtyProduced) < 0) {
    const err = new Error('Qty produksi tidak boleh negatif');
    err.status = 400;
    throw err;
  }
  if (Number(qtyProduced) > Number(line.qty_to_produce)) {
    const err = new Error(
      `Qty produksi (${qtyProduced}) melebihi plafon POF baris ini (${line.qty_to_produce})`
    );
    err.status = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE prod_order_form_lines SET qty_produced = :qty WHERE id = :id AND prod_order_form_id = :pof_id`,
      { qty: Number(qtyProduced), id: lineId, pof_id: pofId }
    );

    // Auto-COMPLETED jika semua baris penuh
    const [allLines] = await conn.execute(
      `SELECT qty_to_produce, qty_produced FROM prod_order_form_lines WHERE prod_order_form_id = :pof_id`,
      { pof_id: pofId }
    );
    const allDone = allLines.every(
      (l) => Number(l.qty_produced) >= Number(l.qty_to_produce)
    );
    if (allDone) {
      await conn.execute(
        `UPDATE prod_order_forms SET status = 'COMPLETED' WHERE id = :id`,
        { id: pofId }
      );
    }

    await conn.commit();
    return findById(pofId);
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
  if (existing.status === 'RELEASED' || existing.status === 'COMPLETED') {
    const err = new Error('POF yang sudah di-release atau selesai tidak dapat dibatalkan');
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
  getLineAllocation,
  prefill,
  create,
  update,
  release,
  recordProduction,
  cancel,
  destroy,
};
