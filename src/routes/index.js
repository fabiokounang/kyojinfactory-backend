const express = require('express');

const authRoutes = require('./authRoutes');
const customerRoutes = require('./customerRoutes');
const customerPoRoutes = require('./customerPoRoutes');
const taskRoutes = require('./taskRoutes');
const masterItemRoutes = require('./masterItemRoutes');
const settingsRoutes = require('./settingsRoutes');
const bomRoutes = require('./bomRoutes');
const { ping } = require('../config/database');

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

module.exports = router;
