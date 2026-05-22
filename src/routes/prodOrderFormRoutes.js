const express = require('express');
const { body } = require('express-validator');
const { authRequired } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/prodOrderFormController');

const router = express.Router();

router.use(authRequired);

const lineRules = [
  body('lines').isArray({ min: 1 }).withMessage('Minimal satu baris produksi'),
  body('lines.*.customerPoLineId').isInt({ min: 1 }).withMessage('customerPoLineId tidak valid'),
  body('lines.*.productNumber').notEmpty().withMessage('Product number wajib diisi'),
  body('lines.*.qtyToProduce').isFloat({ min: 0.0001 }).withMessage('Qty produksi harus lebih dari 0'),
];

router.get('/eligible-customer-pos', ctrl.getEligibleCustomerPos);
router.get('/prefill/:customerPoId', ctrl.getPrefill);
router.get('/', ctrl.listPofs);
router.get('/:id', ctrl.getPof);

router.post(
  '/',
  [body('customerPoId').isInt({ min: 1 }).withMessage('customerPoId wajib diisi'), ...lineRules],
  ctrl.createPof
);

router.put('/:id', lineRules, ctrl.updatePof);

router.delete('/:id', ctrl.deletePof);
router.post('/:id/release', ctrl.releasePof);
router.post('/:id/cancel', ctrl.cancelPof);

router.patch(
  '/:id/lines/:lineId/production',
  [body('qtyProduced').isFloat({ min: 0 }).withMessage('qtyProduced harus angka >= 0')],
  ctrl.recordProduction
);

module.exports = router;
