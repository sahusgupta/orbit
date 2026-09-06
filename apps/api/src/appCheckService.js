const { getAdminApp, getAdminSdk } = require('./services/firebaseAdmin');

function isPlayerAppCheckRequired(environment = process.env) {
  return environment.ORBIT_REQUIRE_PLAYER_APP_CHECK === 'true';
}

function allowedPlayerAppIds(environment = process.env) {
  return String(environment.ORBIT_PLAYER_APP_CHECK_APP_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 256);
}

function createRequirePlayerAppCheck(options = {}) {
  const environment = options.environment || process.env;
  return async function requirePlayerAppCheck(request, response, next) {
    if (!isPlayerAppCheckRequired(environment)) {
      next();
      return;
    }
    const allowedAppIds = allowedPlayerAppIds(environment);
    if (!allowedAppIds.length) {
      response.status(503).json({
        ok: false,
        code: 'APP_CHECK_NOT_CONFIGURED',
        error: 'Orbit Player app attestation is not configured.'
      });
      return;
    }
    const token = String(request.get?.('x-firebase-appcheck') || '').trim();
    if (!token || token.length > 4096) {
      response.status(401).json({
        ok: false,
        code: 'APP_CHECK_REQUIRED',
        error: 'A valid Orbit Player app attestation is required.'
      });
      return;
    }
    try {
      const verifyToken = options.verifyToken || ((value) => {
        const admin = getAdminSdk();
        if (typeof admin.appCheck !== 'function') throw new Error('Firebase App Check verification is unavailable.');
        return admin.appCheck(getAdminApp()).verifyToken(value);
      });
      const result = await verifyToken(token);
      if (!result?.appId) throw new Error('App Check token is missing an application identity.');
      if (!allowedAppIds.includes(String(result.appId))) {
        response.status(401).json({
          ok: false,
          code: 'APP_CHECK_APP_NOT_ALLOWED',
          error: 'This application is not authorized for Orbit Player.'
        });
        return;
      }
      request.orbitAppCheck = { appId: String(result.appId), tokenType: result.tokenType || 'app-check' };
      next();
    } catch {
      response.status(401).json({
        ok: false,
        code: 'APP_CHECK_INVALID',
        error: 'Orbit Player app attestation could not be verified.'
      });
    }
  };
}

const requirePlayerAppCheck = createRequirePlayerAppCheck();

module.exports = {
  allowedPlayerAppIds,
  createRequirePlayerAppCheck,
  isPlayerAppCheckRequired,
  requirePlayerAppCheck
};
