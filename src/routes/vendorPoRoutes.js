const express = require('express');
const { body } = require('express-validator');
const { authRequired } = require('../middleware/authMiddleware');
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
  body('paymentMode')
    .isIn(['UPFRONT', 'DP_THEN_RECEIPT', 'ON_RECEIPT'])
    .withMessage('Mode pembayaran tidak valid'),
  body('paymentTermDays').isInt({ min: 0, max: 365 }).withMessage('Hari termin 0-365'),
  body('dpAmount')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Nominal DP tidak valid'),
  body('notes').optional({ nullable: true, checkFalsy: true }).isString(),
];

const receiptValidators = [
  body('receivedDate').isISO8601().withMessage('Tanggal penerimaan tidak valid'),
  body('receivedNotes').optional({ nullable: true, checkFalsy: true }).isString(),
];

router.get('/', ctrl.index);
router.get('/:id', ctrl.show);
router.post('/', [...headerValidators, ...lineValidators], ctrl.store);
router.put('/:id', [...headerValidators, ...lineValidators], ctrl.update);
router.delete('/:id', ctrl.destroy);
router.post('/:id/confirm', ctrl.confirmPo);
router.post('/:id/receive', receiptValidators, ctrl.receiveGoods);
router.post('/:id/complete', ctrl.completePo);
router.post('/:id/cancel', ctrl.cancelPo);

module.exports = router;
