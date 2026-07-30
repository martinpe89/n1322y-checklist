const { query } = require('./_lib/db');
const { signSession } = require('./_lib/auth');
const { ok, badRequest, unauthorized, serverError } = require('./_lib/response');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code } = req.body;

    if (!code) {
      return badRequest(res, 'Access code required');
    }

    // Verificar el código de acceso
    if (code !== process.env.ACCESS_CODE) {
      return unauthorized(res, 'Invalid access code');
    }

    // Obtener los partners activos
    const result = await query(
      'SELECT id, name FROM partners WHERE archived = false ORDER BY created_at ASC'
    );

    const partners = result.rows.map(p => ({
      id: p.id,
      name: p.name,
    }));

    // Generar un session token temporal (sin asociar a un partner específico)
    // Este token permite al cliente ver el roster y elegir un partner
    const tempToken = signSession('temp');

    // Devolver la cookie con httpOnly
    res.setHeader(
      'Set-Cookie',
      `n1322y_session=${tempToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`
    );

    return ok(res, {
      token: tempToken,
      roster: partners,
      aircraft: 'N1322Y',
      message: 'Select a pilot to begin',
    });
  } catch (error) {
    console.error('Session error:', error);
    return serverError(res, error.message);
  }
}
