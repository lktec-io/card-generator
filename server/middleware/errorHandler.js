// Global Express error-handling middleware (must have 4 params)
function errorHandler(err, _req, res, _next) {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  console.error(`[${status}] ${message}`);
  res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
