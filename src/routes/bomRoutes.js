const express = require('express');
const { body } = require('express-validator');

const ctrl = require('../controllers/bomController');
const { authRequired, superAdminRequired } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authRequired);

const openVersionValidators = [
  body('fgId').isInt({ min: 1 }).withMessage('FG wajib dipilih'),
];

const versionValidators = [
  body('fgId').isInt({ min: 1 }).withMessage('FG wajib dipilih'),
  body('versionName')
    .isString()
    .trim()
    .isLength({ min: 1, max: 64 })
    .withMessage('Nama versi wajib diisi (maks 64 karakter)'),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
];

const componentRowValidator = [
  body('level').isInt({ min: 1 }).withMessage('Level minimal 1'),
  body('parentId').optional({ nullable: true }).isInt({ min: 1 }),
  body('rows').isArray({ min: 1 }).withMessage('Minimal satu komponen'),
  body('rows.*.componentName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Nama komponen wajib diisi'),
  body('rows.*.componentCode')
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage('Kode komponen wajib diisi'),
  body('rows.*.qtyPerParent')
    .isFloat({ gt: 0 })
    .withMessage('Qty harus lebih dari 0'),
  body('rows.*.unit')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Unit wajib diisi'),
  body('rows.*.size').optional({ nullable: true, checkFalsy: true }).isString(),
  body('rows.*.wastePercent')
    .isFloat({ min: 0 })
    .withMessage('Waste % tidak boleh negatif'),
  body('rows.*.hasNextLevel').isBoolean().withMessage('Status komponen wajib diisi'),
];

const componentUpdateValidator = [
  body('componentName')
    .isString()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Nama komponen wajib diisi'),
  body('componentCode')
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage('Kode komponen wajib diisi'),
  body('qtyPerParent').isFloat({ gt: 0 }).withMessage('Qty harus lebih dari 0'),
  body('unit').isString().trim().isLength({ min: 1 }).withMessage('Unit wajib diisi'),
  body('size').optional({ nullable: true, checkFalsy: true }).isString(),
  body('wastePercent').isFloat({ min: 0 }).withMessage('Waste % tidak boleh negatif'),
  body('hasNextLevel').isBoolean().withMessage('Status komponen wajib diisi'),
];

router.get('/versions', ctrl.indexVersions);
router.get('/versions/:id', ctrl.showVersion);
router.post('/versions/open', openVersionValidators, ctrl.openOrCreateVersion);
router.post('/versions', versionValidators, ctrl.storeVersion);
router.delete('/versions/:id', superAdminRequired, ctrl.destroyVersion);
router.post('/versions/:id/activate', ctrl.activateVersion);
router.post('/versions/:id/archive', ctrl.archiveVersion);
router.post('/versions/:id/components', componentRowValidator, ctrl.addComponents);
router.put('/components/:id', componentUpdateValidator, ctrl.updateComponent);
router.delete('/components/:id', ctrl.destroyComponent);

module.exports = router;
