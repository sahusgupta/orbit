import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from './auth.js';

const {
  authenticateMachineCredential,
  createDashboardSession,
  createRequireClientAuth,
  decodeDashboardSession,
  getDashboardSessionCookie,
  getDashboardSessionConfigurationError,
  getReceivedApiKey
} = auth;

function responseHarness() {
  const result = { statusCode: 200, payload: undefined };
  return {
    result,
    response: {
      status(code) {
        result.statusCode = code;
        return this;
      },
      json(payload) {
        result.payload = payload;
        return this;
      }
    }
  };
}

afterEach(() => {
  delete process.env.ORBIT_CLIENT_API_KEY;
  delete process.env.ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH;
  delete process.env.ORBIT_MACHINE_CREDENTIALS_JSON;
  delete process.env.ORBIT_DASHBOARD_PASSWORD;
  delete process.env.ORBIT_DASHBOARD_SESSION_SECRET;
  delete process.env.VERCEL;
  delete process.env.NODE_ENV;
});

describe('pilot authorization containment', () => {
  it('rejects a format-valid but unregistered pilot code even when body state repeats it', async () => {
    process.env.NODE_ENV = 'production';
    const authorizationCode = 'TT-PILOT-1234567890ABCDEF12345678';
    const authenticatePilotLicense = vi.fn().mockResolvedValue({ managed: false, active: false, license: null });
    const middleware = createRequireClientAuth({ authenticatePilotLicense });
    const { response, result } = responseHarness();
    const next = vi.fn();
    const request = {
      body: {
        state: {
          settings: {
            pilotAccess: { authorizationCode, expiresAt: '2099-01-01' }
          }
        }
      },
      get(name) {
        return name === 'x-orbit-api-key' ? authorizationCode : '';
      },
      query: {},
      socket: { remoteAddress: '203.0.113.10' }
    };

    await middleware(request, response, next);

    expect(authenticatePilotLicense).toHaveBeenCalledWith(authorizationCode);
    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({
      statusCode: 401,
      payload: { ok: false, error: 'Pilot license is not registered.' }
    });
  });

  it('never accepts API credentials from query parameters', () => {
    const request = { get: () => '', query: { apiKey: 'query-secret' } };
    expect(getReceivedApiKey(request)).toBe('');
  });

  it('requires an explicit local-only flag and rejects loopback bypass in production', async () => {
    const middleware = createRequireClientAuth({ authenticatePilotLicense: vi.fn() });
    const run = async (environment, allowBypass) => {
      process.env.NODE_ENV = environment;
      process.env.ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH = allowBypass;
      const { response, result } = responseHarness();
      const next = vi.fn();
      await middleware({ get: () => '', query: {}, socket: { remoteAddress: '127.0.0.1' } }, response, next);
      return { next, result };
    };

    expect((await run('development', 'false')).result.statusCode).toBe(401);
    expect((await run('production', 'true')).result.statusCode).toBe(401);
    expect((await run('development', 'true')).next).toHaveBeenCalledOnce();
  });

  it('accepts only tenant-bound, scoped, unexpired machine credentials', () => {
    process.env.ORBIT_MACHINE_CREDENTIALS_JSON = JSON.stringify([
      { id: 'expired', key: 'expired-key', accountKey: 'club-one', scopes: ['client:write'], expiresAt: '2020-01-01T00:00:00.000Z' },
      { id: 'active', key: 'active-key', accountKey: 'club-two', scopes: ['client:write'], expiresAt: '2099-01-01T00:00:00.000Z' },
      { id: 'unscoped', key: 'unscoped-key', accountKey: '', scopes: [] }
    ]);

    expect(authenticateMachineCredential('expired-key')).toBeNull();
    expect(authenticateMachineCredential('unscoped-key')).toBeNull();
    expect(authenticateMachineCredential('active-key')).toEqual({
      type: 'machine-key',
      credentialId: 'active',
      accountKey: 'club-two',
      scopes: ['client:write']
    });
  });

  it('issues short-lived signed dashboard sessions with hardened cookies', () => {
    process.env.NODE_ENV = 'production';
    process.env.ORBIT_DASHBOARD_PASSWORD = 'correct horse battery staple';
    process.env.ORBIT_DASHBOARD_SESSION_SECRET = 'dashboard-session-signing-secret';
    const now = Date.parse('2026-08-11T12:00:00.000Z');
    expect(createDashboardSession('wrong', now)).toBeNull();
    const token = createDashboardSession('correct horse battery staple', now);
    expect(token).toBeTruthy();
    expect(decodeDashboardSession(token, now + 1_000)).toMatchObject({ aud: 'orbit-dashboard' });
    expect(decodeDashboardSession(`${token}tampered`, now + 1_000)).toBeNull();
    expect(decodeDashboardSession(token, now + 31 * 60_000)).toBeNull();
    expect(getDashboardSessionCookie(token)).toMatch(/HttpOnly; SameSite=Lax; Secure;/);
  });

  it('distinguishes missing dashboard password and session-signing configuration', () => {
    expect(getDashboardSessionConfigurationError()).toEqual({
      code: 'DASHBOARD_PASSWORD_NOT_CONFIGURED',
      error: 'Dashboard password authentication is not configured.'
    });

    process.env.ORBIT_DASHBOARD_PASSWORD = 'configured-dashboard-password';
    process.env.ORBIT_DASHBOARD_SESSION_SECRET = 'too-short';
    expect(getDashboardSessionConfigurationError()).toEqual({
      code: 'DASHBOARD_SESSION_SECRET_NOT_CONFIGURED',
      error: 'Dashboard session signing is not configured.'
    });

    process.env.ORBIT_DASHBOARD_SESSION_SECRET = 'dashboard-session-signing-secret';
    expect(getDashboardSessionConfigurationError()).toBeNull();
  });
});
