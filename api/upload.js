const crypto = require('crypto');
const { ok, badRequest, serverError } = require('./_lib/response');
const { requireSession } = require('./_lib/middleware');

async function handleUpload(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { flightId, photoType } = req.body;

    if (!flightId || !photoType) {
      return badRequest(res, 'Flight ID and photo type required');
    }

    if (!['start', 'end'].includes(photoType)) {
      return badRequest(res, 'Photo type must be start or end');
    }

    // Generar un path único para la foto en Blob
    const photoKey = `photos/${flightId}/${photoType}-${crypto.randomUUID()}.jpg`;

    // Devolver la instrucción para que el cliente cargue directamente a Blob
    // El cliente usará la Vercel Blob API con el token
    return ok(res, {
      photoKey,
      blobToken: process.env.BLOB_READ_WRITE_TOKEN,
      instructions: 'POST to https://blob.vercelusercontent.com with multipart/form-data',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handleUpload);
