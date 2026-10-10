// Global Express error-handling middleware (must have 4 params)
function errorHandler(err, req, res, _next) {
  const status  = err.status || err.statusCode || 500;
  // MySQL errors carry SQL and schema detail — log it, never send it.
  const isDbError = Boolean(err.sqlMessage || err.sql || err.errno || /^(ER_|PROTOCOL_|ECONN)/.test(err.code || ''));
  const message = isDbError && status >= 500
    ? 'The server could not complete this request. Please try again.'
    : (err.message || 'Internal server error');
  console.error(`[${status}] ${req?.method || ''} ${req?.baseUrl || ''}${req?.route?.path || ''} ${err.code || ''} ${err.message || ''}`.replace(/\s+/g, ' ').trim());
  // A handler that already answered, then failed: nothing more can be sent.
  if (res.headersSent) return;
  if (err.code === 'DB_BUSY') res.set('Retry-After', '3');
  res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
