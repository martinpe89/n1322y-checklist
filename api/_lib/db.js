const { Pool } = require('pg');

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
