import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlayerRequestMetrics, requestJson } from './boundedFetch';

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
