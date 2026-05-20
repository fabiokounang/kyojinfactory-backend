const express = require('express');

const authRoutes = require('./authRoutes');
const customerRoutes = require('./customerRoutes');
const customerPoRoutes = require('./customerPoRoutes');
const taskRoutes = require('./taskRoutes');
const masterItemRoutes = require('./masterItemRoutes');
const settingsRoutes = require('./settingsRoutes');
const bomRoutes = require('./bomRoutes');
const prodOrderFormRoutes = require('./prodOrderFormRoutes');
const { ping } = require('../config/database');
const { pool } = require('../config/database');
const { authRequired } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await ping();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/customer-pos', customerPoRoutes);
router.use('/tasks', taskRoutes);
router.use('/master-items', masterItemRoutes);
router.use('/settings', settingsRoutes);
router.use('/bom', bomRoutes);
router.use('/prod-order-forms', prodOrderFormRoutes);

router.get('/users/assignees', authRequired, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name, role FROM users WHERE is_active = 1 ORDER BY full_name ASC`
    );
    res.json({ data: rows.map((u) => ({ id: u.id, fullName: u.full_name, role: u.role })) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
