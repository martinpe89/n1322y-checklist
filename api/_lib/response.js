function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(data));
}

function ok(res, data) {
  json(res, 200, data);
}

function created(res, data) {
  json(res, 201, data);
}

function badRequest(res, message) {
  json(res, 400, { error: message });
}

function unauthorized(res, message = 'Unauthorized') {
  json(res, 401, { error: message });
}

function notFound(res, message = 'Not found') {
  json(res, 404, { error: message });
}

function conflict(res, data) {
  json(res, 409, data);
}

function serverError(res, message = 'Internal server error') {
  json(res, 500, { error: message });
}

module.exports = { ok, created, badRequest, unauthorized, notFound, conflict, serverError };
