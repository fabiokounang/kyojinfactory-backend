const express = require('express');
const { body } = require('express-validator');
const { authRequired } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/vendorController');

const router = express.Router();
router.use(authRequired);

const vendorValidators = [
  body('name').trim().isLength({ min: 1 }).withMessage('Nama vendor wajib diisi'),
  body('code').optional({ nullable: true, checkFalsy: true }).trim().isString(),
  body('contactPerson').optional({ nullable: true }).isString(),
  body('phone').optional({ nullable: true }).isString(),
  body('email').optional({ nullable: true }).isEmail().withMessage('Email tidak valid'),
  body('address').optional({ nullable: true }).isString(),
];

router.get('/', ctrl.index);
router.get('/:id', ctrl.show);
router.post('/', vendorValidators, ctrl.store);
router.put('/:id', vendorValidators, ctrl.update);
router.delete('/:id', ctrl.destroy);

module.exports = router;
