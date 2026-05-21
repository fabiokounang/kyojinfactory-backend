const express = require('express');
const { body } = require('express-validator');
const { authRequired, superAdminRequired } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/vendorPoController');

const router = express.Router();
router.use(authRequired);

const lineValidators = [
  body('lines').isArray({ min: 1 }).withMessage('Minimal satu baris item'),
  body('lines.*.itemName').trim().isLength({ min: 1 }).withMessage('Nama item wajib diisi'),
  body('lines.*.qty').isFloat({ gt: 0 }).withMessage('Qty harus lebih dari 0'),
  body('lines.*.unit').trim().isLength({ min: 1 }).withMessage('Unit wajib diisi'),
  body('lines.*.unitPrice').isFloat({ min: 0 }).withMessage('Harga satuan tidak valid'),
  body('lines.*.ppnIncluded').optional().isBoolean(),
  body('lines.*.masterItemId').optional({ nullable: true }).isInt({ min: 1 }),
];

const headerValidators = [
  body('vendorId').isInt({ min: 1 }).withMessage('Vendor wajib dipilih'),
  body('poDate').isISO8601().withMessage('Tanggal PO tidak valid'),
  body('vendorRef').optional({ nullable: true, checkFalsy: true }).isString(),
  body('paymentTermTrigger')
    .isIn(['AFTER_PO_ISSUED', 'AFTER_GOODS_RECEIVED'])
    .withMessage('Pemicu termin tidak valid'),
  body('paymentTermDays').optional().isInt({ min: 0, max: 3650 }),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
  body('paymentTerms').isArray({ min: 1 }).withMessage('Minimal satu termin pembayaran'),
  body('paymentTerms.*.amountType').isIn(['PERCENT', 'FIXED']).withMessage('Tipe termin tidak valid'),
  body('paymentTerms.*.amountValue').isFloat({ min: 0 }).withMessage('Nilai termin tidak valid'),
  body('paymentTerms.*.termDays').isInt({ min: 0, max: 3650 }).withMessage('Hari termin 0-3650'),
  body('paymentTerms.*.label').optional({ nullable: true, checkFalsy: true }).isString(),
];

const receiptValidators = [
  body('receivedDate').isISO8601().withMessage('Tanggal penerimaan tidak valid'),
  body('receivedNotes').optional({ nullable: true, checkFalsy: true }).isString(),
];

router.get('/', ctrl.index);
router.get('/:id', ctrl.show);
router.post('/', [...headerValidators, ...lineValidators], ctrl.store);
router.put('/:id', superAdminRequired, [...headerValidators, ...lineValidators], ctrl.update);
router.delete('/:id', ctrl.destroy);
router.post('/:id/confirm', ctrl.confirmPo);
router.post('/:id/receive', receiptValidators, ctrl.receiveGoods);
router.post('/:id/complete', ctrl.completePo);
router.post('/:id/cancel', ctrl.cancelPo);
router.patch('/:id/terms/:termId/paid', [
  body('paidAt').optional({ nullable: true }).isISO8601().withMessage('Tanggal tidak valid'),
], ctrl.markTermPaid);

module.exports = router;
