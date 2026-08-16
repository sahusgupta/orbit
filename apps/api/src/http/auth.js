const crypto = require('crypto');
const { authenticatePilotLicense } = require('../licenseService');

const productionDashboardCookieName = '__Host-orbit_dashboard';
const developmentDashboardCookieName = 'orbit_dashboard_dev';

function getReceivedApiKey(request) {
  return (
    request.get('x-orbit-api-key') ||
    request.get('x-orbit-auth-key') ||
    request.get('x-orbit-client-key') ||
    request.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    ''
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(request) {
  return Object.fromEntries(String(request.get('cookie') || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function dashboardSessionSecret() {
  return String(process.env.ORBIT_DASHBOARD_SESSION_SECRET || '').trim();
}

function getDashboardSessionConfigurationError() {
  if (!String(process.env.ORBIT_DASHBOARD_PASSWORD || '')) {
    return {
      code: 'DASHBOARD_PASSWORD_NOT_CONFIGURED',
      error: 'Dashboard password authentication is not configured.'
    };
  }
  if (dashboardSessionSecret().length < 32) {
    return {
      code: 'DASHBOARD_SESSION_SECRET_NOT_CONFIGURED',
      error: 'Dashboard session signing is not configured.'
    };
  }
  return null;
}

function encodeDashboardSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', dashboardSessionSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeDashboardSession(token, nowMs = Date.now()) {
  const [body, signature] = String(token || '').split('.', 2);
  const secret = dashboardSessionSecret();
  if (!body || !signature || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.aud !== 'orbit-dashboard' || !Number.isFinite(payload.exp) || payload.exp <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

function createDashboardSession(password, nowMs = Date.now()) {
  const configuredPassword = String(process.env.ORBIT_DASHBOARD_PASSWORD || '');
  const secret = dashboardSessionSecret();
  if (!configuredPassword || secret.length < 32 || !safeEqual(password, configuredPassword)) return null;
  const maximumMinutes = Math.min(Math.max(Number(process.env.ORBIT_DASHBOARD_SESSION_MINUTES || 30), 5), 120);
  return encodeDashboardSession({
    aud: 'orbit-dashboard',
    iat: nowMs,
    exp: nowMs + maximumMinutes * 60 * 1000,
    jti: crypto.randomUUID()
  });
}

function getDashboardSessionCookie(token, options = {}) {
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  return [
    `${secure ? productionDashboardCookieName : developmentDashboardCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.min(Math.max(Number(process.env.ORBIT_DASHBOARD_SESSION_MINUTES || 30), 5), 120) * 60}`
  ].filter(Boolean).join('; ');
}

function getExpiredDashboardSessionCookie(options = {}) {
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  return [
    `${secure ? productionDashboardCookieName : developmentDashboardCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    'Max-Age=0'
  ].filter(Boolean).join('; ');
}

function requireDashboardAuth(request, response, next) {
  const cookies = parseCookies(request);
  const session = decodeDashboardSession(cookies[productionDashboardCookieName] || cookies[developmentDashboardCookieName]);
  if (!session) {
    response.status(401).json({ ok: false, error: 'Dashboard session required.' });
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method) && request.get('x-orbit-csrf') !== '1') {
    response.status(403).json({ ok: false, error: 'Dashboard request verification failed.' });
    return;
  }
  request.orbitAuth = { type: 'dashboard-session', sessionId: session.jti };
  next();
}

function isPilotAuthorizationCode(value) {
  return /^TT-PILOT-[A-F0-9]{24}$/i.test(String(value || '').trim());
}

function parseMachineCredentials() {
  const configured = String(process.env.ORBIT_MACHINE_CREDENTIALS_JSON || '').trim();
  if (!configured) {
    if (process.env.ORBIT_ALLOW_LEGACY_CLIENT_KEY === 'true' && process.env.ORBIT_CLIENT_API_KEY) {
      return [{
        id: 'legacy-local-client',
        key: process.env.ORBIT_CLIENT_API_KEY,
        accountKey: String(process.env.ORBIT_CLIENT_ACCOUNT_KEY || '').trim(),
        scopes: ['client:write'],
        expiresAt: ''
      }];
    }
    return [];
  }
  try {
    const records = JSON.parse(configured);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function authenticateMachineCredential(received, nowMs = Date.now()) {
  for (const credential of parseMachineCredentials()) {
    if (!credential || !safeEqual(received, credential.key)) continue;
    if (credential.expiresAt && Date.parse(credential.expiresAt) <= nowMs) return null;
    const scopes = Array.isArray(credential.scopes) ? credential.scopes.filter((scope) => typeof scope === 'string') : [];
    if (!credential.id || !credential.accountKey || !scopes.length) return null;
    return {
      type: 'machine-key',
      credentialId: String(credential.id),
      accountKey: String(credential.accountKey).trim().toLowerCase(),
      scopes
    };
  }
  return null;
}

function requireOwnerApiKey(request, response, next) {
  const configuredKey = String(process.env.ORBIT_OWNER_API_KEY || '').trim();
  if (!configuredKey) {
    response.status(503).json({ ok: false, error: 'Owner API access is not configured.' });
    return;
  }
  if (!safeEqual(getReceivedApiKey(request), configuredKey)) {
    response.status(401).json({ ok: false, error: 'Owner authentication failed.' });
    return;
  }
  request.orbitAuth = { type: 'owner-api-key', scopes: ['owner:*'] };
  next();
}

function createRequireClientAuth(dependencies = {}) {
  const authenticate = dependencies.authenticatePilotLicense || authenticatePilotLicense;
  return async function requireClientAuthentication(request, response, next) {
    const remoteAddress = request.socket?.remoteAddress || '';
    const isLoopbackRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
    const explicitLocalBypass = process.env.ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH === 'true';
    if (explicitLocalBypass && isLoopbackRequest && process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      request.orbitAuth = { type: 'local-development', scopes: ['client:write'] };
      next();
      return;
    }
    const received = getReceivedApiKey(request);
    const machine = authenticateMachineCredential(received);
    if (machine) {
      request.orbitAuth = machine;
      next();
      return;
    }
    if (isPilotAuthorizationCode(received)) {
      const result = await authenticate(received);
      if (result.managed) {
        if (!result.active) {
          response.status(403).json({ ok: false, error: 'Pilot license is inactive.', code: 'PILOT_LICENSE_INACTIVE' });
          return;
        }
        request.orbitAuth = {
          type: 'pilot-key',
          accountKey: result.license.accountKey,
          scopes: ['client:write'],
          license: result.license
        };
        next();
        return;
      }
      response.status(401).json({ ok: false, error: 'Pilot license is not registered.' });
      return;
    }
    response.status(401).json({ ok: false, error: 'Client authentication failed.' });
  };
}

const requireClientAuth = createRequireClientAuth();

function blockLatestStateForPilotAuth(request, response, next) {
  if (request.orbitAuth?.accountKey) {
    response.status(403).json({ ok: false, error: 'Tenant-scoped clients must request their own venue state.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

module.exports = {
  asyncRoute,
  authenticateMachineCredential,
  blockLatestStateForPilotAuth,
  createDashboardSession,
  createRequireClientAuth,
  decodeDashboardSession,
  getDashboardSessionCookie,
  getDashboardSessionConfigurationError,
  getExpiredDashboardSessionCookie,
  getReceivedApiKey,
  requireClientAuth,
  requireDashboardAuth,
  requireOwnerApiKey,
  safeEqual
};
