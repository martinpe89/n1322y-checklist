const { Pool, types } = require('pg');

// Postgres devuelve NUMERIC como string; la app trabaja con números.
// Los valores del tacómetro (7,1) caben sin pérdida en un float de JS.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not configured. Connect Neon from Vercel Storage.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { query, getPool };
