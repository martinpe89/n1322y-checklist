const { query } = require('./_lib/db');
const { ok, badRequest, serverError } = require('./_lib/response');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { partner } = req.query;

    if (!partner) {
      return badRequest(res, 'Partner ID required');
    }

    // Obtener datos del partner
    const partnerResult = await query(
      'SELECT id, name FROM partners WHERE id = $1',
      [partner]
    );

    if (partnerResult.rowCount === 0) {
      return badRequest(res, 'Partner not found');
    }

    const partnerData = partnerResult.rows[0];

    // Obtener la tarifa
    const rateResult = await query(
      'SELECT v FROM settings WHERE k = $1',
      ['rate']
    );

    const rate = rateResult.rows[0]?.v ? parseFloat(rateResult.rows[0].v) : null;

    // Obtener vuelos cerrados del partner
    const flightsResult = await query(
      `SELECT id, started_at, closed_at, eng_start, eng_end, ac_start, ac_end,
              eng_hours, ac_hours, photo_start, photo_end, unchecked, gap
       FROM flights
       WHERE partner_id = $1 AND closed_at IS NOT NULL
       ORDER BY closed_at DESC`,
      [partner]
    );

    const flights = flightsResult.rows.map(f => ({
      id: f.id,
      startedAt: f.started_at,
      closedAt: f.closed_at,
      engStart: f.eng_start,
      engEnd: f.eng_end,
      acStart: f.ac_start,
      acEnd: f.ac_end,
      engHours: f.eng_hours,
      acHours: f.ac_hours,
      photoStart: f.photo_start,
      photoEnd: f.photo_end,
      unchecked: f.unchecked,
      gap: f.gap,
      amount: f.eng_hours && rate ? (f.eng_hours * rate).toFixed(2) : null,
    }));

    const totals = flights.reduce(
      (acc, f) => ({
        count: acc.count + 1,
        engHours: acc.engHours + (f.engHours || 0),
        acHours: acc.acHours + (f.acHours || 0),
        amount: acc.amount + (f.amount ? parseFloat(f.amount) : 0),
      }),
      { count: 0, engHours: 0, acHours: 0, amount: 0 }
    );

    return ok(res, {
      partner: partnerData,
      rate,
      flights,
      totals: {
        count: totals.count,
        engHours: totals.engHours.toFixed(1),
        acHours: totals.acHours.toFixed(1),
        amount: totals.amount.toFixed(2),
      },
    });
  } catch (error) {
    console.error('Report error:', error);
    return serverError(res, error.message);
  }
}
