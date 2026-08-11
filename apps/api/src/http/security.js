const crypto = require('crypto');

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
  const localDevelopmentOrigin = process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed.has(origin) && !isSameOrigin(request, origin) && !localDevelopmentOrigin) {
    response.status(403).json({ ok: false, error: 'Origin is not allowed.' });
    return;
  }
  response.set('access-control-allow-origin', origin);
  response.set('vary', 'Origin');
  response.set('access-control-allow-credentials', 'true');
  response.set('access-control-allow-methods', 'GET,HEAD,POST,DELETE,OPTIONS');
  response.set('access-control-allow-headers', 'authorization,content-type,x-orbit-api-key,x-orbit-auth-key,x-orbit-client-key,x-orbit-csrf,x-orbit-mutation-id,x-orbit-request-id');
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
  if (process.env.NODE_ENV === 'production') {
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

function rateLimitIdentity(request) {
  const credential = request.get('authorization') || request.get('x-orbit-api-key') || request.get('x-orbit-auth-key') || '';
  const material = credential ? `credential:${credential}` : `address:${request.ip || request.socket?.remoteAddress || 'unknown'}`;
  return crypto.createHash('sha256').update(material).digest('hex').slice(0, 24);
}

function createRateLimit(options = {}) {
  const windowMs = Math.min(Math.max(Number(options.windowMs || 60_000), 1_000), 60 * 60 * 1000);
  const maximum = Math.min(Math.max(Number(options.maximum || 120), 1), 10_000);
  const buckets = new Map();
  return function rateLimit(request, response, next) {
    const now = Date.now();
    const key = `${options.name || 'general'}:${rateLimitIdentity(request)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(candidate);
      }
    }
    response.set('x-ratelimit-limit', String(maximum));
    response.set('x-ratelimit-remaining', String(Math.max(maximum - bucket.count, 0)));
    if (bucket.count > maximum) {
      response.set('retry-after', String(Math.max(Math.ceil((bucket.resetAt - now) / 1000), 1)));
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
