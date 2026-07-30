const crypto = require('crypto');
const { query } = require('./_lib/db');
const { ok, conflict, badRequest, serverError } = require('./_lib/response');
const { requireSession } = require('./_lib/middleware');

async function handleFlight(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { partnerId } = req.body;
    const deviceId = req.headers['x-device-id'] || 'unknown';

    if (!partnerId) {
      return badRequest(res, 'Partner ID required');
    }

    // Verificar que el partner existe
    const partnerResult = await query(
      'SELECT id FROM partners WHERE id = $1',
      [partnerId]
    );

    if (partnerResult.rowCount === 0) {
      return badRequest(res, 'Partner not found');
    }

    // Verificar si ya existe un vuelo abierto para este avión
    const openFlightResult = await query(
      'SELECT id, partner_id, started_at, eng_start, ac_start FROM flights WHERE closed_at IS NULL'
    );

    if (openFlightResult.rowCount > 0) {
      const openFlight = openFlightResult.rows[0];
      return conflict(res, {
        error: 'Flight already open',
        flight: {
          id: openFlight.id,
          partnerId: openFlight.partner_id,
          startedAt: openFlight.started_at,
          engStart: openFlight.eng_start,
          acStart: openFlight.ac_start,
        },
      });
    }

    // Obtener las lecturas sugeridas del último vuelo cerrado
    const lastFlightResult = await query(
      `SELECT eng_end, ac_end FROM flights WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`
    );

    const suggestedReading = lastFlightResult.rows[0] || {
      eng_end: null,
      ac_end: null,
    };

    // Crear nuevo vuelo
    const flightId = crypto.randomUUID();
    const startTime = new Date();

    await query(
      `INSERT INTO flights (id, partner_id, device_id, started_at)
       VALUES ($1, $2, $3, $4)`,
      [flightId, partnerId, deviceId, startTime]
    );

    return ok(res, {
      flightId,
      partnerId,
      startedAt: startTime.toISOString(),
      suggestedEngStart: suggestedReading.eng_end,
      suggestedAcStart: suggestedReading.ac_end,
    });
  } catch (error) {
    console.error('Flight error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handleFlight);
