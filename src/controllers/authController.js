const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');

const userModel = require('../models/userModel');
const { signToken } = require('../config/jwt');

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
  };
}

async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Permintaan tidak valid',
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { email, password } = req.body;
    const user = await userModel.findByEmail(email);

    const invalidMessage = 'Email atau password salah';
    if (!user || !user.is_active) {
      return res.status(401).json({ message: invalidMessage });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ message: invalidMessage });
    }

    const token = signToken({ sub: user.id, role: user.role });

    return res.json({
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await userModel.findById(req.user.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ message: 'Sesi tidak valid' });
    }
    return res.json({ user: toPublicUser(user) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, me };
