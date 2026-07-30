const crypto = require('crypto');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function hashPin(pin) {
  // Scrypt con parámetros estándar: N=16384, r=8, p=1 (crypto nativo de Node)
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(Buffer.from(pin), salt, 32, SCRYPT_OPTS);
  return Buffer.concat([salt, hash]).toString('base64');
}

function verifyPin(pin, hash) {
  try {
    const buffer = Buffer.from(hash, 'base64');
    const salt = buffer.slice(0, 16);
    const storedHash = buffer.slice(16);
    const testHash = crypto.scryptSync(Buffer.from(pin), salt, 32, SCRYPT_OPTS);
    return crypto.timingSafeEqual(testHash, storedHash);
  } catch (e) {
    return false;
  }
}

function signSession(partnerId) {
  const timestamp = Date.now().toString();
  const data = `${partnerId}:${timestamp}`;
  const signature = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('hex');
  return `${data}.${signature}`;
}

function verifySession(token) {
  try {
    const [data, signature] = token.split('.');
    const expected = crypto
      .createHmac('sha256', process.env.SESSION_SECRET)
      .update(data)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }

    const [partnerId, timestamp] = data.split(':');
    // Session válida por 30 días
    const age = Date.now() - parseInt(timestamp);
    if (age > 30 * 24 * 60 * 60 * 1000) {
      return null;
    }

    return partnerId;
  } catch (e) {
    return null;
  }
}

module.exports = { hashPin, verifyPin, signSession, verifySession };
