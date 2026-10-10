'use strict';

/**
 * Express 4 ignores the promise an async handler returns. Any rejection that
 * escapes a handler's try — e.g. `await pool.getConnection()` written before the
 * try, which is how QR/CN verification and ten other handlers are written —
 * becomes an unhandled rejection. On Node ≥15 that terminates the process: one
 * refused MySQL connection would restart the API under PM2 and drop every
 * in-flight request and in-memory job (bulk SMS, campaigns, card generation).
 *
 * This forwards such rejections to next(err), so the existing error handler
 * answers the request instead. Synchronous behaviour is unchanged. Same
 * technique as the express-async-errors package, without a new dependency.
 */
function install() {
  let Layer;
  try {
    Layer = require('express/lib/router/layer');
  } catch {
    console.warn('[asyncErrors] express layer not found — async error forwarding not installed');
    return false;
  }
  if (Layer.prototype.__asyncErrorsInstalled) return true;

  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next();        // error middleware: unchanged
    try {
      const ret = fn(req, res, next);
      if (ret && typeof ret.then === 'function') ret.then(undefined, (err) => next(err || new Error('Request failed')));
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__asyncErrorsInstalled = true;
  return true;
}

module.exports = { install };
