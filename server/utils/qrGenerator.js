const QRCode = require('qrcode');

async function generateStyledQRBuffer(data, outputSize = 400) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);

  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',  // matches the Public Invitation / RSVP QR
    type:   'png',
    margin: 1,
    color:  { dark: '#000000', light: '#ffffff' },
    width:  outputSize,
  });
}

module.exports = { generateStyledQRBuffer };
