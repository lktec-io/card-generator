'use strict';

const https       = require('https');
const SmsProvider = require('./SmsProvider');

/**
 * Beem Africa SMS provider.
 * Docs: https://apisms.beem.africa
 * Auth: HTTP Basic — base64(BEEM_API_KEY:BEEM_SECRET_KEY)
 * Env:  BEEM_API_KEY, BEEM_SECRET_KEY, BEEM_SOURCE_ADDR
 */
class BeemProvider extends SmsProvider {
  constructor() {
    super();
    this.apiKey     = process.env.BEEM_API_KEY     || '';
    this.secretKey  = process.env.BEEM_SECRET_KEY  || '';
    this.sourceAddr = process.env.BEEM_SOURCE_ADDR || 'INFO';
  }

  /**
   * Normalise phone to international format without '+'.
   * Tanzania: 0754... → 255754..., +255754... → 255754...
   */
  _normalise(raw) {
    let p = String(raw).replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (p.startsWith('+')) p = p.slice(1);
    if (p.startsWith('0'))  p = '255' + p.slice(1);
    return p;
  }

  async send(to, message) {
    if (!this.apiKey || !this.secretKey) {
      throw new Error('Beem credentials missing. Set BEEM_API_KEY and BEEM_SECRET_KEY in .env');
    }

    const dest = this._normalise(to);
    const body = JSON.stringify({
      source_addr: this.sourceAddr,
      encoding:    0,
      message,
      recipients:  [{ recipient_id: 1, dest_addr: dest }],
    });

    const auth = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString('base64');

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'apisms.beem.africa',
          path:     '/v1/send',
          method:   'POST',
          headers: {
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization':  `Basic ${auth}`,
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => { raw += c; });
          res.on('end', () => {
            let json = {};
            try { json = JSON.parse(raw); } catch { /* non-JSON body */ }

            // Beem returns { successful: true, request_id: ..., code: 100 } on success
            const ok = res.statusCode >= 200 && res.statusCode < 300 && json.successful !== false;
            if (ok) {
              resolve({
                success:             true,
                provider_message_id: json.request_id != null ? String(json.request_id) : null,
              });
            } else {
              reject(new Error(json.message || `Beem HTTP ${res.statusCode}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = BeemProvider;
