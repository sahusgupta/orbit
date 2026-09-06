import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppCheck } from 'firebase/app-check';

const sdk = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock('firebase/app-check', () => ({ getToken: sdk.getToken }));
import { appCheckHeaders, readAppCheckTokenExpiry } from './appCheckToken';

const appCheck = { app: {} } as AppCheck;
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('App Check token boundary', () => {
  it('uses the real token expiry for caching and rejects malformed or expired responses', () => {
    const token = `header.${btoa(JSON.stringify({ exp: 2000 }))}.signature`;
    expect(readAppCheckTokenExpiry(token, 1000)).toBe(2_000_000);
    expect(() => readAppCheckTokenExpiry(token, 2_000_000)).toThrow('invalid token');
    for (const payload of [{}, { exp: '2000' }, { exp: -1 }, { exp: 1e30 }]) {
      expect(() => readAppCheckTokenExpiry(`h.${btoa(JSON.stringify(payload))}.s`)).toThrow('invalid token');
    }
    expect(() => readAppCheckTokenExpiry('private-provider-error')).toThrow('invalid token');
  });

  it('attaches a verified SDK token and clears its deadline', async () => {
    vi.useFakeTimers();
    sdk.getToken.mockResolvedValueOnce({ token: 'synthetic-attestation' });
    await expect(appCheckHeaders(appCheck)).resolves.toEqual({ 'X-Firebase-AppCheck': 'synthetic-attestation' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never falls back to an unverified request or exposes provider diagnostics', async () => {
    sdk.getToken.mockRejectedValueOnce(new Error('sensitive-provider-detail'));
    await expect(appCheckHeaders(appCheck)).rejects.toThrow('Device verification is unavailable.');
    sdk.getToken.mockResolvedValueOnce({ token: '' });
    await expect(appCheckHeaders(appCheck)).rejects.toThrow('Device verification is unavailable.');
  });

  it('bounds an unavailable provider to ten seconds', async () => {
    vi.useFakeTimers();
    sdk.getToken.mockImplementationOnce(() => new Promise(() => {}));
    const result = expect(appCheckHeaders(appCheck)).rejects.toThrow('Device verification is unavailable.');
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not contact the provider for an explicitly disabled development client', async () => {
    await expect(appCheckHeaders(undefined)).resolves.toEqual({});
    expect(sdk.getToken).not.toHaveBeenCalled();
  });
});
