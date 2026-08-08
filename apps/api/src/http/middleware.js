const crypto = require('crypto');

function assignRequestId(request, response, next) {
  const requestId = request.get('x-orbit-request-id') || crypto.randomUUID();
  request.orbitRequestId = requestId;
  response.set('x-orbit-request-id', requestId);
  next();
}

function handleApiError(error, request, response, _next) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'api-error',
    requestId: request.orbitRequestId || '',
    method: request.method,
    pathname: request.path,
    message: error instanceof Error ? error.message : 'Request failed.',
    stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack
  }));
  response.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
}

module.exports = {
  assignRequestId,
  handleApiError
};
