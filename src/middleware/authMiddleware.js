const { verifyToken } = require('../config/jwt');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Token tidak ditemukan' });
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Token tidak valid atau kedaluwarsa' });
  }
}

function superAdminRequired(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ message: 'Aksi ini hanya untuk superadmin' });
  }
  return next();
}

module.exports = { authRequired, superAdminRequired };
