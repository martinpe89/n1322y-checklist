const { query } = require('./_lib/db');
const { ok, serverError } = require('./_lib/response');
const { requireSession } = require('./_lib/middleware');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const deviceId = req.headers['x-device-id'] || 'unknown';

    // Obtener roster
    const partnersResult = await query(
      'SELECT id, name, pin_hash FROM partners WHERE archived = false ORDER BY created_at ASC'
    );

    // Obtener settings (tarifa, moneda)
    const settingsResult = await query(
      'SELECT k, v FROM settings WHERE k IN ($1, $2)',
      ['rate', 'currency']
    );

    const settings = {};
    settingsResult.rows.forEach(row => {
      settings[row.k] = row.v;
    });

    // Obtener vuelo abierto para este dispositivo (si existe)
    const flightResult = await query(
      `SELECT id, partner_id, started_at, eng_start, ac_start, unchecked
       FROM flights
       WHERE device_id = $1 AND closed_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [deviceId]
    );

    const openFlight = flightResult.rows[0] || null;

    // Obtener última lectura conocida (último vuelo cerrado)
    const lastFlightResult = await query(
      `SELECT eng_end, ac_end
       FROM flights
       WHERE closed_at IS NOT NULL
       ORDER BY closed_at DESC
       LIMIT 1`
    );

    const lastReading = lastFlightResult.rows[0] || null;

    return ok(res, {
      roster: partnersResult.rows.map(p => ({ id: p.id, name: p.name, hasPin: !!p.pin_hash })),
      rate: settings.rate || null,
      currency: settings.currency || 'USD',
      openFlight: openFlight ? {
        id: openFlight.id,
        partnerId: openFlight.partner_id,
        startedAt: openFlight.started_at,
        engStart: openFlight.eng_start,
        acStart: openFlight.ac_start,
        unchecked: openFlight.unchecked,
      } : null,
      lastReading: lastReading ? {
        engEnd: lastReading.eng_end,
        acEnd: lastReading.ac_end,
      } : null,
    });
  } catch (error) {
    console.error('State error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handler);
