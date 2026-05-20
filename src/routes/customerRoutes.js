const express = require('express');
const { body } = require('express-validator');

const customerController = require('../controllers/customerController');
const { authRequired } = require('../middleware/authMiddleware');

const router = express.Router();

const customerValidators = [
  body('name').isString().trim().isLength({ min: 1 }).withMessage('Nama customer wajib diisi'),
  body('contactPerson').optional({ nullable: true, checkFalsy: true }).isString().trim(),
  body('phone').optional({ nullable: true, checkFalsy: true }).isString().trim(),
  body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Email tidak valid'),
  body('address').optional({ nullable: true, checkFalsy: true }).isString(),
  body('isActive').optional().isBoolean(),
];

router.use(authRequired);

router.get('/', customerController.index);
router.get('/:id', customerController.show);
router.post('/', customerValidators, customerController.store);
router.put('/:id', customerValidators, customerController.update);
router.delete('/:id', customerController.destroy);

module.exports = router;
