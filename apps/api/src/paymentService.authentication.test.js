import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);
const adminProvider = require('./services/firebaseAdmin.js');

function observeAdminBoundary() {
  const modulePath = require.resolve('./paymentService.js');
  const previous = require.cache[modulePath];
  const sdk = vi.spyOn(adminProvider, 'getAdminSdk');
  const app = vi.spyOn(adminProvider, 'getAdminApp');
  delete require.cache[modulePath];
  return {
    service: require('./paymentService.js'), sdk, app,
    restore() {
      sdk.mockRestore(); app.mockRestore();
      if (previous) require.cache[modulePath] = previous;
      else delete require.cache[modulePath];
    }
  };
}

function responseRecorder() {
  /** @type {unknown} */
  let body;
  return {
    status: vi.fn(function status() { return this; }),
    json: vi.fn((value) => { body = value; }),
    get body() { return body; }
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('provider-free authentication rejection', () => {
  it('rejects a missing Firebase bearer token before selecting any Admin SDK or app', async () => {
    const observed = observeAdminBoundary();
    try {
      const response = responseRecorder();
      const next = vi.fn();
      await observed.service.requireFirebasePlayer({ get: () => '' }, response, next);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.body).toEqual({ ok: false, error: 'Firebase player sign-in is required.' });
      expect(next).not.toHaveBeenCalled();
      expect(observed.sdk).not.toHaveBeenCalled();
      expect(observed.app).not.toHaveBeenCalled();
    } finally { observed.restore(); }
  });

  it.each([
    { configured: '', received: '' },
    { configured: 'synthetic-revenuecat-token', received: 'Bearer mismatching-synthetic-token' }
  ])('rejects invalid RevenueCat authorization before selecting any Admin SDK or app (%j)', async ({ configured, received }) => {
    vi.stubEnv('REVENUECAT_WEBHOOK_AUTH_TOKEN', configured);
    const observed = observeAdminBoundary();
    try {
      const response = responseRecorder();
      await observed.service.handleRevenueCatWebhook({ get: () => received, body: {} }, response);
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.body).toEqual({ ok: false, error: 'Invalid RevenueCat webhook authorization.' });
      expect(observed.sdk).not.toHaveBeenCalled();
      expect(observed.app).not.toHaveBeenCalled();
    } finally { observed.restore(); }
  });
});
