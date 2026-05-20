const express = require('express');
const { body } = require('express-validator');

const ctrl = require('../controllers/customerPoController');
const { authRequired, superAdminRequired } = require('../middleware/authMiddleware');

const router = express.Router();

const poValidators = [
  body('customerId').isInt({ min: 1 }).withMessage('Customer wajib dipilih'),
  body('poDate').isISO8601().withMessage('Tanggal PO tidak valid'),
  body('customerPoRef').optional({ nullable: true, checkFalsy: true }).isString().trim(),
  body('paymentTermTrigger')
    .isIn(['AFTER_PO_ISSUED', 'AFTER_GOODS_RECEIVED'])
    .withMessage('Pemicu termin tidak valid'),
  body('paymentTermDays').isInt({ min: 0, max: 365 }).withMessage('Hari termin 0-365'),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
  body('lines').isArray({ min: 1 }).withMessage('Minimal satu baris item'),
  body('lines.*.itemName').isString().trim().isLength({ min: 1 }).withMessage('Nama item wajib diisi'),
  body('lines.*.qty').isFloat({ gt: 0 }).withMessage('Qty harus lebih dari 0'),
  body('lines.*.unit').isString().trim().isLength({ min: 1 }).withMessage('Unit wajib diisi'),
  body('lines.*.unitPrice').isFloat({ min: 0 }).withMessage('Harga tidak valid'),
  body('lines.*.ppnIncluded').optional().isBoolean(),
];

router.use(authRequired);

const receiptValidators = [
  body('receivedDate').isISO8601().withMessage('Tanggal penerimaan tidak valid'),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
  body('markCompleted').optional().isBoolean(),
];

router.get('/preview-code', ctrl.previewCode);
router.get('/', ctrl.index);
router.get('/:id', ctrl.show);
router.post('/', poValidators, ctrl.store);
router.put('/:id', superAdminRequired, poValidators, ctrl.update);
router.delete('/:id', superAdminRequired, ctrl.destroy);
router.post('/:id/confirm', ctrl.confirm);
router.post('/:id/cancel', ctrl.cancel);
router.post('/:id/record-receipt', receiptValidators, ctrl.recordReceipt);

module.exports = router;
