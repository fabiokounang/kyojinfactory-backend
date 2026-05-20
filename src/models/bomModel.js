const { pool } = require('../config/database');
const { upsertFromComponent } = require('../services/bomMasterItemSync');

const VERSION_FIELDS = [
  'id',
  'fg_id',
  'version_name',
  'status',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
];
const VERSION_COLS = VERSION_FIELDS.join(', ');
const VERSION_COLS_V = VERSION_FIELDS.map((f) => `v.${f}`).join(', ');

const COMPONENT_COLS = [
  'id',
  'fg_id',
  'bom_version_id',
  'level',
  'parent_component_id',
  'component_name',
  'component_code',
  'running_number',
  'qty_per_parent',
  'unit',
  'size',
  'waste_percent',
  'has_next_level',
  'is_raw',
  'master_item_id',
  'created_at',
  'updated_at',
].join(', ');

async function listVersions({ fgId, status } = {}) {
  const where = [];
  const params = {};
  if (fgId) {
    where.push('v.fg_id = :fg_id');
    params.fg_id = fgId;
  }
  if (status) {
    where.push('v.status = :status');
    params.status = status;
  }
  const sql = `
    SELECT ${VERSION_COLS_V},
           m.code AS fg_code, m.name AS fg_name, m.unit AS fg_unit,
           (SELECT COUNT(*) FROM bom_components c WHERE c.bom_version_id = v.id) AS component_count
    FROM bom_versions v
    JOIN master_items m ON m.id = v.fg_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY v.fg_id ASC, v.created_at DESC
  `;
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function findVersionById(id) {
  const [rows] = await pool.execute(
    `SELECT ${VERSION_COLS_V},
            m.code AS fg_code, m.name AS fg_name, m.unit AS fg_unit
       FROM bom_versions v
       JOIN master_items m ON m.id = v.fg_id
      WHERE v.id = :id
      LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function findVersionByName(fgId, versionName) {
  const [rows] = await pool.execute(
    `SELECT ${VERSION_COLS} FROM bom_versions
      WHERE fg_id = :fg_id AND version_name = :version_name
      LIMIT 1`,
    { fg_id: fgId, version_name: versionName }
  );
  return rows[0] || null;
}

async function findDraftByFgId(fgId) {
  const [rows] = await pool.execute(
    `SELECT ${VERSION_COLS_V},
            m.code AS fg_code, m.name AS fg_name, m.unit AS fg_unit
       FROM bom_versions v
       JOIN master_items m ON m.id = v.fg_id
      WHERE v.fg_id = :fg_id AND v.status = 'DRAFT'
      ORDER BY v.updated_at DESC
      LIMIT 1`,
    { fg_id: fgId }
  );
  return rows[0] || null;
}

async function allocateVersionName(fgId) {
  const base = 'Utama';
  if (!(await findVersionByName(fgId, base))) return base;
  const date = new Date().toISOString().slice(0, 10);
  const dated = `Revisi ${date}`;
  if (!(await findVersionByName(fgId, dated))) return dated;
  let n = 2;
  while (await findVersionByName(fgId, `${dated} (${n})`)) n += 1;
  return `${dated} (${n})`;
}

async function createVersion(data, userId) {
  const [result] = await pool.execute(
    `INSERT INTO bom_versions (fg_id, version_name, status, notes, created_by)
     VALUES (:fg_id, :version_name, 'DRAFT', :notes, :created_by)`,
    {
      fg_id: data.fgId,
      version_name: data.versionName,
      notes: data.notes || null,
      created_by: userId || null,
    }
  );
  return findVersionById(result.insertId);
}

async function updateVersionStatus(id, status) {
  await pool.execute(
    `UPDATE bom_versions SET status = :status WHERE id = :id`,
    { id, status }
  );
  return findVersionById(id);
}

async function archiveOtherActiveVersions(fgId, exceptId) {
  await pool.execute(
    `UPDATE bom_versions
        SET status = 'ARCHIVED'
      WHERE fg_id = :fg_id
        AND id <> :except_id
        AND status = 'ACTIVE'`,
    { fg_id: fgId, except_id: exceptId }
  );
}

async function deleteVersion(id) {
  const [result] = await pool.execute(`DELETE FROM bom_versions WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

async function listComponents(versionId) {
  const [rows] = await pool.execute(
    `SELECT ${COMPONENT_COLS}
       FROM bom_components
      WHERE bom_version_id = :version_id
      ORDER BY level ASC, running_number ASC, id ASC`,
    { version_id: versionId }
  );
  return rows;
}

async function findComponentById(id) {
  const [rows] = await pool.execute(
    `SELECT ${COMPONENT_COLS} FROM bom_components WHERE id = :id LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function findComponentByCode(versionId, code, excludeId = null) {
  const params = { version_id: versionId, code };
  let sql = `SELECT ${COMPONENT_COLS} FROM bom_components
              WHERE bom_version_id = :version_id AND component_code = :code`;
  if (excludeId) {
    sql += ' AND id <> :exclude_id';
    params.exclude_id = excludeId;
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

async function maxLevel(versionId) {
  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(level), 0) AS max_level
       FROM bom_components
      WHERE bom_version_id = :version_id`,
    { version_id: versionId }
  );
  return rows[0]?.max_level || 0;
}

async function maxRunningAt(versionId, parentId) {
  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(running_number), 0) AS max_no
       FROM bom_components
      WHERE bom_version_id = :version_id
        AND ((:parent_id IS NULL AND parent_component_id IS NULL)
             OR parent_component_id = :parent_id)`,
    { version_id: versionId, parent_id: parentId || null }
  );
  return rows[0]?.max_no || 0;
}

/**
 * Komponen induk pada level tertentu yang masih punya status has_next_level
 * tetapi belum memiliki anak.
 */
async function pendingParentsAtLevel(versionId, level) {
  const [rows] = await pool.execute(
    `SELECT p.id, p.component_code, p.component_name
       FROM bom_components p
       LEFT JOIN bom_components c ON c.parent_component_id = p.id
      WHERE p.bom_version_id = :version_id
        AND p.level = :level
        AND p.has_next_level = 1
        AND c.id IS NULL
      ORDER BY p.running_number ASC`,
    { version_id: versionId, level }
  );
  return rows;
}

/** Kandidat parent untuk level berikut (level = nextLevel - 1, has_next_level = 1). */
async function parentCandidates(versionId, nextLevel) {
  const parentLevel = nextLevel - 1;
  if (parentLevel < 1) return [];
  const [rows] = await pool.execute(
    `SELECT id, component_code, component_name, level
       FROM bom_components
      WHERE bom_version_id = :version_id
        AND level = :parent_level
        AND has_next_level = 1
      ORDER BY running_number ASC`,
    { version_id: versionId, parent_level: parentLevel }
  );
  return rows;
}

async function createComponentsBulk(versionId, parentId, level, rows, fgId) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const insertedIds = [];
    let nextRunning = await (async () => {
      const [r] = await conn.execute(
        `SELECT COALESCE(MAX(running_number), 0) AS max_no
           FROM bom_components
          WHERE bom_version_id = :version_id
            AND ((:parent_id IS NULL AND parent_component_id IS NULL)
                 OR parent_component_id = :parent_id)`,
        { version_id: versionId, parent_id: parentId || null }
      );
      return r[0]?.max_no || 0;
    })();

    for (const row of rows) {
      nextRunning += 1;
      const hasNext = !!row.hasNextLevel;
      const isRaw = !hasNext;

      const masterItemId = await upsertFromComponent(conn, {
        componentCode: row.componentCode,
        componentName: row.componentName,
        unit: row.unit,
        size: row.size,
        hasNextLevel: hasNext,
      });

      const [result] = await conn.execute(
        `INSERT INTO bom_components
           (fg_id, bom_version_id, level, parent_component_id,
            component_name, component_code, running_number,
            qty_per_parent, unit, size, waste_percent,
            has_next_level, is_raw, master_item_id)
         VALUES (:fg_id, :version_id, :level, :parent_id,
                 :name, :code, :running,
                 :qty, :unit, :size, :waste,
                 :has_next, :is_raw, :master_item_id)`,
        {
          fg_id: fgId,
          version_id: versionId,
          level,
          parent_id: parentId || null,
          name: row.componentName,
          code: row.componentCode,
          running: nextRunning,
          qty: row.qtyPerParent,
          unit: row.unit || 'pcs',
          size: row.size || null,
          waste: row.wastePercent || 0,
          has_next: hasNext ? 1 : 0,
          is_raw: isRaw ? 1 : 0,
          master_item_id: masterItemId,
        }
      );
      insertedIds.push(result.insertId);
    }

    await conn.commit();
    return insertedIds;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateComponent(id, data) {
  const hasNext = !!data.hasNextLevel;
  const isRaw = !hasNext;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const masterItemId = await upsertFromComponent(conn, {
      componentCode: data.componentCode,
      componentName: data.componentName,
      unit: data.unit,
      size: data.size,
      hasNextLevel: hasNext,
    });

    await conn.execute(
      `UPDATE bom_components
          SET component_name = :name,
              component_code = :code,
              qty_per_parent = :qty,
              unit = :unit,
              size = :size,
              waste_percent = :waste,
              has_next_level = :has_next,
              is_raw = :is_raw,
              master_item_id = :master_item_id
        WHERE id = :id`,
      {
        id,
        name: data.componentName,
        code: data.componentCode,
        qty: data.qtyPerParent,
        unit: data.unit || 'pcs',
        size: data.size || null,
        waste: data.wastePercent || 0,
        has_next: hasNext ? 1 : 0,
        is_raw: isRaw ? 1 : 0,
        master_item_id: masterItemId,
      }
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return findComponentById(id);
}

async function deleteComponent(id) {
  const [result] = await pool.execute(`DELETE FROM bom_components WHERE id = :id`, { id });
  return result.affectedRows > 0;
}

async function childrenCount(parentId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM bom_components WHERE parent_component_id = :id`,
    { id: parentId }
  );
  return rows[0]?.cnt || 0;
}

module.exports = {
  listVersions,
  findVersionById,
  findVersionByName,
  findDraftByFgId,
  allocateVersionName,
  createVersion,
  updateVersionStatus,
  archiveOtherActiveVersions,
  deleteVersion,
  listComponents,
  findComponentById,
  findComponentByCode,
  maxLevel,
  maxRunningAt,
  pendingParentsAtLevel,
  parentCandidates,
  createComponentsBulk,
  updateComponent,
  deleteComponent,
  childrenCount,
};
