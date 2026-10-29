import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type TransportClient = {
  getApiConfig(): { apiUrl: string; apiKey: string };
  requestOrbitApi(pathname: string, options?: { authKey?: string; method?: string; body?: unknown }): Promise<unknown>;
  saveStateToApi(state: unknown): Promise<unknown>;
  subscribeToManagementState(access: unknown, callback: (event: unknown) => void): () => void;
};
type Connection = (options: { signal: AbortSignal }) => Promise<unknown>;
type Environment = { ORBIT_API_URL: string; ORBIT_CLIENT_API_KEY?: string };
const { createOrbitApiClient }: {
  createOrbitApiClient(dependencies: Record<string, unknown>): TransportClient;
} = require('../../electron/orbitApiClient.cjs');

const snapshot = (authorizationCode = 'synthetic-snapshot-key') => ({
  games: [{ id: 'synthetic-game', name: 'Café 🂡 / "quoted"' }],
  sessions: [],
  playerSessions: [],
  feedback: [{ id: 'synthetic-feedback', text: 'Line one\nLine two\t\\ / café 🂡' }],
  settings: { pilotAccess: { licenseId: 'club-one', authorizationCode } }
});
const response = (payload: Record<string, unknown>, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(payload)
});
const fixture = (overrides: Record<string, unknown> = {}) => {
  const fetch = vi.fn<(_url: string, options: RequestInit) => Promise<ReturnType<typeof response>>>()
    .mockResolvedValue(response({ ok: true, accountKey: 'club-one', revision: 1 }));
  const readLocalDatabase = vi.fn(() => ({ state: snapshot('synthetic-cached-key') }));
  const writeOrbitApiLog = vi.fn<(level: string, event: string, details: Record<string, unknown>) => void>();
  const setTimeoutImpl = vi.fn(() => 71);
  const clearTimeoutImpl = vi.fn();
  const dependencies = {
    app: {},
    environment: { ORBIT_API_URL: 'http://127.0.0.1:4310///' },
    fetchImpl: fetch,
    readLocalDatabase,
    writeOrbitApiLog,
    setTimeoutImpl,
    clearTimeoutImpl,
    randomUUID: () => 'synthetic-request-id',
    nowMs: () => 1000,
    ...overrides
  };
  return { client: createOrbitApiClient(dependencies), fetch, readLocalDatabase, writeOrbitApiLog, setTimeoutImpl, clearTimeoutImpl };
};

describe('Electron save transport characterization', () => {
  it('preserves exact Unicode request bytes, mutation hash and state-byte diagnostic fields', async () => {
    const state = snapshot();
    const serializedState = JSON.stringify(state);
    const payloadBytes = Buffer.byteLength(serializedState, 'utf8');
    const stateHash = createHash('sha256').update(serializedState).digest('hex').slice(0, 32);
    const expectedBody = JSON.stringify({ state, expectedRevision: 0, mutationId: `desktop:club-one:0:${stateHash}` });
    const { client, fetch, writeOrbitApiLog } = fixture();

    await expect(client.saveStateToApi(state)).resolves.toMatchObject({ ok: true, revision: 1 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4310/state');
    expect(fetch.mock.calls[0][1].body).toBe(expectedBody);
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      'content-type': 'application/json',
      'x-orbit-api-key': 'synthetic-snapshot-key',
      'x-orbit-auth-key': 'synthetic-snapshot-key',
      'x-orbit-mutation-id': `desktop:club-one:0:${stateHash}`
    });
    const attempts = writeOrbitApiLog.mock.calls.filter(([, event]) => [
      'state-save-attempt', 'state-api-request', 'state-api-result'
    ].includes(event));
    expect(attempts).toHaveLength(3);
    expect(attempts.map(([, , details]) => details.payloadBytes)).toEqual([payloadBytes, payloadBytes, payloadBytes]);
    expect(payloadBytes).toBeGreaterThan(serializedState.length);
  });

  it.each([
    { explicit: 'synthetic-explicit', configured: 'synthetic-configured', cached: 'synthetic-cached', expected: 'synthetic-explicit' },
    { explicit: '', configured: 'synthetic-configured', cached: 'synthetic-cached', expected: 'synthetic-configured' },
    { explicit: undefined, configured: '', cached: '  synthetic-cached  ', expected: 'synthetic-cached' },
    { explicit: ' ', configured: 'synthetic-configured', cached: 'synthetic-cached', expected: ' ' }
  ])('preserves explicit/configured/cached credential precedence and truthiness: $expected', async ({ explicit, configured, cached, expected }) => {
    const readLocalDatabase = vi.fn(() => ({ state: snapshot(cached) }));
    const { client, fetch } = fixture({
      environment: { ORBIT_API_URL: 'http://127.0.0.1:4310', ORBIT_CLIENT_API_KEY: configured },
      readLocalDatabase
    });

    await client.requestOrbitApi('/synthetic-read', { authKey: explicit });

    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'x-orbit-api-key': expected, 'x-orbit-auth-key': expected });
  });

  it('preserves public config shape and quietly avoids transport when fallback credentials are unavailable', async () => {
    const readLocalDatabase = vi.fn(() => { throw new Error('synthetic cache unavailable'); });
    const { client, fetch, setTimeoutImpl } = fixture({ readLocalDatabase });
    expect(client.getApiConfig()).toEqual({ apiUrl: 'http://127.0.0.1:4310', apiKey: '' });
    await expect(client.requestOrbitApi('/synthetic-read')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(setTimeoutImpl).not.toHaveBeenCalled();
  });

  it.each([null, false, 0, ''])('preserves existing diagnostic bytes for falsy direct-client state %s', async (state) => {
    const { client, writeOrbitApiLog } = fixture({
      environment: { ORBIT_API_URL: 'http://127.0.0.1:4310', ORBIT_CLIENT_API_KEY: 'synthetic-configured' }
    });
    await client.saveStateToApi(state);
    const attempt = writeOrbitApiLog.mock.calls.find(([, event]) => event === 'state-save-attempt');
    const request = writeOrbitApiLog.mock.calls.find(([, event]) => event === 'state-api-request');
    expect(attempt?.[2].payloadBytes).toBe(Buffer.byteLength(JSON.stringify(state), 'utf8'));
    expect(request?.[2].payloadBytes).toBe(2);
  });

  it('retains idempotent request bytes and expected revision after an unconfirmed transport attempt', async () => {
    const state = snapshot();
    const { client, fetch } = fixture();
    fetch.mockRejectedValueOnce(new Error('synthetic unconfirmed transport'));
    await expect(client.saveStateToApi(state)).resolves.toBeNull();
    await expect(client.saveStateToApi(state)).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(JSON.parse(String(fetch.mock.calls[1][1].body))).toMatchObject({ state, expectedRevision: 0 });
  });

  it('preserves serialization failure before transport and leaves the next valid queued save usable', async () => {
    const state = snapshot();
    const cyclic = Object.assign(state, { cycle: state });
    const { client, fetch, writeOrbitApiLog, setTimeoutImpl } = fixture();
    await expect(client.saveStateToApi(cyclic)).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    expect(writeOrbitApiLog).not.toHaveBeenCalled();
    expect(setTimeoutImpl).not.toHaveBeenCalled();
    await expect(client.saveStateToApi(snapshot())).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).expectedRevision).toBe(0);
  });

  it('retains request-log ordering, null result and timer cleanup when only the wrapper is cyclic', async () => {
    const state = snapshot();
    const body: { state: typeof state; expectedRevision: number; cycle?: unknown } = { state, expectedRevision: 0 };
    body.cycle = body;
    const { client, fetch, writeOrbitApiLog, clearTimeoutImpl } = fixture();
    await expect(client.requestOrbitApi('/state', { method: 'POST', body })).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(writeOrbitApiLog.mock.calls.map(([, event]) => event)).toEqual(['state-api-request', 'sync-update-failed']);
    expect(writeOrbitApiLog.mock.calls[0][2].payloadBytes).toBe(Buffer.byteLength(JSON.stringify(state), 'utf8'));
    expect(writeOrbitApiLog.mock.calls[1][2].errorName).toBe('TypeError');
    expect(clearTimeoutImpl).toHaveBeenCalledExactlyOnceWith(71);
  });

  it.each([false, true])('preserves diagnostic failure rejection/null behavior and cleanup (failure logger throws: %s)', async (failureLoggerThrows) => {
    const writeOrbitApiLog = vi.fn((_level: string, event: string) => {
      if (event === 'state-api-request' || failureLoggerThrows) throw new Error('synthetic diagnostic unavailable');
    });
    const { client, fetch, clearTimeoutImpl } = fixture({ writeOrbitApiLog });
    const request = client.requestOrbitApi('/state', { method: 'POST', body: { state: snapshot(), expectedRevision: 0 } });
    if (failureLoggerThrows) {
      await expect(request).rejects.toThrow('synthetic diagnostic unavailable');
    } else {
      await expect(request).resolves.toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(writeOrbitApiLog.mock.calls.map(([, event]) => event)).toEqual(['state-api-request', 'sync-update-failed']);
    expect(clearTimeoutImpl).toHaveBeenCalledExactlyOnceWith(71);
  });

  it('keeps explicit SSE credentials ahead of configured and cached credentials', async () => {
    let connect: Connection | undefined;
    const { client, fetch } = fixture({
      createStateEvents: (options: { connect: Connection }) => { connect = options.connect; return () => undefined; }
    });
    client.subscribeToManagementState({ licenseId: 'club-one', authorizationCode: 'synthetic-stream-key' }, vi.fn());
    if (!connect) throw new Error('Expected a synthetic stream connection');
    await connect({ signal: new AbortController().signal });
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:4310/state/club-one/events');
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'x-orbit-auth-key': 'synthetic-stream-key' });
  });

  it('re-resolves fallback SSE credentials on every reconnect without changing config precedence', async () => {
    let connect: Connection | undefined;
    let cachedKey = 'synthetic-cache-first';
    const environment: Environment = { ORBIT_API_URL: 'http://127.0.0.1:4310' };
    const { client, fetch } = fixture({
      environment,
      readLocalDatabase: () => ({ state: snapshot(cachedKey) }),
      createStateEvents: (options: { connect: Connection }) => { connect = options.connect; return () => undefined; }
    });
    client.subscribeToManagementState({ licenseId: 'club-one' }, vi.fn());
    if (!connect) throw new Error('Expected a synthetic stream connection');
    await connect({ signal: new AbortController().signal });
    cachedKey = 'synthetic-cache-second';
    await connect({ signal: new AbortController().signal });
    environment.ORBIT_CLIENT_API_KEY = 'synthetic-configured';
    await connect({ signal: new AbortController().signal });
    expect(fetch.mock.calls.map(([, options]) => options.headers)).toEqual([
      expect.objectContaining({ 'x-orbit-auth-key': 'synthetic-cache-first' }),
      expect.objectContaining({ 'x-orbit-auth-key': 'synthetic-cache-second' }),
      expect.objectContaining({ 'x-orbit-auth-key': 'synthetic-configured' })
    ]);
  });
});

describe('Electron save transport resource bounds', () => {
  it('traverses a stable full snapshot only twice for one accepted save', async () => {
    const state = snapshot();
    const serialize = vi.fn(() => state);
    const serializableState = { ...state, toJSON: serialize };
    const { client, fetch } = fixture();
    await expect(client.saveStateToApi(serializableState)).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).state).toEqual(state);
  });

  it('does not decode the fallback cache when the state already supplies its authentication key', async () => {
    const { client, fetch, readLocalDatabase } = fixture();
    await expect(client.saveStateToApi(snapshot())).resolves.toMatchObject({ ok: true, revision: 1 });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'x-orbit-auth-key': 'synthetic-snapshot-key' });
    expect(readLocalDatabase).not.toHaveBeenCalled();
  });

  it('does not decode fallback credentials for an explicitly authenticated SSE connection', async () => {
    let connect: Connection | undefined;
    const { client, readLocalDatabase } = fixture({
      createStateEvents: (options: { connect: Connection }) => { connect = options.connect; return () => undefined; }
    });
    client.subscribeToManagementState({ licenseId: 'club-one', authorizationCode: 'synthetic-stream-key' }, vi.fn());
    if (!connect) throw new Error('Expected a synthetic stream connection');
    await connect({ signal: new AbortController().signal });
    expect(readLocalDatabase).not.toHaveBeenCalled();
  });
});
