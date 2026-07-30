const { query } = require('../../../_lib/db');
const { ok, badRequest, notFound, serverError } = require('../../../_lib/response');
const { requireSession } = require('../../../_lib/middleware');

async function handleCheck(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { phase, item, checked } = req.body;

    if (phase === undefined || item === undefined || checked === undefined) {
      return badRequest(res, 'Phase, item, and checked status required');
    }

    // Verificar que el vuelo existe
    const flightResult = await query(
      'SELECT id FROM flights WHERE id = $1',
      [id]
    );

    if (flightResult.rowCount === 0) {
      return notFound(res, 'Flight not found');
    }

    if (checked) {
      // Marcar como completo (insertar o ignorar si ya existe)
      await query(
        `INSERT INTO checks (flight_id, phase, item)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [id, phase, item]
      );
    } else {
      // Desmarcar (borrar)
      await query(
        `DELETE FROM checks WHERE flight_id = $1 AND phase = $2 AND item = $3`,
        [id, phase, item]
      );
    }

    return ok(res, { flightId: id, phase, item, checked });
  } catch (error) {
    console.error('Check error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handleCheck);
