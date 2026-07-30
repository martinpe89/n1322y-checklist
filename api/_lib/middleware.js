const { verifySession } = require('./auth');
const { unauthorized } = require('./response');

function requireSession(handler) {
  return (req, res) => {
    // Buscar el token en cookies o en header Authorization
    let token = null;

    // De cookies
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').map(c => c.trim());
      const sessionCookie = cookies.find(c => c.startsWith('n1322y_session='));
      if (sessionCookie) {
        token = sessionCookie.split('=')[1];
      }
    }

    // De header Authorization: Bearer <token>
    if (!token && req.headers.authorization) {
      const [scheme, credentials] = req.headers.authorization.split(' ');
      if (scheme === 'Bearer') {
        token = credentials;
      }
    }

    if (!token) {
      return unauthorized(res, 'Missing or invalid session');
    }

    const partnerId = verifySession(token);
    if (!partnerId) {
      return unauthorized(res, 'Invalid or expired session');
    }

    req.partnerId = partnerId;
    return handler(req, res);
  };
}

module.exports = { requireSession };
