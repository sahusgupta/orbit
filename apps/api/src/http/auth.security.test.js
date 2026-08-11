import { afterEach, describe, expect, it, vi } from 'vitest';
import auth from './auth.js';

const { createRequireClientAuth } = auth;

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
});
