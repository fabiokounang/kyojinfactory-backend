/**
 * Sync BOM component → master_items (RAW / WIP) within a transaction.
 *
 * Rules:
 *  - component_code is the global unique key.
 *  - If the code belongs to an FG → reject (throws 400).
 *  - If the code belongs to RAW/WIP → update name, category, unit, std_size.
 *  - If the code doesn't exist → create new RAW or WIP.
 *  - Deleting a BOM component does NOT delete the master item.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {{ componentCode: string, componentName: string, unit?: string, size?: string | null, hasNextLevel: boolean }} component
 * @returns {Promise<number>} master_item id
 */
async function upsertFromComponent(conn, component) {
  const { componentCode, componentName, unit, size, hasNextLevel } = component;
  const category = hasNextLevel ? 'WIP' : 'RAW';

  const [rows] = await conn.execute(
    'SELECT id, category FROM master_items WHERE code = :code LIMIT 1',
    { code: componentCode }
  );

  if (rows.length > 0) {
    const existing = rows[0];
    if (existing.category === 'FG') {
      const err = new Error(`Kode "${componentCode}" sudah digunakan oleh Master Item FG`);
      err.status = 400;
      throw err;
    }
    await conn.execute(
      `UPDATE master_items
          SET name = :name, category = :category, unit = :unit, std_size = :std_size
        WHERE id = :id`,
      {
        id: existing.id,
        name: componentName,
        category,
        unit: unit || 'pcs',
        std_size: size || null,
      }
    );
    return existing.id;
  }

  const [result] = await conn.execute(
    `INSERT INTO master_items (code, name, category, unit, std_size, version)
     VALUES (:code, :name, :category, :unit, :std_size, 'V1')`,
    {
      code: componentCode,
      name: componentName,
      category,
      unit: unit || 'pcs',
      std_size: size || null,
    }
  );
  return result.insertId;
}

module.exports = { upsertFromComponent };
