const express = require('express');
const { body } = require('express-validator');

const authController = require('../controllers/authController');
const { authRequired } = require('../middleware/authMiddleware');

const router = express.Router();

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email tidak valid').normalizeEmail(),
    body('password').isString().isLength({ min: 1 }).withMessage('Password wajib diisi'),
  ],
  authController.login
);

router.get('/me', authRequired, authController.me);

module.exports = router;
