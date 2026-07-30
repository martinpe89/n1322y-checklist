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
    const { engStart, acStart, engEnd, acEnd, photoStartUrl, photoEndUrl, pin, unchecked } = req.body;

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

    // Las lecturas iniciales llegan al cierre (el vuelo abre antes de leer el tacómetro)
    const finalEngStart = engStart != null ? engStart : flight.eng_start;
    const finalAcStart = acStart != null ? acStart : flight.ac_start;

    // Validaciones
    if (engEnd != null && finalEngStart != null && Number(engEnd) < Number(finalEngStart)) {
      return badRequest(res, 'Engine hours cannot decrease');
    }

    if (acEnd != null && finalAcStart != null && Number(acEnd) < Number(finalAcStart)) {
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

    // Calcular gap: eng_start de este vuelo menos el eng_end del vuelo anterior.
    // Un gap positivo = el avión voló horas que nadie registró.
    let gap = null;
    if (finalEngStart != null) {
      const lastFlightResult = await query(
        `SELECT eng_end FROM flights
         WHERE closed_at IS NOT NULL AND id != $1 AND eng_end IS NOT NULL
         ORDER BY closed_at DESC LIMIT 1`,
        [id]
      );

      if (lastFlightResult.rowCount > 0) {
        gap = Number(finalEngStart) - Number(lastFlightResult.rows[0].eng_end);
      }
    }

    // Cerrar el vuelo
    const now = new Date();
    await query(
      `UPDATE flights SET
        eng_start = $1,
        ac_start = $2,
        eng_end = $3,
        ac_end = $4,
        photo_start = $5,
        photo_end = $6,
        unchecked = $7,
        gap = $8,
        closed_at = $9
       WHERE id = $10`,
      [finalEngStart, finalAcStart, engEnd, acEnd, photoStartUrl, photoEndUrl, unchecked || 0, gap, now, id]
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
