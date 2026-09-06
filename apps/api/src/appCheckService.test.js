import { describe, expect, it, vi } from 'vitest';
import appCheckService from './appCheckService.js';

const { allowedPlayerAppIds, createRequirePlayerAppCheck, isPlayerAppCheckRequired } = appCheckService;

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('Player App Check boundary', () => {
  it('is an explicit activation gate and becomes fail-closed when enabled', () => {
    expect(isPlayerAppCheckRequired({ NODE_ENV: 'production' })).toBe(false);
    expect(isPlayerAppCheckRequired({ VERCEL: '1' })).toBe(false);
    expect(isPlayerAppCheckRequired({ ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true' })).toBe(true);
    expect(isPlayerAppCheckRequired({ NODE_ENV: 'test' })).toBe(false);
  });

  it('rejects missing and invalid attestations without reaching the route', async () => {
    const next = vi.fn();
    const missingResponse = responseHarness();
    const middleware = createRequirePlayerAppCheck({
      environment: { ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true', ORBIT_PLAYER_APP_CHECK_APP_IDS: 'orbit-ios-app' },
      verifyToken: vi.fn()
    });
    await middleware({ get: () => '' }, missingResponse, next);
    expect(missingResponse).toMatchObject({ statusCode: 401, body: { code: 'APP_CHECK_REQUIRED' } });

    const invalidResponse = responseHarness();
    const verifyToken = vi.fn().mockRejectedValue(new Error('invalid'));
    await createRequirePlayerAppCheck({
      environment: { ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true', ORBIT_PLAYER_APP_CHECK_APP_IDS: 'orbit-ios-app' },
      verifyToken
    })(
      { get: () => 'attestation-token' }, invalidResponse, next
    );
    expect(invalidResponse).toMatchObject({ statusCode: 401, body: { code: 'APP_CHECK_INVALID' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a verified application identity and never exposes the raw token', async () => {
    for (const appId of ['orbit-ios-app', 'orbit-player-web-app']) {
      const next = vi.fn();
      const request = { get: () => 'attestation-token' };
      await createRequirePlayerAppCheck({
        environment: {
          ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true',
          ORBIT_PLAYER_APP_CHECK_APP_IDS: 'orbit-ios-app,orbit-player-web-app'
        },
        verifyToken: vi.fn().mockResolvedValue({ appId, tokenType: 'app-check' })
      })(request, responseHarness(), next);
      expect(request.orbitAppCheck).toEqual({ appId, tokenType: 'app-check' });
      expect(JSON.stringify(request.orbitAppCheck)).not.toContain('attestation-token');
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('fails closed when activated without an allowlist or for another registered app', async () => {
    expect(allowedPlayerAppIds({ ORBIT_PLAYER_APP_CHECK_APP_IDS: ' orbit-ios-app, orbit-android-app ' }))
      .toEqual(['orbit-ios-app', 'orbit-android-app']);
    const next = vi.fn();
    const unconfigured = responseHarness();
    await createRequirePlayerAppCheck({
      environment: { ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true' },
      verifyToken: vi.fn()
    })({ get: () => 'token' }, unconfigured, next);
    expect(unconfigured).toMatchObject({ statusCode: 503, body: { code: 'APP_CHECK_NOT_CONFIGURED' } });

    const wrongApp = responseHarness();
    await createRequirePlayerAppCheck({
      environment: { ORBIT_REQUIRE_PLAYER_APP_CHECK: 'true', ORBIT_PLAYER_APP_CHECK_APP_IDS: 'orbit-ios-app' },
      verifyToken: vi.fn().mockResolvedValue({ appId: 'other-project-app' })
    })({ get: () => 'token' }, wrongApp, next);
    expect(wrongApp).toMatchObject({ statusCode: 401, body: { code: 'APP_CHECK_APP_NOT_ALLOWED' } });
    expect(next).not.toHaveBeenCalled();
  });
});
