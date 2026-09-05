import { afterEach, describe, expect, it, vi } from 'vitest';
import middleware from './middleware.js';

const { handleApiError } = middleware;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('API error log protection', () => {
  it('logs only generic production text and HMAC references for sensitive failures', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORBIT_LOG_HASH_SECRET', 'middleware-log-hash-secret-with-at-least-32-characters');
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warningOutput = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    const fixture = 'Bearer middleware-private-token-value';

    handleApiError(
      new Error(`${fixture}; barcode=RAW-MIDDLEWARE-PDF417`),
      {
        orbitRequestId: 'opaque-request-id',
        method: 'POST',
        path: '/player/private-player@example.test',
        baseUrl: '',
        route: { path: '/player/:playerId' }
      },
      response
    );
    await Promise.resolve();

    const consoleText = JSON.stringify([
      ...errorOutput.mock.calls,
      ...warningOutput.mock.calls
    ]);
    expect(consoleText).toContain('Unhandled API error.');
    expect(consoleText).toContain('/player/:playerId');
    expect(consoleText).toMatch(/[a-f0-9]{16}/);
    expect(consoleText).not.toContain('private-player@example.test');
    expect(consoleText).not.toContain('middleware-private-token-value');
    expect(consoleText).not.toContain('RAW-MIDDLEWARE-PDF417');
    expect(response).toMatchObject({
      statusCode: 500,
      body: { ok: false, error: 'Request could not be completed.', code: 'INTERNAL_ERROR' }
    });
  });
});
