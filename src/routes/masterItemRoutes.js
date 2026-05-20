const express = require('express');
const { body } = require('express-validator');

const ctrl = require('../controllers/masterItemController');
const { authRequired, superAdminRequired } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authRequired);

const updateValidators = [
  body('name').isString().trim().isLength({ min: 1 }).withMessage('Nama wajib diisi'),
  body('unit').isString().trim().isLength({ min: 1 }).withMessage('Unit wajib diisi'),
  body('stdSize').optional({ nullable: true, checkFalsy: true }).isString().trim(),
];

router.get('/', ctrl.index);
router.get('/:id', ctrl.show);
router.put('/:id', superAdminRequired, updateValidators, ctrl.update);
router.delete('/:id', superAdminRequired, ctrl.destroy);

module.exports = router;
