import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_APP_CHECK_COOKIE, PLAYER_SESSION_COOKIE } from '@/src/auth/session-cookie';
import { config, proxy } from './proxy';

const originalApiOrigin = process.env.ORBIT_API_URL;

function protectedRequest(path: string, token?: string) {
  return new NextRequest(`https://player.example${path}`, token ? {
    headers: { cookie: `${PLAYER_SESSION_COOKIE}=${token}` }
  } : undefined);
}

beforeEach(() => {
  process.env.ORBIT_API_URL = 'https://api.example';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalApiOrigin === undefined) delete process.env.ORBIT_API_URL;
  else process.env.ORBIT_API_URL = originalApiOrigin;
});

describe('Player Web protected-route proxy', () => {
  it('covers every product and account route while leaving public routes unmatched', () => {
    expect(config.matcher).toEqual([
      '/games/:path*',
      '/clubs/:path*',
      '/tournaments/:path*',
      '/me/:path*'
    ]);
  });

  it('redirects a request without a session token and preserves its return path', async () => {
    const request = protectedRequest('/games?status=running');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://player.example/sign-in?returnTo=%2Fgames%3Fstatus%3Drunning');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('renders a protected route only after the Orbit API verifies the Firebase token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const response = await proxy(protectedRequest('/clubs/club-key', 'verified-token'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example/player/discovery?limit=1',
      expect.objectContaining({
        headers: { authorization: 'Bearer verified-token' },
        cache: 'no-store',
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('clears an invalid session token and redirects to account access', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const response = await proxy(protectedRequest('/tournaments/event-key', 'expired-token'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://player.example/sign-in?returnTo=%2Ftournaments%2Fevent-key');
    expect(response.headers.get('set-cookie')).toContain(`${PLAYER_SESSION_COOKIE}=`);
    expect(response.headers.get('set-cookie')).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('forwards browser attestation to the API and never treats the cookie as authorization', async () => {
    const request = new NextRequest('https://player.example/me/profile', {
      headers: { cookie: `${PLAYER_SESSION_COOKIE}=user-token; ${PLAYER_APP_CHECK_COOKIE}=attestation-token` }
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const response = await proxy(request);
    expect(fetchSpy).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { authorization: 'Bearer user-token', 'X-Firebase-AppCheck': 'attestation-token' }
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get('set-cookie')).toContain(`${PLAYER_APP_CHECK_COOKIE}=`);
  });

  it('fails closed when token verification is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const response = await proxy(protectedRequest('/me/profile', 'verified-token'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://player.example/sign-in?returnTo=%2Fme%2Fprofile');
  });

  it('bounds a stalled token verification request', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));

    const pendingResponse = proxy(protectedRequest('/games', 'verified-token'));
    await vi.advanceTimersByTimeAsync(8_001);

    await expect(pendingResponse).resolves.toMatchObject({ status: 307 });
  });

  it.each([200, 204, 299, 300, 401, 403, 500])('keeps the status-only authorization decision for HTTP %i without parsing a body', async (status) => {
    vi.useFakeTimers();
    const verification = new Response(status === 204 ? null : '{ malformed synthetic body', { status });
    const readJson = vi.spyOn(verification, 'json');
    const readText = vi.spyOn(verification, 'text');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(verification);

    const response = await proxy(protectedRequest('/clubs?tab=nearby', 'synthetic-status-token'));

    expect(readJson).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    if (status < 300) {
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(response.headers.get('set-cookie')).toBeNull();
    } else {
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBe('https://player.example/sign-in?returnTo=%2Fclubs%3Ftab%3Dnearby');
      expect(response.headers.get('set-cookie')).toContain(`${PLAYER_SESSION_COOKIE}=`);
      expect(response.headers.get('set-cookie')).toContain(`${PLAYER_APP_CHECK_COOKIE}=`);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns after successful headers without waiting for an unused JSON body', async () => {
    const verification = new Response(new ReadableStream<Uint8Array>(), { status: 200 });
    const readJson = vi.spyOn(verification, 'json');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(verification);

    try {
      const response = await proxy(protectedRequest('/games', 'synthetic-stream-token'));
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(readJson).not.toHaveBeenCalled();
      expect(verification.bodyUsed).toBe(false);
    } finally {
      await verification.body?.cancel();
    }
  });

  it.each([200, 401, 500])('releases the verification transport after HTTP %i headers', async (status) => {
    vi.useFakeTimers();
    const verification = new Response(new ReadableStream<Uint8Array>(), { status });
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      signal = init?.signal;
      return verification;
    });

    try {
      const response = await proxy(protectedRequest('/clubs', 'synthetic-cleanup-token'));
      expect(response.status).toBe(status === 200 ? 200 : 307);
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await verification.body?.cancel();
    }
  });
});
