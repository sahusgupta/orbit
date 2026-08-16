import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, clubBeta, discovery } from '@/tests/fixtures';

vi.mock('server-only', () => ({}));

import { getPublicDiscovery } from './public-data';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('public Player Web discovery transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads every advertised public page so later clubs are discoverable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [clubAlpha],
        tournaments: [],
        registrations: [],
        page: { count: 1, hasMore: true, nextCursor: clubAlpha.club.id }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [clubBeta],
        tournaments: discovery.tournaments,
        registrations: [],
        page: { count: 1, hasMore: false, nextCursor: null }
      }));

    const result = await getPublicDiscovery();

    expect(result).toMatchObject({
      status: 'ready',
      data: {
        clubs: [{ club: { id: clubAlpha.club.id } }, { club: { id: clubBeta.club.id } }],
        page: { count: 2, hasMore: false, nextCursor: null }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining(`cursor=${encodeURIComponent(clubAlpha.club.id)}`),
      expect.any(Object)
    );
  });

  it('aborts a stalled public API read instead of allowing route loading to hang forever', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));

    const result = getPublicDiscovery();
    await vi.advanceTimersByTimeAsync(8_001);

    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await expect(result).resolves.toEqual({
      status: 'error',
      message: 'Orbit live data took too long to respond. Try again.'
    });
  });
});
