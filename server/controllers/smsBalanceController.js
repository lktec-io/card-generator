'use strict';

const { getBalance, lastKnown } = require('../services/sms/BeemBalance');

// How each failure is answered. Messages are safe to show; no provider detail.
const STATUS = { NOT_CONFIGURED: 503, TIMEOUT: 504, NETWORK: 502, AUTH: 502, PROVIDER: 502, MALFORMED: 502 };

/**
 * GET /sms/balance[?fresh=1]
 * The live Beem SMS credit balance. `fresh=1` asks Beem now (used before and
 * after a send, and by the refresh button); otherwise an answer up to 30 s old
 * may be reused. checked_at is always when Beem actually answered.
 */
async function getSmsBalance(req, res) {
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
  try {
    const { balance, checkedAt, cached } = await getBalance({ fresh });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, sms_balance: balance, unit: 'SMS', source: 'beem', checked_at: checkedAt, cached });
  } catch (err) {
    const known = lastKnown();
    res.status(STATUS[err.code] || 502).json({
      success: false,
      code: err.code || 'PROVIDER',
      message: err.code && err.message ? err.message : 'The SMS balance could not be checked right now.',
      // the last balance Beem DID confirm, clearly labelled — never presented as current
      last_known: known ? { sms_balance: known.balance, checked_at: known.checkedAt } : null,
    });
  }
}

module.exports = { getSmsBalance };
