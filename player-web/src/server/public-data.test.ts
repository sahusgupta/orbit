import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, clubBeta, discovery } from '@/tests/fixtures';

vi.mock('server-only', () => ({}));

import { getPublicClub, getPublicDiscovery } from './public-data';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function controlledJsonResponse(signal: AbortSignal) {
  let finishBody: (payload: unknown) => void = () => { throw new Error('Response body has not started.'); };
  let removeAbortListener = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const onAbort = () => {
        if (!open) return;
        open = false;
        removeAbortListener();
        controller.error(new DOMException('Aborted', 'AbortError'));
      };
      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      finishBody = (payload) => {
        if (!open) return;
        open = false;
        removeAbortListener();
        controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
        controller.close();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    cancel() {
      removeAbortListener();
    }
  });
  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } }),
    finish: (payload: unknown) => finishBody(payload)
  };
}

const singlePage = {
  ok: true,
  clubs: [clubAlpha],
  tournaments: [],
  interests: [],
  page: { count: 1, hasMore: false, nextCursor: null }
};

describe('public Player Web discovery transport', () => {
  beforeEach(() => {
    vi.stubEnv('ORBIT_API_URL', 'http://127.0.0.1:9');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('loads every advertised public page so later clubs are discoverable', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [clubAlpha],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: clubAlpha.club.id }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [clubBeta],
        tournaments: discovery.tournaments,
        interests: [],
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

  it('preserves club payloads, encoded paths and the public cache policy', async () => {
    const payload = { club: clubAlpha, tournaments: discovery.tournaments };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(payload));

    await expect(getPublicClub('club / alpha?')).resolves.toEqual({ status: 'ready', data: payload });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:9/player/public/clubs/club%20%2F%20alpha%3F',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        next: { revalidate: 30 },
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('retains the boundary error for an unsuccessful API response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'Synthetic club unavailable.' }, 503));

    await expect(getPublicClub(clubAlpha.club.id)).resolves.toEqual({
      status: 'error',
      message: 'Synthetic club unavailable.'
    });
  });

  it('retains the discovery fallback for malformed JSON and clears its timer', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));

    await expect(getPublicDiscovery()).resolves.toEqual({
      status: 'error',
      message: 'Live Orbit discovery is temporarily unavailable.'
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains non-timeout transport errors and releases the request timer', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Synthetic network unavailable.'));

    await expect(getPublicDiscovery()).resolves.toEqual({
      status: 'error',
      message: 'Synthetic network unavailable.'
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the discovery deadline active after headers while the body is stalled', async () => {
    vi.useFakeTimers();
    const bodies: Array<{ signal: AbortSignal; finish: (payload: unknown) => void }> = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('A request abort signal is required.');
      const body = controlledJsonResponse(signal);
      bodies.push({ signal, finish: body.finish });
      return body.response;
    });
    let settled = false;
    const pending = getPublicDiscovery().then((result) => { settled = true; return result; });

    try {
      await vi.advanceTimersByTimeAsync(8_001);
      expect(bodies[0]?.signal.aborted).toBe(true);
      expect(settled).toBe(true);
      await expect(pending).resolves.toEqual({
        status: 'error',
        message: 'Orbit live data took too long to respond. Try again.'
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      bodies.forEach((body) => body.finish(singlePage));
      await pending;
    }
  });

  it('bounds a stalled club response body with the same deadline and timeout error', async () => {
    vi.useFakeTimers();
    const bodies: Array<{ signal: AbortSignal; finish: (payload: unknown) => void }> = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('A request abort signal is required.');
      const body = controlledJsonResponse(signal);
      bodies.push({ signal, finish: body.finish });
      return body.response;
    });
    let settled = false;
    const pending = getPublicClub(clubAlpha.club.id).then((result) => { settled = true; return result; });

    try {
      await vi.advanceTimersByTimeAsync(8_001);
      expect(bodies[0]?.signal.aborted).toBe(true);
      expect(settled).toBe(true);
      await expect(pending).resolves.toEqual({
        status: 'error',
        message: 'Orbit live data took too long to respond. Try again.'
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      bodies.forEach((body) => body.finish({ club: clubAlpha, tournaments: [] }));
      await pending;
    }
  });

  it('retains one total discovery budget across page bodies', async () => {
    vi.useFakeTimers();
    const bodies: Array<{ signal: AbortSignal; finish: (payload: unknown) => void }> = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('A request abort signal is required.');
      const body = controlledJsonResponse(signal);
      bodies.push({ signal, finish: body.finish });
      return body.response;
    });
    const pending = getPublicDiscovery();

    try {
      await vi.advanceTimersByTimeAsync(5_000);
      bodies[0]?.finish({ ...singlePage, page: { count: 1, hasMore: true, nextCursor: clubAlpha.club.id } });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(bodies[0]?.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(3_001);
      expect(bodies[1]?.signal.aborted).toBe(true);
      await expect(pending).resolves.toEqual({
        status: 'error',
        message: 'Orbit live data took too long to respond. Try again.'
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      bodies.forEach((body) => body.finish(singlePage));
      await pending;
    }
  });

  it('accepts a body that completes before the deadline and releases its timer', async () => {
    vi.useFakeTimers();
    const bodies: Array<{ signal: AbortSignal; finish: (payload: unknown) => void }> = [];
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('A request abort signal is required.');
      const body = controlledJsonResponse(signal);
      bodies.push({ signal, finish: body.finish });
      return body.response;
    });
    const pending = getPublicDiscovery();
    await vi.advanceTimersByTimeAsync(7_999);
    bodies[0]?.finish(singlePage);

    await expect(pending).resolves.toMatchObject({ status: 'ready', data: { clubs: [clubAlpha] } });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bodies[0]?.signal.aborted).toBe(false);
  });
});
