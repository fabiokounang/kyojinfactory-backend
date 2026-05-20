const express = require('express');
const { body } = require('express-validator');

const ctrl = require('../controllers/settingsController');
const { authRequired } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authRequired);

router.get('/', ctrl.show);
router.put(
  '/ppn-rate',
  body('ppnRate').isFloat({ min: 0, max: 100 }).withMessage('Tarif PPN harus 0–100'),
  ctrl.updatePpnRate
);

module.exports = router;
