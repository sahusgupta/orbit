const crypto = require('crypto');
const { authenticatePilotLicense, registerPilotLicense } = require('../licenseService');
const { requireFirebasePlayer } = require('../paymentService');

function getReceivedApiKey(request) {
  return (
    request.get('x-orbit-api-key') ||
    request.get('x-orbit-auth-key') ||
    request.get('x-orbit-client-key') ||
    request.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.query.apiKey
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireDashboardAuth(request, response, next) {
  const configuredPassword = process.env.ORBIT_DASHBOARD_PASSWORD || process.env.ORBIT_DASHBOARD_API_KEY || process.env.ORBIT_CLIENT_API_KEY;
  const configuredUser = process.env.ORBIT_DASHBOARD_USER || 'orbit-admin';
  if (!configuredPassword) {
    response.status(500).send('Dashboard auth is not configured.');
    return;
  }

  const header = request.get('authorization') || '';
  const dashboardKey = request.get('x-orbit-api-key') || request.query.apiKey || '';
  if (dashboardKey && safeEqual(dashboardKey, configuredPassword)) {
    next();
    return;
  }
  const [scheme, credentials] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() === 'basic' && credentials) {
    const decoded = Buffer.from(credentials, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (safeEqual(username, configuredUser) && safeEqual(password, configuredPassword)) {
      next();
      return;
    }
  }

  response.set('www-authenticate', 'Basic realm="Orbit Dashboard", charset="UTF-8"');
  response.status(401).send('Authentication required.');
}

function isPilotAuthorizationCode(value) {
  return /^TT-PILOT-[A-F0-9]{24}$/i.test(String(value || '').trim());
}

function requireOwnerApiKey(request, response, next) {
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  if (!configuredKey) {
    response.status(500).json({ ok: false, error: 'ORBIT_CLIENT_API_KEY is not configured.' });
    return;
  }
  const received = getReceivedApiKey(request);
  if (received !== configuredKey) {
    response.status(401).json({ ok: false, error: 'Invalid API key.' });
    return;
  }
  request.orbitAuth = { type: 'owner-api-key' };
  next();
}

async function requireClientAuth(request, response, next) {
  const remoteAddress = request.socket?.remoteAddress || '';
  const isLoopbackRequest = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (process.env.NODE_ENV !== 'production' && isLoopbackRequest) {
    request.orbitAuth = { type: 'local-development' };
    next();
    return;
  }
  const configuredKey = process.env.ORBIT_CLIENT_API_KEY;
  const received = getReceivedApiKey(request);
  if (configuredKey && received === configuredKey) {
    request.orbitAuth = { type: 'owner-api-key' };
    next();
    return;
  }
  if (isPilotAuthorizationCode(received)) {
    const result = await authenticatePilotLicense(received);
    if (result.managed) {
      if (!result.active) {
        response.status(403).json({ ok: false, error: `Pilot license ${result.license?.status || 'expired'}.`, license: result.license });
        return;
      }
      request.orbitAuth = {
        type: 'pilot-key',
        accountKey: result.license.accountKey,
        license: result.license
      };
      next();
      return;
    }

    const legacyBootstrapEnabled = process.env.ORBIT_LICENSE_ALLOW_LEGACY_BOOTSTRAP !== 'false';
    const state = request.body?.state || request.body;
    const access = state?.settings?.pilotAccess;
    if (legacyBootstrapEnabled && access?.authorizationCode === received) {
      const license = await registerPilotLicense(access);
      if (!license || license.status !== 'active') {
        response.status(403).json({ ok: false, error: 'Pilot license is expired.', license });
        return;
      }
      request.orbitAuth = { type: 'pilot-key', accountKey: license.accountKey, license };
      next();
      return;
    }
    if (!legacyBootstrapEnabled) {
      response.status(401).json({ ok: false, error: 'Pilot license is not registered.' });
      return;
    }
    const isLegacyStatusCheck = request.method === 'GET' && request.path === '/license/status';
    const isLegacyVenueRead = request.method === 'GET' && request.path.startsWith('/state/');
    if (!isLegacyStatusCheck && !isLegacyVenueRead) {
      response.status(401).json({ ok: false, error: 'Pilot license is not registered. Sync the activated desktop installation to complete migration.' });
      return;
    }
    request.orbitAuth = {
      type: 'legacy-pilot-key',
      accountKey: '',
      authorizationCode: received
    };
    next();
    return;
  }
  response.status(401).json({ ok: false, error: 'Invalid API key or pilot authorization code.' });
}

function blockLatestStateForPilotAuth(request, response, next) {
  if (request.orbitAuth?.type === 'pilot-key' || request.orbitAuth?.type === 'legacy-pilot-key') {
    response.status(403).json({ ok: false, error: 'Pilot-authenticated clients must request their own venue state.' });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function optionalFirebasePlayer(request, response, next) {
  if (!request.get('authorization')) {
    next();
    return;
  }
  requireFirebasePlayer(request, response, next);
}

module.exports = {
  asyncRoute,
  blockLatestStateForPilotAuth,
  optionalFirebasePlayer,
  requireClientAuth,
  requireDashboardAuth,
  requireOwnerApiKey
};
