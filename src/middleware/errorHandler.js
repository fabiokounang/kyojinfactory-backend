function notFound(req, res, next) {
  res.status(404).json({ message: `Endpoint tidak ditemukan: ${req.method} ${req.originalUrl}` });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  res.status(status).json({
    message: err.message || 'Terjadi kesalahan internal',
  });
}

module.exports = { notFound, errorHandler };
