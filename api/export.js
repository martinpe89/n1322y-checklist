const { query } = require('./_lib/db');
const { serverError } = require('./_lib/response');

function escapeCSV(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Obtener todos los vuelos cerrados
    const flightsResult = await query(
      `SELECT f.id, f.partner_id, p.name, f.started_at, f.closed_at,
              f.eng_start, f.eng_end, f.ac_start, f.ac_end,
              f.eng_hours, f.ac_hours, f.unchecked, f.gap
       FROM flights f
       LEFT JOIN partners p ON f.partner_id = p.id
       WHERE f.closed_at IS NOT NULL
       ORDER BY f.closed_at DESC`
    );

    // Obtener la tarifa
    const rateResult = await query(
      'SELECT v FROM settings WHERE k = $1',
      ['rate']
    );

    const rate = rateResult.rows[0]?.v ? parseFloat(rateResult.rows[0].v) : null;

    // Construir CSV
    const headers = [
      'date',
      'partner',
      'aircraft',
      'engine_start',
      'engine_end',
      'engine_hours',
      'aircraft_start',
      'aircraft_end',
      'aircraft_hours',
      'rate_per_hour',
      'amount',
      'currency',
      'unchecked',
      'gap',
    ];

    const rows = [headers.join(',')];

    flightsResult.rows.forEach(f => {
      const date = new Date(f.started_at).toISOString().split('T')[0];
      const amount =
        f.eng_hours && rate ? (f.eng_hours * rate).toFixed(2) : '';

      rows.push(
        [
          escapeCSV(date),
          escapeCSV(f.name || ''),
          escapeCSV('N1322Y'),
          escapeCSV(f.eng_start || ''),
          escapeCSV(f.eng_end || ''),
          escapeCSV(f.eng_hours ? f.eng_hours.toFixed(1) : ''),
          escapeCSV(f.ac_start || ''),
          escapeCSV(f.ac_end || ''),
          escapeCSV(f.ac_hours ? f.ac_hours.toFixed(1) : ''),
          escapeCSV(rate || ''),
          escapeCSV(amount),
          escapeCSV('USD'),
          escapeCSV(f.unchecked || 0),
          escapeCSV(f.gap ? f.gap.toFixed(1) : ''),
        ].join(',')
      );
    });

    const csv = rows.join('\n');

    // Enviar como attachment
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="n1322y-hours.csv"');
    res.send('﻿' + csv); // BOM para Excel
  } catch (error) {
    console.error('Export error:', error);
    return serverError(res, error.message);
  }
}
