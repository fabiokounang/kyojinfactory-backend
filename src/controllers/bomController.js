const { validationResult } = require('express-validator');
const bomModel = require('../models/bomModel');
const masterItemModel = require('../models/masterItemModel');
const taskModel = require('../models/taskModel');

function toPublicVersion(v) {
  if (!v) return null;
  return {
    id: v.id,
    fgId: v.fg_id,
    fgCode: v.fg_code,
    fgName: v.fg_name,
    fgUnit: v.fg_unit,
    versionName: v.version_name,
    status: v.status,
    notes: v.notes,
    createdBy: v.created_by,
    componentCount: v.component_count != null ? Number(v.component_count) : undefined,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  };
}

function toPublicComponent(c) {
  return {
    id: c.id,
    fgId: c.fg_id,
    bomVersionId: c.bom_version_id,
    level: c.level,
    parentComponentId: c.parent_component_id,
    componentName: c.component_name,
    componentCode: c.component_code,
    runningNumber: c.running_number,
    qtyPerParent: Number(c.qty_per_parent),
    unit: c.unit,
    size: c.size,
    wastePercent: Number(c.waste_percent),
    hasNextLevel: !!c.has_next_level,
    isRaw: !!c.is_raw,
    masterItemId: c.master_item_id ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function handleValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      message: 'Permintaan tidak valid',
      errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
    return true;
  }
  return false;
}

function deriveProgress(components) {
  const maxLevel = components.reduce((m, c) => Math.max(m, c.level), 0);
  const pendingByLevel = {};
  for (let lvl = 1; lvl <= maxLevel; lvl += 1) {
    const parents = components.filter((c) => c.level === lvl && c.hasNextLevel);
    const pending = parents.filter(
      (p) => !components.some((c) => c.parentComponentId === p.id)
    );
    if (pending.length > 0) {
      pendingByLevel[lvl] = pending.map((p) => ({
        id: p.id,
        componentCode: p.componentCode,
        componentName: p.componentName,
      }));
    }
  }

  const firstPendingLevel = Object.keys(pendingByLevel)
    .map(Number)
    .sort((a, b) => a - b)[0];

  return {
    maxLevel,
    pendingByLevel,
    nextLevelToFill: firstPendingLevel != null ? firstPendingLevel + 1 : maxLevel + 1,
    completed: maxLevel > 0 && firstPendingLevel == null,
  };
}

async function indexVersions(req, res, next) {
  try {
    const rows = await bomModel.listVersions({
      fgId: req.query.fgId ? Number(req.query.fgId) : undefined,
      status: req.query.status,
    });
    res.json({ data: rows.map(toPublicVersion) });
  } catch (err) {
    next(err);
  }
}

async function showVersion(req, res, next) {
  try {
    const version = await bomModel.findVersionById(req.params.id);
    if (!version) return res.status(404).json({ message: 'Versi BOM tidak ditemukan' });
    const rawComponents = await bomModel.listComponents(version.id);
    const components = rawComponents.map(toPublicComponent);
    const progress = deriveProgress(components);
    res.json({
      data: {
        version: toPublicVersion(version),
        components,
        progress,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function openOrCreateVersion(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const fgId = Number(req.body.fgId);
    const fg = await masterItemModel.findById(fgId);
    if (!fg) return res.status(400).json({ message: 'FG tidak ditemukan' });
    if (fg.category !== 'FG') {
      return res.status(400).json({ message: 'Hanya master item kategori FG yang dapat di-BOM' });
    }

    const existingDraft = await bomModel.findDraftByFgId(fgId);
    if (existingDraft) {
      return res.json({ data: toPublicVersion(existingDraft), created: false });
    }

    const versionName = await bomModel.allocateVersionName(fgId);
    const version = await bomModel.createVersion(
      { fgId, versionName, notes: null },
      req.user?.id
    );
    res.status(201).json({ data: toPublicVersion(version), created: true });
  } catch (err) {
    next(err);
  }
}

async function storeVersion(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const fg = await masterItemModel.findById(req.body.fgId);
    if (!fg) return res.status(400).json({ message: 'FG tidak ditemukan' });
    if (fg.category !== 'FG') {
      return res.status(400).json({ message: 'Hanya master item kategori FG yang dapat di-BOM' });
    }
    const dup = await bomModel.findVersionByName(req.body.fgId, req.body.versionName);
    if (dup) {
      return res.status(400).json({
        message: `Versi "${req.body.versionName}" untuk FG ini sudah ada`,
      });
    }
    const version = await bomModel.createVersion(
      {
        fgId: req.body.fgId,
        versionName: req.body.versionName,
        notes: req.body.notes,
      },
      req.user?.id
    );
    res.status(201).json({ data: toPublicVersion(version) });
  } catch (err) {
    next(err);
  }
}

async function destroyVersion(req, res, next) {
  try {
    const version = await bomModel.findVersionById(req.params.id);
    if (!version) return res.status(404).json({ message: 'Versi BOM tidak ditemukan' });
    if (version.status === 'ACTIVE') {
      return res.status(400).json({ message: 'Versi aktif tidak dapat dihapus' });
    }
    await bomModel.deleteVersion(req.params.id);
    res.json({ message: 'Versi BOM dihapus' });
  } catch (err) {
    next(err);
  }
}

async function activateVersion(req, res, next) {
  try {
    const version = await bomModel.findVersionById(req.params.id);
    if (!version) return res.status(404).json({ message: 'Versi BOM tidak ditemukan' });
    const components = (await bomModel.listComponents(version.id)).map(toPublicComponent);
    if (components.length === 0) {
      return res.status(400).json({ message: 'BOM kosong, tidak dapat diaktifkan' });
    }
    const progress = deriveProgress(components);
    if (!progress.completed) {
      const levels = Object.keys(progress.pendingByLevel).map(Number);
      return res.status(400).json({
        message: `BOM belum lengkap. Level berikut masih kurang anak: ${levels.join(', ')}`,
        pendingByLevel: progress.pendingByLevel,
      });
    }

    await bomModel.archiveOtherActiveVersions(version.fg_id, version.id);
    const updated = await bomModel.updateVersionStatus(version.id, 'ACTIVE');
    const tasksClosed = await taskModel.markBomDoneForFg(version.fg_id);

    res.json({
      data: toPublicVersion(updated),
      tasksClosed,
      message: 'Versi BOM diaktifkan',
    });
  } catch (err) {
    next(err);
  }
}

async function archiveVersion(req, res, next) {
  try {
    const version = await bomModel.findVersionById(req.params.id);
    if (!version) return res.status(404).json({ message: 'Versi BOM tidak ditemukan' });
    const updated = await bomModel.updateVersionStatus(version.id, 'ARCHIVED');
    res.json({ data: toPublicVersion(updated) });
  } catch (err) {
    next(err);
  }
}

async function addComponents(req, res, next) {
  try {
    if (handleValidation(req, res)) return;

    const version = await bomModel.findVersionById(req.params.id);
    if (!version) return res.status(404).json({ message: 'Versi BOM tidak ditemukan' });
    if (version.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya BOM DRAFT yang dapat diubah' });
    }

    const level = Number(req.body.level);
    const parentId = req.body.parentId ? Number(req.body.parentId) : null;
    const rows = req.body.rows || [];

    if (level < 1) {
      return res.status(400).json({ message: 'Level minimal 1' });
    }
    if (level === 1 && parentId) {
      return res.status(400).json({ message: 'Level 1 tidak boleh punya parent' });
    }
    if (level > 1 && !parentId) {
      return res.status(400).json({ message: 'Parent wajib dipilih untuk level 2 ke atas' });
    }

    if (parentId) {
      const parent = await bomModel.findComponentById(parentId);
      if (!parent || parent.bom_version_id !== version.id) {
        return res.status(400).json({ message: 'Parent tidak valid' });
      }
      if (parent.level !== level - 1) {
        return res.status(400).json({
          message: `Parent harus dari level ${level - 1}, bukan level ${parent.level}`,
        });
      }
      if (!parent.has_next_level) {
        return res.status(400).json({
          message: 'Parent yang dipilih tidak ditandai punya anak (has next level)',
        });
      }
    }

    // Validasi level berikut tidak lompat: harus sudah ada minimal satu komponen di level - 1
    if (level > 1) {
      const prevCount = (await bomModel.listComponents(version.id)).filter(
        (c) => c.level === level - 1
      ).length;
      if (prevCount === 0) {
        return res.status(400).json({
          message: `Lengkapi dulu level ${level - 1} sebelum mengisi level ${level}`,
        });
      }
    }

    const codes = new Set();
    for (const row of rows) {
      const code = String(row.componentCode || '').trim();
      if (!code) continue;
      if (codes.has(code)) {
        return res.status(400).json({
          message: `Kode komponen duplikat dalam form: ${code}`,
        });
      }
      codes.add(code);
      const existing = await bomModel.findComponentByCode(version.id, code);
      if (existing) {
        return res.status(400).json({
          message: `Kode "${code}" sudah dipakai di versi BOM ini`,
        });
      }
    }

    await bomModel.createComponentsBulk(version.id, parentId, level, rows, version.fg_id);

    const components = (await bomModel.listComponents(version.id)).map(toPublicComponent);
    const progress = deriveProgress(components);
    res.status(201).json({
      data: {
        version: toPublicVersion(version),
        components,
        progress,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateComponent(req, res, next) {
  try {
    if (handleValidation(req, res)) return;
    const existing = await bomModel.findComponentById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Komponen tidak ditemukan' });

    const version = await bomModel.findVersionById(existing.bom_version_id);
    if (version.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya BOM DRAFT yang dapat diubah' });
    }

    if (req.body.componentCode && req.body.componentCode !== existing.component_code) {
      const dup = await bomModel.findComponentByCode(
        existing.bom_version_id,
        req.body.componentCode,
        existing.id
      );
      if (dup) {
        return res.status(400).json({
          message: `Kode "${req.body.componentCode}" sudah dipakai`,
        });
      }
    }

    const hasNext = !!req.body.hasNextLevel;
    if (!hasNext) {
      const kids = await bomModel.childrenCount(existing.id);
      if (kids > 0) {
        return res.status(400).json({
          message: 'Komponen ini masih punya anak. Hapus anak dulu sebelum menjadikannya Raw / Final.',
        });
      }
    }

    const updated = await bomModel.updateComponent(req.params.id, req.body);
    res.json({ data: toPublicComponent(updated) });
  } catch (err) {
    next(err);
  }
}

async function destroyComponent(req, res, next) {
  try {
    const existing = await bomModel.findComponentById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Komponen tidak ditemukan' });
    const version = await bomModel.findVersionById(existing.bom_version_id);
    if (version.status !== 'DRAFT') {
      return res.status(400).json({ message: 'Hanya BOM DRAFT yang dapat diubah' });
    }
    await bomModel.deleteComponent(req.params.id);
    res.json({ message: 'Komponen dihapus' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  indexVersions,
  showVersion,
  openOrCreateVersion,
  storeVersion,
  destroyVersion,
  activateVersion,
  archiveVersion,
  addComponents,
  updateComponent,
  destroyComponent,
};
