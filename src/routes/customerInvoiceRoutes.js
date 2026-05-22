const express = require('express');
const { body } = require('express-validator');
const { authRequired } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/customerInvoiceController');

const router = express.Router();
router.use(authRequired);

router.get('/eligible-customer-pos', ctrl.getEligiblePos);
router.get('/prefill/:customerPoId', ctrl.getPrefill);
router.get('/', ctrl.listInvoices);
router.get('/:id', ctrl.getInvoice);

router.post(
  '/',
  [
    body('customerPoId').isInt({ min: 1 }).withMessage('customerPoId wajib'),
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
router.post('/:id/issue', ctrl.issueInvoice);
router.post('/:id/paid', ctrl.markPaid);
router.post('/:id/cancel', ctrl.cancelInvoice);

module.exports = router;
