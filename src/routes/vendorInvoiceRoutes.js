const express = require('express');
const { body } = require('express-validator');
const { authRequired } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/vendorInvoiceController');

const router = express.Router();
router.use(authRequired);

router.get('/eligible-vendor-pos', ctrl.getEligiblePos);
router.get('/prefill/:vendorPoId', ctrl.getPrefill);
router.get('/', ctrl.listInvoices);
router.get('/:id', ctrl.getInvoice);

router.post(
  '/',
  [
    body('vendorPoId').isInt({ min: 1 }).withMessage('vendorPoId wajib'),
    body('invoiceDate').isISO8601().withMessage('invoiceDate wajib'),
    body('total').optional().isFloat({ min: 0.01 }),
  ],
  ctrl.createInvoice
);

router.put(
  '/:id',
  [
    body('invoiceDate').optional().isISO8601(),
    body('total').optional().isFloat({ min: 0.01 }),
  ],
  ctrl.updateInvoice
);

router.delete('/:id', ctrl.deleteInvoice);
router.post('/:id/verify', ctrl.verifyInvoice);
router.post('/:id/paid', ctrl.markPaid);
router.post('/:id/cancel', ctrl.cancelInvoice);

module.exports = router;
