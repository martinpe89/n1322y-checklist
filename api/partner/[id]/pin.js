const { query } = require('../../../_lib/db');
const { ok, badRequest, notFound, serverError } = require('../../../_lib/response');
const { requireSession } = require('../../../_lib/middleware');
const { hashPin, verifyPin } = require('../../../_lib/auth');

async function handlePin(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { newPin, oldPin } = req.body;

    if (!newPin) {
      return badRequest(res, 'New PIN required');
    }

    // Validar formato del PIN (4 dígitos)
    if (!/^\d{4}$/.test(newPin)) {
      return badRequest(res, 'PIN must be exactly 4 digits');
    }

    // Obtener el partner
    const partnerResult = await query(
      'SELECT id, name, pin_hash FROM partners WHERE id = $1',
      [id]
    );

    if (partnerResult.rowCount === 0) {
      return notFound(res, 'Partner not found');
    }

    const partner = partnerResult.rows[0];

    // Si ya tiene PIN, verificar el PIN anterior
    if (partner.pin_hash && !oldPin) {
      return badRequest(res, 'Current PIN required to change');
    }

    if (partner.pin_hash && oldPin) {
      if (!verifyPin(oldPin, partner.pin_hash)) {
        return badRequest(res, 'Invalid current PIN');
      }
    }

    // Hash del nuevo PIN
    const newPinHash = hashPin(newPin);

    // Actualizar
    await query(
      'UPDATE partners SET pin_hash = $1 WHERE id = $2',
      [newPinHash, id]
    );

    return ok(res, {
      partnerId: id,
      message: 'PIN updated',
    });
  } catch (error) {
    console.error('PIN error:', error);
    return serverError(res, error.message);
  }
}

export default requireSession(handlePin);
