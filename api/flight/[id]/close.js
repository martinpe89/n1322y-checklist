const { query } = require('../../_lib/db');
const { ok, badRequest, notFound, serverError } = require('../../_lib/response');
const { requireSession } = require('../../_lib/middleware');
const { verifyPin } = require('../../_lib/auth');

async function handleClose(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { engEnd, acEnd, photoStartUrl, photoEndUrl, pin, unchecked } = req.body;

    // Obtener el vuelo
    const flightResult = await query(
      `SELECT partner_id, eng_start, ac_start, closed_at
       FROM flights WHERE id = $1`,
      [id]
    );

    if (flightResult.rowCount === 0) {
      return notFound(res, 'Flight not found');
    }

    const flight = flightResult.rows[0];

    if (flight.closed_at) {
      return badRequest(res, 'Flight already closed');
    }

    // Validaciones
    if (engEnd !== null && flight.eng_start !== null && engEnd < flight.eng_start) {
      return badRequest(res, 'Engine hours cannot decrease');
    }

    if (acEnd !== null && flight.ac_start !== null && acEnd < flight.ac_start) {
      return badRequest(res, 'Aircraft hours cannot decrease');
    }

    // Verificar PIN si está configurado
    const partnerResult = await query(
      'SELECT pin_hash FROM partners WHERE id = $1',
      [flight.partner_id]
    );

    const partner = partnerResult.rows[0];

    if (partner.pin_hash && !pin) {
      return badRequest(res, 'PIN required to close this flight');
    }

    if (partner.pin_hash && pin) {
      if (!verifyPin(pin, partner.pin_hash)) {
        return badRequest(res, 'Invalid PIN');
      }
    }

    // Calcular gap: eng_start menos el eng_end del vuelo anterior
    let gap = null;
    if (engEnd !== null) {
      const lastFlightResult = await query(
        `SELECT eng_end FROM flights WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`
      );

      if (lastFlightResult.rowCount > 0 && lastFlightResult.rows[0].eng_end !== null) {
        gap = flight.eng_start - lastFlightResult.rows[0].eng_end;
      }
    }

    // Cerrar el vuelo
    const now = new Date();
    await query(
      `UPDATE flights SET
        eng_end = $1,
        ac_end = $2,
        photo_start = $3,
        photo_end = $4,
        unchecked = $5,
        gap = $6,
        closed_at = $7
       WHERE id = $8`,
      [engEnd, acEnd, photoStartUrl, photoEndUrl, unchecked || 0, gap, now, id]
    );

    // Obtener las horas calculadas
    const updatedResult = await query(
      `SELECT eng_hours, ac_hours FROM flights WHERE id = $1`,
      [id]
    );

    const updated = updatedResult.rows[0];

    return ok(res, {
      flightId: id,
      closedAt: now.toISOString(),
      engHours: updated.eng_hours,
      acHours: updated.ac_hours,
      gap,
      unchecked: unchecked || 0,
    });
  } catch (error) {
    console.error('Close flight error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handleClose);
