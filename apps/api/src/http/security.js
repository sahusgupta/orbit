const { sendOperationalAlert } = require('./operationalAlerts');
const { isHostedOrProduction, protectedIdentifier } = require('./dataProtection');
const { consumeRateLimit } = require('../db/rateLimits');

function configuredOrigins() {
  return new Set(String(process.env.ORBIT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean));
}

function isSameOrigin(request, origin) {
  const protocol = request.secure ? 'https' : 'http';
  return origin === `${protocol}://${request.get('host')}`;
}

function enforceCors(request, response, next) {
  const origin = String(request.get('origin') || '').replace(/\/$/, '');
  if (!origin) {
    next();
    return;
  }
  const allowed = configuredOrigins();
  const localDevelopmentOrigin = !isHostedOrProduction(process.env) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.has(origin) && !isSameOrigin(request, origin) && !localDevelopmentOrigin) {
    response.status(403).json({ ok: false, error: 'Origin is not allowed.' });
    return;
  }
  response.set('access-control-allow-origin', origin);
  response.set('vary', 'Origin');
  response.set('access-control-allow-credentials', 'true');
  response.set('access-control-allow-methods', 'GET,HEAD,POST,DELETE,OPTIONS');
  response.set('access-control-allow-headers', 'authorization,content-type,x-firebase-appcheck,x-orbit-api-key,x-orbit-auth-key,x-orbit-client-key,x-orbit-check-in-session,x-orbit-check-in-token,x-orbit-csrf,x-orbit-mutation-id,x-orbit-request-id');
  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }
  next();
}

function applySecurityHeaders(_request, response, next) {
  response.set({
    'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY'
  });
  if (isHostedOrProduction(process.env)) {
    response.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function rejectUnexpectedFileUploads(request, response, next) {
  const contentType = String(request.get('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    response.status(415).json({
      ok: false,
      code: 'FILE_UPLOADS_NOT_SUPPORTED',
      error: 'This API does not accept file uploads.'
    });
    return;
  }
  next();
}

function rateLimitIdentity(request, identity = 'address') {
  const credential = identity === 'address'
    ? ''
    : request.get('authorization') || request.get('x-orbit-api-key') || request.get('x-orbit-auth-key') || '';
  const material = credential ? `credential:${credential}` : `address:${request.ip || request.socket?.remoteAddress || 'unknown'}`;
  return protectedIdentifier(`rate-limit:${material}`);
}

function createRateLimit(options = {}) {
  const windowMs = Math.min(Math.max(Number(options.windowMs || 60_000), 1_000), 60 * 60 * 1000);
  const maximum = Math.min(Math.max(Number(options.maximum || 120), 1), 10_000);
  const consume = options.consume || consumeRateLimit;
  return async function rateLimit(request, response, next) {
    let bucket;
    let identityRef;
    try {
      identityRef = rateLimitIdentity(request, options.identity);
      const key = `${options.name || 'general'}:${identityRef}`;
      bucket = await consume({ key, maximum, windowMs });
    } catch {
      // No local fallback: accepting requests while the shared quota store is
      // unavailable would bypass the perimeter on every cold start.
      response.set('retry-after', '1');
      response.status(503).json({ ok: false, error: 'Request protection is temporarily unavailable. Try again later.', code: 'RATE_LIMIT_UNAVAILABLE' });
      return;
    }
    response.set('x-ratelimit-limit', String(maximum));
    response.set('x-ratelimit-remaining', String(Math.max(maximum - bucket.count, 0)));
    if (bucket.count > maximum) {
      if (bucket.firstRejection) {
        void sendOperationalAlert('authentication-abuse', 'warning', {
          limiter: options.name || 'general',
          identityRef,
          requestId: request.orbitRequestId || ''
        });
      }
      response.set('retry-after', String(Math.max(Math.ceil((bucket.resetAt - Date.now()) / 1000), 1)));
      response.status(429).json({ ok: false, error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}

module.exports = {
  applySecurityHeaders,
  configuredOrigins,
  createRateLimit,
  enforceCors,
  rejectUnexpectedFileUploads,
  rateLimitIdentity
};
