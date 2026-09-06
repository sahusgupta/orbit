import type { FirebaseApp } from 'firebase/app';
import type { AppCheck } from 'firebase/app-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ getToken: vi.fn(), initialize: vi.fn(), keys: [] as string[] }));
vi.mock('firebase/app-check', () => ({
  getToken: sdk.getToken,
  initializeAppCheck: sdk.initialize,
  ReCaptchaEnterpriseProvider: class { constructor(key: string) { sdk.keys.push(key); } }
}));
import { initializeWebAppCheck, webAppCheckHeaders } from './app-check';
const app = {} as FirebaseApp;
const check = { app } as AppCheck;

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.clearAllMocks(); sdk.keys.length = 0; });

describe('browser App Check', () => {
  it('requires a site key when enabled and initializes the Enterprise provider', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_CHECK_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_APP_CHECK_SITE_KEY', '');
    expect(() => initializeWebAppCheck(app)).toThrow('not configured');
    vi.stubEnv('NEXT_PUBLIC_APP_CHECK_SITE_KEY', 'public-test-site-key');
    initializeWebAppCheck(app);
    expect(sdk.keys).toEqual(['public-test-site-key']);
    expect(sdk.initialize).toHaveBeenCalledWith(app, expect.objectContaining({ isTokenAutoRefreshEnabled: true }));
  });

  it('permits an unenforced development client without contacting the provider', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_CHECK_ENABLED', 'false');
    expect(initializeWebAppCheck(app)).toBeUndefined();
    await expect(webAppCheckHeaders(undefined)).resolves.toEqual({});
    expect(sdk.getToken).not.toHaveBeenCalled();
  });

  it('attaches the SDK token and fails closed without exposing provider failures', async () => {
    sdk.getToken.mockResolvedValueOnce({ token: 'synthetic-attestation' });
    await expect(webAppCheckHeaders(check)).resolves.toEqual({ 'X-Firebase-AppCheck': 'synthetic-attestation' });
    sdk.getToken.mockRejectedValueOnce(new Error('sensitive-provider-detail'));
    await expect(webAppCheckHeaders(check)).rejects.toThrow('Browser verification is unavailable.');
    sdk.getToken.mockResolvedValueOnce({ token: '' });
    await expect(webAppCheckHeaders(check)).rejects.toThrow('Browser verification is unavailable.');
  });

  it('times out a hanging provider after ten seconds', async () => {
    vi.useFakeTimers();
    sdk.getToken.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(webAppCheckHeaders(check)).rejects.toThrow('Browser verification is unavailable.');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
