const fs = require('fs');
const path = require('path');
const { getPool } = require('./_lib/db');

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificación mínima: el código de acceso debe ser enviado
  const { code } = req.body;
  if (code !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: 'Invalid access code' });
  }

  try {
    const schemaPath = path.join(process.cwd(), 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    const pool = getPool();
    const client = await pool.connect();

    try {
      // Ejecutar el schema
      await client.query(schema);

      // Crear los tres partners iniciales
      const partners = ['Santiago Escobar', 'Adolfo Trujillo', 'David Gutiérrez'];
      const results = [];

      for (const name of partners) {
        const result = await client.query(
          'INSERT INTO partners (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name',
          [require('crypto').randomUUID(), name]
        );
        if (result.rowCount > 0) {
          results.push(result.rows[0]);
        }
      }

      return res.status(200).json({
        message: 'Schema initialized',
        partners: results,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Migration error:', error);
    return res.status(500).json({ error: error.message });
  }
}
