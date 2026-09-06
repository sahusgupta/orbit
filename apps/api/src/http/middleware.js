const crypto = require('crypto');
const { protectedIdentifier, redactText } = require('./dataProtection');
const { sendOperationalAlert } = require('./operationalAlerts');

function assignRequestId(request, response, next) {
  const supplied = String(request.get('x-orbit-request-id') || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{8,160}$/.test(supplied) ? supplied : crypto.randomUUID();
  request.orbitRequestId = requestId;
  response.set('x-orbit-request-id', requestId);
  next();
}

function requestRouteTemplate(request) {
  const baseUrl = String(request.baseUrl || '').replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 80);
  const routePath = typeof request.route?.path === 'string'
    ? request.route.path.replace(/[^A-Za-z0-9/:._-]/g, '').slice(0, 160)
    : '';
  return routePath ? `${baseUrl}${routePath}` : 'unmatched-route';
}

function handleApiError(error, request, response, _next) {
  if (error?.name === 'ManagementAccountError' && [400, 404, 409, 503].includes(Number(error.status))) {
    response.status(Number(error.status)).json({
      ok: false,
      error: redactText(error.message, 300),
      code: String(error.code || 'MANAGEMENT_ACCOUNT_ERROR')
    });
    return;
  }
  const errorRef = protectedIdentifier(error?.stack || error?.message || request.orbitRequestId);
  const pathname = requestRouteTemplate(request);
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    event: 'api-error',
    requestRef: protectedIdentifier(request.orbitRequestId),
    method: request.method,
    pathname,
    errorRef,
    message: process.env.NODE_ENV === 'production'
      ? 'Unhandled API error.'
      : redactText(error instanceof Error ? error.message : 'Request failed.', 300),
    stack: process.env.NODE_ENV === 'production' ? undefined : redactText(error?.stack, 2000)
  }));
  void sendOperationalAlert('api-error', 'critical', {
    requestRef: protectedIdentifier(request.orbitRequestId),
    method: request.method,
    pathname,
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
  handleApiError,
  requestRouteTemplate
};
