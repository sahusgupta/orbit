import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlayerRequestMetrics, requestJson } from './boundedFetch';

const originalApiUrl = vi.hoisted(() => {
  const previous = process.env.EXPO_PUBLIC_ORBIT_API_URL;
  process.env.EXPO_PUBLIC_ORBIT_API_URL = 'http://127.0.0.1:9';
  return previous;
});
vi.mock('../firebase/firebaseClient', () => ({
  auth: { currentUser: null },
  getPlayerAppCheckHeaders: vi.fn(async () => ({}))
}));
import { fetchPublicPlayerDiscovery } from './playerHttpApi';

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterAll(() => {
  if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_ORBIT_API_URL;
  else process.env.EXPO_PUBLIC_ORBIT_API_URL = originalApiUrl;
});

function stalledBodyImplementation(status: number, error = new DOMException('Synthetic response body aborted', 'AbortError')): typeof fetch {
  return async (_input, init) => {
    if (!init?.signal) throw new Error('The request did not provide an abort signal.');
    const signal = init.signal;
    if (signal.aborted) throw signal.reason ?? error;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (signal.aborted) { controller.error(error); return; }
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        signal.addEventListener('abort', () => controller.error(error), { once: true });
      }
    });
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
}

const stalledBodyFetch = (status: number) => vi.fn(stalledBodyImplementation(status));

describe('bounded player HTTP requests', () => {
  it('deduplicates concurrent GET requests and releases the in-flight key', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const first = requestJson('https://api.example.test/player/discovery', {}, { dedupeKey: 'discovery:player-1' });
    const second = requestJson('https://api.example.test/player/discovery', {}, { dedupeKey: 'discovery:player-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
    resolveFetch(response({ ok: true }));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    await requestJson('https://api.example.test/player/discovery', {}, { dedupeKey: 'discovery:player-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a failed GET once but never retries a mutation', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockRejectedValueOnce(new Error('mutation outcome unknown'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('https://api.example.test/read', {}, { readRetries: 1 })).resolves.toMatchObject({
      payload: { ok: true }
    });
    await expect(requestJson('https://api.example.test/write', { method: 'POST' }, { readRetries: 2 }))
      .rejects.toThrow('mutation outcome unknown');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('aborts at the configured deadline and records only a redacted path metric', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('https://api.example.test/player/discovery?playerId=secret', {}, {
      readRetries: 0,
      timeoutMs: 5
    })).rejects.toThrow('Aborted');

    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({
      method: 'GET',
      outcome: 'timeout',
      path: '/player/discovery'
    });
  });

  it('honors caller cancellation without retrying the cancelled read', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const operation = requestJson('https://api.example.test/player/profile', { signal: controller.signal });
    controller.abort();
    await expect(operation).rejects.toThrow('Aborted');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'cancelled', path: '/player/profile' });
  });
});

describe('player response-body fallback characterization', () => {
  beforeEach(() => vi.useFakeTimers());

  it.each([200, 400, 500])('retains the empty payload fallback for malformed JSON with HTTP %i', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{ malformed', { status }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('http://127.0.0.1:9/synthetic-body', {}, { readRetries: 0 }))
      .resolves.toMatchObject({ response: { status }, payload: {} });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: status === 200 ? 'ok' : 'http-error' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a mutation HTTP error without retrying or discarding its valid JSON body', async () => {
    const payload = { error: 'Synthetic server error' };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestJson('http://127.0.0.1:9/synthetic-body', { method: 'POST' }, { readRetries: 2 }))
      .resolves.toMatchObject({ response: { status: 500 }, payload });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ method: 'POST', outcome: 'http-error' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the bounded GET server-error retry and final successful payload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{ malformed', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const operation = requestJson('http://127.0.0.1:9/synthetic-body', {}, { readRetries: 1 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(operation).resolves.toMatchObject({ payload: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'ok' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans the deadline and caller abort listener after an ordinary response body', async () => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    await expect(requestJson('http://127.0.0.1:9/synthetic-body', { signal: controller.signal }))
      .resolves.toMatchObject({ payload: { ok: true } });
    expect(addListener).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('player response-body deadlines and cancellation', () => {
  beforeEach(() => vi.useFakeTimers());

  it.each([
    { method: 'GET', status: 200 }, { method: 'GET', status: 500 },
    { method: 'POST', status: 200 }, { method: 'POST', status: 500 }
  ])('propagates a $method body deadline after HTTP $status headers and cleans its owners', async ({ method, status }) => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchMock = stalledBodyFetch(status);
    vi.stubGlobal('fetch', fetchMock);
    const outcome = requestJson('http://127.0.0.1:9/synthetic-body?playerId=private-fixture', {
      method, signal: controller.signal
    }, { readRetries: method === 'GET' ? 0 : 2, timeoutMs: 10 })
      .then((value) => ({ status: 'resolved', value }), (error: unknown) => ({ status: 'rejected', error }));

    await vi.advanceTimersByTimeAsync(10);
    expect.soft(await outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } });
    expect.soft(getPlayerRequestMetrics().at(-1)).toMatchObject({ method, outcome: 'timeout', path: '/synthetic-body' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])('recovers a GET body timeout after HTTP %i through the existing one-retry bound', async (status) => {
    const fetchMock = stalledBodyFetch(status);
    fetchMock.mockImplementationOnce(stalledBodyImplementation(status)).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = requestJson('http://127.0.0.1:9/synthetic-body', {}, { readRetries: 1, timeoutMs: 10 })
      .then((value) => ({ status: 'resolved', value }), (error: unknown) => ({ status: 'rejected', error }));

    await vi.advanceTimersByTimeAsync(210);
    expect.soft(fetchMock).toHaveBeenCalledTimes(2);
    expect(await outcome).toMatchObject({ status: 'resolved', value: { payload: { ok: true } } });
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'ok' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])('reports timeout after the last GET body attempt with HTTP %i', async (status) => {
    const fetchMock = stalledBodyFetch(status);
    vi.stubGlobal('fetch', fetchMock);
    const outcome = requestJson('http://127.0.0.1:9/synthetic-body', {}, { readRetries: 1, timeoutMs: 10 })
      .then((value) => ({ status: 'resolved', value }), (error: unknown) => ({ status: 'rejected', error }));

    await vi.advanceTimersByTimeAsync(220);
    expect.soft(fetchMock).toHaveBeenCalledTimes(2);
    expect.soft(await outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } });
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])('cancels HTTP %i body consumption without another GET or retained timer/listener', async (status) => {
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const fetchMock = stalledBodyFetch(status);
    vi.stubGlobal('fetch', fetchMock);
    const outcome = requestJson('http://127.0.0.1:9/synthetic-body', { signal: controller.signal }, { readRetries: 2 })
      .then((value) => ({ status: 'resolved', value }), (error: unknown) => ({ status: 'rejected', error }));

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    expect.soft(await outcome).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } });
    expect.soft(fetchMock).toHaveBeenCalledOnce();
    expect.soft(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'cancelled' });
    expect(removeListener).toHaveBeenCalledExactlyOnceWith('abort', addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects both coalesced body reads and releases the key for a later successful read', async () => {
    const fetchMock = stalledBodyFetch(200);
    fetchMock.mockImplementationOnce(stalledBodyImplementation(200)).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const options = { dedupeKey: 'synthetic-body:player', readRetries: 0, timeoutMs: 10 };
    const settled = Promise.allSettled([
      requestJson('http://127.0.0.1:9/synthetic-body', {}, options),
      requestJson('http://127.0.0.1:9/synthetic-body', {}, options)
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10);
    const results = await settled;
    const failedMetric = getPlayerRequestMetrics().at(-1);
    await expect(requestJson('http://127.0.0.1:9/synthetic-body', {}, options)).resolves.toMatchObject({ payload: { ok: true } });
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(failedMetric).toMatchObject({ outcome: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets the actual public discovery reader decode a successful retry after a stalled body', async () => {
    const payload = { ok: true, clubs: [], tournaments: [], interests: [], page: { count: 0, hasMore: false, nextCursor: null } };
    const fetchMock = stalledBodyFetch(200);
    fetchMock.mockImplementationOnce(stalledBodyImplementation(200)).mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = fetchPublicPlayerDiscovery()
      .then((value) => ({ status: 'resolved', value }), (error: unknown) => ({ status: 'rejected', error }));

    await vi.advanceTimersByTimeAsync(12_200);
    expect.soft(fetchMock).toHaveBeenCalledTimes(2);
    expect(await outcome).toMatchObject({ status: 'resolved', value: payload });
    expect(getPlayerRequestMetrics().at(-1)).toMatchObject({ outcome: 'ok', path: '/player/public/discovery' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
