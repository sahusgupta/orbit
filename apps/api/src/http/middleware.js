const crypto = require('crypto');
const { protectedIdentifier, redactText } = require('./dataProtection');
const { sendOperationalAlert } = require('./operationalAlerts');

function assignRequestId(request, response, next) {
  const requestId = request.get('x-orbit-request-id') || crypto.randomUUID();
  request.orbitRequestId = requestId;
  response.set('x-orbit-request-id', requestId);
  next();
}

function handleApiError(error, request, response, _next) {
  const errorRef = protectedIdentifier(error?.stack || error?.message || request.orbitRequestId);
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'api-error',
    requestId: request.orbitRequestId || '',
    method: request.method,
    pathname: request.path,
    errorRef,
    message: redactText(error instanceof Error ? error.message : 'Request failed.', 300),
    stack: process.env.NODE_ENV === 'production' ? undefined : redactText(error?.stack, 2000)
  }));
  void sendOperationalAlert('api-error', 'critical', {
    requestId: request.orbitRequestId || '',
    method: request.method,
    pathname: request.path,
    errorRef
  });
  if (error?.code === 'STATE_REVISION_CONFLICT') {
    response.status(409).json({
      ok: false,
      code: error.code,
      error: 'This venue changed elsewhere. Refresh before replaying the mutation.',
      expectedRevision: error.expectedRevision,
      currentRevision: error.currentRevision
    });
    return;
  }
  if (error?.type === 'entity.too.large') {
    response.status(413).json({ ok: false, error: 'Request payload is too large.', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  if (error?.name === 'IdentityDeletionError' && [409, 503].includes(Number(error.status))) {
    response.status(Number(error.status)).json({
      ok: false,
      error: redactText(error.message, 300),
      code: Number(error.status) === 409 ? 'IDENTITY_DELETION_PENDING' : 'IDENTITY_PROVIDER_UNAVAILABLE'
    });
    return;
  }
  const isValidation = error instanceof SyntaxError || /\b(required|invalid|must|cannot|expected)\b/i.test(String(error?.message || ''));
  response.status(isValidation ? 400 : 500).json({
    ok: false,
    error: isValidation ? 'Request validation failed.' : 'Request could not be completed.',
    code: isValidation ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
    requestId: request.orbitRequestId || ''
  });
}

module.exports = {
  assignRequestId,
  handleApiError
};
