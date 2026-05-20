const express = require('express');

const ctrl = require('../controllers/taskController');
const { authRequired } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authRequired);

router.get('/', ctrl.index);
router.patch('/:id/done', ctrl.markDone);
router.patch('/:id/reopen', ctrl.reopen);

module.exports = router;
