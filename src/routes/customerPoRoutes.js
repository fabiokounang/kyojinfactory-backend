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
  // paymentTermDays kept for backward-compat but now optional
  body('paymentTermDays').optional().isInt({ min: 0, max: 3650 }),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
  body('lines').isArray({ min: 1 }).withMessage('Minimal satu baris item'),
  body('lines.*.itemName').isString().trim().isLength({ min: 1 }).withMessage('Nama item wajib diisi'),
  body('lines.*.qty').isFloat({ gt: 0 }).withMessage('Qty harus lebih dari 0'),
  body('lines.*.unit').isString().trim().isLength({ min: 1 }).withMessage('Unit wajib diisi'),
  body('lines.*.unitPrice').isFloat({ min: 0 }).withMessage('Harga tidak valid'),
  body('lines.*.ppnIncluded').optional().isBoolean(),
  // multi-term: optional array, at least 1 if provided
  body('paymentTerms').optional().isArray({ min: 1 }).withMessage('Minimal satu termin jika diisi'),
  body('paymentTerms.*.amountType').optional().isIn(['PERCENT', 'FIXED']).withMessage('Tipe termin tidak valid'),
  body('paymentTerms.*.amountValue').optional().isFloat({ min: 0 }).withMessage('Nilai termin tidak valid'),
  body('paymentTerms.*.termDays').optional().isInt({ min: 0, max: 3650 }).withMessage('Hari termin 0-3650'),
  body('paymentTerms.*.label').optional({ nullable: true, checkFalsy: true }).isString(),
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
router.patch('/:id/terms/:termId/paid', [
  body('paidAt').optional({ nullable: true }).isISO8601().withMessage('Tanggal tidak valid'),
], ctrl.markTermPaid);

module.exports = router;
