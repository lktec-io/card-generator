/**
 * QR Code Generator
 * Uses qrcode's native PNG renderer — square dots, sharp edges, no custom SVG.
 */

const QRCode = require('qrcode');

/**
 * Generate a clean, sharp QR code PNG buffer.
 * @param {string|object} data     Data to encode
 * @param {number}        outputSize  Width/height in pixels
 * @returns {Promise<Buffer>}
 */
async function generateStyledQRBuffer(data, outputSize = 600) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);

  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'H',
    type:   'png',
    margin: 2,
    color:  { dark: '#000000', light: '#ffffff' },
    width:  outputSize,
  });
}

module.exports = { generateStyledQRBuffer };
