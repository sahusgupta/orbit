import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import api from './orbitApiClient.cjs';
import local from './localStore.cjs';
import transport from './checkpointTransport.cjs';
import embedded from './embeddedBackend.cjs';

const state = (notes = '', account = 'checkpoint-fixture') => ({
  games: [], sessions: [], playerSessions: [],
  profiles: [{ id: 'synthetic-player', name: 'Synthetic', notes }],
  playerLedger: [{ id: 'retained-entry', amount: 50 }],
  settings: { pilotAccess: { licenseId: account, authorizationCode: 'synthetic-test-key' } }
});
const reply = (payload, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(payload) });
const base = (overrides = {}) => ({
  app: { getVersion: () => 'test' }, environment: { ORBIT_API_URL: 'http://127.0.0.1:4310' },
  readLocalDatabase: () => ({ state: state() }),
  writeLocalDatabase: vi.fn(), writeOrbitApiLog: vi.fn(),
  saveStateEverywhere: vi.fn(), loadStateWithFirebaseFallback: async () => null,
  ...overrides
});

describe('legacy desktop oversized save characterization', () => {
  it('cannot commit an ordinary action when retained non-telemetry history exceeds the legacy transport', async () => {
    const before = state('♠'.repeat(700_000));
    const after = { ...before, playerSessions: [{ id: 'ordinary-session' }] };
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(Buffer.byteLength(options.body, 'utf8')).toBeGreaterThan(2_000_000);
      return reply({ ok: false, error: 'request entity too large' }, 413);
    });
    const client = api.createOrbitApiClient(base({ fetchImpl }));
    expect(await client.saveStateToApi(after)).toBeNull();
    expect(after.playerLedger).toEqual(before.playerLedger);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:4310/state');
  });
});

function memoryFiles() {
  const files = new Map();
  return {
    files, existsSync: (name) => files.has(name), readFileSync: (name) => files.get(name), mkdirSync: () => {},
    writeFileSync: vi.fn((name, contents) => files.set(name, contents)),
    renameSync: vi.fn((from, to) => { files.set(to, files.get(from)); files.delete(from); })
  };
}

function durableStore(fileSystem = memoryFiles()) {
  const store = local.createLocalStore({
    app: { getPath: () => 'synthetic-user-data' }, fileSystem,
    encodeState: (value) => `encrypted-test:${Buffer.from(value).toString('base64')}`,
    decodeState: (value) => Buffer.from(value.slice('encrypted-test:'.length), 'base64').toString('utf8')
  });
  return { store, fileSystem };
}

const capabilities = {
  protocol: 'checkpoint-v1', chunkBytes: 262_144, maximumSourceBytes: 33_554_432,
  maximumChunks: 128, maximumEnvelopeBytes: 400_000, expiresAfterMs: 86_400_000
};

function checkpointServer() {
  const received = new Map();
  let upload;
  let committed;
  let effects = 0;
  let loseResponse = false;
  let interruptIndex = -1;
  let conflict = false;
  const requests = [];
  const fetchImpl = vi.fn(async (url, options) => {
    const pathname = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ pathname, body, options });
    if (pathname === '/state/capabilities') return reply({ ok: true, checkpoint: capabilities });
    if (pathname === '/state/checkpoints') {
      if (committed && body.mutationId === upload.mutationId) return reply({ ok: true, id: 'a'.repeat(64), received: [], completed: true, result: committed });
      upload = body;
      return reply({ ok: true, id: 'a'.repeat(64), received: [...received.keys()] });
    }
    if (pathname.endsWith('/finalize')) {
      if (conflict) return reply({ ok: false, code: 'STATE_REVISION_CONFLICT', currentRevision: 9 }, 409);
      const source = Buffer.concat([...received.entries()].sort(([left], [right]) => left - right).map(([, bytes]) => bytes));
      expect(createHash('sha256').update(source).digest('hex')).toBe(upload.sha256);
      if (!committed) { effects += 1; committed = { accountKey: upload.accountKey, mutationId: upload.mutationId, revision: upload.expectedRevision + 1, publication: { status: 'pending' } }; }
      if (loseResponse) { loseResponse = false; throw new Error('Synthetic response lost after commit'); }
      return reply({ ok: true, ...committed });
    }
    if (pathname.startsWith('/state/checkpoints/') && pathname.includes('/chunks/')) {
      const index = Number(pathname.split('/').at(-1));
      expect(Buffer.byteLength(options.body, 'utf8')).toBeLessThanOrEqual(400_000);
      if (index === interruptIndex) { interruptIndex = -1; return reply({ ok: false }, 503); }
      received.set(index, Buffer.from(body.data, 'base64'));
      return reply({ ok: true });
    }
    if (pathname === '/state/checkpoint/checkpoint-fixture') {
      if (!committed) return reply({ ok: false, code: 'CHECKPOINT_STATE_NOT_FOUND' }, 404);
      return reply({ ok: true, ...upload, revision: committed.revision, chunkBytes: capabilities.chunkBytes,
        ...(new URL(url).searchParams.get('knownRevision') === String(committed.revision) ? { notModified: true } : {}) });
    }
    if (pathname.startsWith('/state/checkpoint/') && pathname.includes('/chunks/')) {
      const index = Number(pathname.split('/').at(-1));
      return reply({ ok: true, accountKey: upload.accountKey, revision: committed.revision, index, data: received.get(index).toString('base64') });
    }
    throw new Error(`Unexpected isolated path: ${pathname}`);
  });
  return {
    fetchImpl, requests, received, get effects() { return effects; },
    loseNextCommitResponse: () => { loseResponse = true; }, interruptChunk: (index) => { interruptIndex = index; },
    setConflict: () => { conflict = true; }
  };
}

function clientFor(store, server, overrides = {}) {
  return api.createOrbitApiClient(base({
    ...store, fetchImpl: server.fetchImpl,
    setTimeoutImpl: vi.fn(() => 1), clearTimeoutImpl: vi.fn(),
    ...overrides
  }));
}

describe('durable desktop checkpoint bridge', () => {
  it('saves retained multibyte operational history above 2MB in bounded HTTP envelopes with pending publication distinct', async () => {
    const { store, fileSystem } = durableStore();
    const server = checkpointServer();
    const client = clientFor(store, server);
    const next = state('♠'.repeat(700_000));
    next.playerSessions.push({ id: 'ordinary-session' });
    expect(await client.getPersistenceCapabilities(next.settings.pilotAccess)).toMatchObject({ checkpoint: capabilities });
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: true, authoritative: true, revision: 1, publication: { status: 'pending' } });
    expect(server.effects).toBe(1);
    expect(server.requests.some(({ pathname }) => pathname === '/state')).toBe(false);
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
    expect(store.readLocalDatabase('checkpoint-fixture').state.playerLedger).toEqual(next.playerLedger);
    expect(JSON.stringify([...fileSystem.files.values()])).not.toContain('synthetic-player');
  });

  it('resumes interrupted chunks after process restart with the same operation and preserves pending state against remote refresh', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    server.interruptChunk(2);
    const next = state('🂡'.repeat(600_000));
    const firstClient = clientFor(store, server);
    expect(await firstClient.saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    const pending = store.readPendingState('checkpoint-fixture');
    expect(pending).toMatchObject({ expectedRevision: 0, state: next });
    expect(store.writeLocalDatabase(state('remote older state'))).toMatchObject({ ok: false, pending: true });
    store.closeDatabase();
    const secondClient = clientFor(store, server, { nowMs: () => pending.retryPolicy.notBeforeMs });
    expect(await secondClient.loadStateApiFirst('checkpoint-fixture', next.settings.pilotAccess)).toMatchObject({ authoritative: true, revision: 1, state: next });
    const starts = server.requests.filter(({ pathname }) => pathname === '/state/checkpoints');
    expect(starts.map(({ body }) => body.mutationId)).toEqual([pending.mutationId, pending.mutationId]);
    expect(server.requests.filter(({ pathname }) => pathname.endsWith('/chunks/0') && pathname.includes('/checkpoints/'))).toHaveLength(1);
    expect(server.effects).toBe(1);
  });

  it('retries a lost committed response across restart without repeating a business effect', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    server.loseNextCommitResponse();
    const next = state('Retained accounting');
    expect(await clientFor(store, server).saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    expect(server.effects).toBe(1);
    const pending = store.readPendingState('checkpoint-fixture');
    const mutationId = pending.mutationId;
    store.closeDatabase();
    expect(await clientFor(store, server, { nowMs: () => pending.retryPolicy.notBeforeMs }).loadStateApiFirst('checkpoint-fixture', next.settings.pilotAccess)).toMatchObject({ authoritative: true, revision: 1 });
    expect(server.effects).toBe(1);
    expect(server.requests.filter(({ pathname }) => pathname === '/state/checkpoints').at(-1).body.mutationId).toBe(mutationId);
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
  });

  it('retains a conflict for recovery and rejects a different new intent without overwriting it', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    server.setConflict();
    const client = clientFor(store, server);
    const next = state('pending check-in');
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: false, conflict: true, currentRevision: 9 });
    expect(await client.saveStateApiFirst(state('different action'))).toMatchObject({ ok: false, code: 'PENDING_SAVE_REQUIRES_RECOVERY' });
    expect(await client.loadStateFromApi('checkpoint-fixture', next.settings.pilotAccess)).toMatchObject({ authoritative: false, pending: true, state: next });
    expect(store.acknowledgePendingState('checkpoint-fixture', 'wrong-mutation')).toBe(false);
    expect(store.readPendingState('checkpoint-fixture').state).toEqual(next);
    expect(server.effects).toBe(0);
  });

  it('does not send or claim queued work when atomic local persistence fails', async () => {
    const { store, fileSystem } = durableStore();
    store.writeLocalDatabase(state('retained old cache'));
    fileSystem.renameSync.mockImplementationOnce(() => { throw new Error('Synthetic disk full'); });
    const server = checkpointServer();
    const result = await clientFor(store, server).saveStateApiFirst(state('new intent'));
    expect(result).toMatchObject({ ok: false, localPersistenceFailure: true });
    expect(server.requests).toHaveLength(0);
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
    expect(store.readLocalDatabase('checkpoint-fixture').state.profiles[0].notes).toBe('retained old cache');
    store.closeDatabase();
    expect(store.readLocalDatabase('checkpoint-fixture').state.profiles[0].notes).toBe('retained old cache');
  });

  it('rejects cross-tenant replay before sending retained work', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    const client = clientFor(store, server);
    client.preservePendingState(state('tenant-bound'));
    await expect(client.loadStateApiFirst('checkpoint-fixture', { licenseId: 'other-venue', authorizationCode: 'synthetic-other-key' })).rejects.toThrow('another venue');
    expect(server.requests).toHaveLength(0);
  });

  it('rejects corrupted or unbounded recovery responses before hydration', async () => {
    const source = Buffer.from(JSON.stringify(state('retained')));
    const manifest = { ok: true, protocol: 'checkpoint-v1', accountKey: 'checkpoint-fixture', revision: 1, sourceBytes: source.length, chunkCount: 1, chunkBytes: 262_144, sha256: 'a'.repeat(64) };
    const request = vi.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce({ ok: true, accountKey: 'checkpoint-fixture', revision: 1, index: 0, data: source.toString('base64') });
    await expect(transport.downloadCheckpoint(request, 'checkpoint-fixture', 'synthetic-test-key')).rejects.toThrow('checksum');
    const oversized = vi.fn().mockResolvedValue({ ...manifest, sourceBytes: 33_554_433 });
    await expect(transport.downloadCheckpoint(oversized, 'checkpoint-fixture', 'synthetic-test-key')).rejects.toThrow('manifest');
    expect(oversized).toHaveBeenCalledOnce();
  });

  it('retains oversized local work during API outage without sending it to the legacy parser', async () => {
    const { store } = durableStore();
    const fetchImpl = vi.fn(async () => { throw new Error('Synthetic offline'); });
    const client = clientFor(store, { fetchImpl });
    const next = state('♠'.repeat(700_000));
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    expect(store.readPendingState('checkpoint-fixture').state).toEqual(next);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/state/capabilities']);
  });

  it('measures complete legacy envelopes before transport even when state itself is below 2MB', async () => {
    const { store } = durableStore();
    const next = state();
    const overhead = Buffer.byteLength(JSON.stringify(next), 'utf8');
    next.profiles[0].notes = 'x'.repeat(2_000_000 - overhead - 5);
    expect(Buffer.byteLength(JSON.stringify(next), 'utf8')).toBe(1_999_995);
    const fetchImpl = vi.fn(async () => reply({ ok: true, checkpoint: null }));
    expect(await clientFor(store, { fetchImpl }).saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(store.readPendingState('checkpoint-fixture').sourceBytes).toBe(1_999_995);
  });

  it('bounds embedded request bodies in UTF-8 bytes and stops accumulating after rejection', async () => {
    const request = Object.assign(new EventEmitter(), { setEncoding: vi.fn(), destroy: vi.fn() });
    const read = embedded.readRequestBody(request);
    request.emit('data', '♠'.repeat(666_666));
    request.emit('data', '♠');
    request.emit('data', 'ignored');
    request.emit('end');
    await expect(read).rejects.toThrow('too large');
    expect(request.destroy).toHaveBeenCalledOnce();
  });

  it('pauses expired authentication and replays the immutable retained body under fresh same-tenant credentials', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    const realFetch = server.fetchImpl;
    const fetchImpl = vi.fn((url, options) => options.headers['x-orbit-api-key'] === 'fresh-synthetic-key'
      ? realFetch(url, options) : Promise.resolve(reply({ ok: false, code: 'PILOT_LICENSE_INACTIVE' }, 403)));
    const first = clientFor(store, { fetchImpl });
    const next = state('♠'.repeat(700_000));
    expect(await first.saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true, error: expect.stringContaining('Sign in') });
    const before = store.readPendingState('checkpoint-fixture');
    expect(fetchImpl).toHaveBeenCalledOnce();
    store.closeDatabase();
    const second = clientFor(store, { fetchImpl });
    const freshAccess = { ...next.settings.pilotAccess, authorizationCode: 'fresh-synthetic-key' };
    expect(await second.loadStateApiFirst('checkpoint-fixture', freshAccess))
      .toMatchObject({ authoritative: false, pending: true, state: next });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await second.resumePendingManagementState(freshAccess)).toMatchObject({ ok: true, pending: true });
    expect(server.effects).toBe(0);
    expect(await second.loadStateApiFirst('checkpoint-fixture', freshAccess))
      .toMatchObject({ authoritative: true, revision: 1, state: next });
    expect(server.requests.find(({ pathname }) => pathname === '/state/checkpoints').body.sha256).toBe(before.sha256);
    expect(server.requests.find(({ pathname }) => pathname === '/state/checkpoints').body.mutationId).toBe(before.mutationId);
    expect(server.effects).toBe(1);
  });

  it('reports background acknowledgements without state or customer records', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    const onManagementSaveStatus = vi.fn();
    const client = clientFor(store, server, { onManagementSaveStatus });
    expect(await client.saveStateApiFirst(state('private synthetic notes'))).toMatchObject({ ok: true });
    expect(onManagementSaveStatus).toHaveBeenCalledWith({ accountKey: 'checkpoint-fixture', ok: true, pending: false, sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), revision: 1, publication: { status: 'pending' } });
    expect(JSON.stringify(onManagementSaveStatus.mock.calls)).not.toContain('private synthetic notes');
  });

  it('does not fabricate a pending mutation on offline startup and retains the last acknowledged revision for later intent', async () => {
    const { store } = durableStore();
    const cached = state('acknowledged history');
    store.writeLocalDatabase(cached, 7);
    store.closeDatabase();
    const fetchImpl = vi.fn(async () => { throw new Error('Synthetic outage'); });
    const client = clientFor(store, { fetchImpl }, { loadStateWithFirebaseFallback: async (accountKey) => store.readLocalDatabase(accountKey) });
    expect(await client.loadStateApiFirst('checkpoint-fixture', cached.settings.pilotAccess)).toMatchObject({ authoritative: false, revision: 7, state: cached });
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
    const changed = state('new staff intent');
    expect(await client.saveStateApiFirst(changed)).toMatchObject({ ok: false, pending: true });
    expect(store.readPendingState('checkpoint-fixture')).toMatchObject({ expectedRevision: 7, state: changed });
  });

  it('pins a pending legacy receipt across server upgrade after a lost commit response', async () => {
    const { store } = durableStore();
    let upgraded = false;
    let effects = 0;
    let receipt;
    const next = state('legacy pending intent');
    const fetchImpl = vi.fn(async (url, options) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/state/capabilities') return reply({ ok: true, checkpoint: upgraded ? capabilities : null });
      expect(pathname).toBe('/state');
      const body = JSON.parse(options.body);
      if (!receipt) {
        receipt = body.mutationId;
        effects += 1;
        throw new Error('Synthetic response lost after legacy commit');
      }
      expect(body.mutationId).toBe(receipt);
      return reply({ ok: true, accountKey: 'checkpoint-fixture', revision: 1, duplicate: true });
    });
    expect(await clientFor(store, { fetchImpl }).saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    const pending = store.readPendingState('checkpoint-fixture');
    expect(store.readPendingState('checkpoint-fixture').transport).toBe('legacy');
    upgraded = true;
    store.closeDatabase();
    expect(await clientFor(store, { fetchImpl }, { nowMs: () => pending.retryPolicy.notBeforeMs }).saveStateApiFirst(next)).toMatchObject({ ok: true, duplicate: true });
    expect(effects).toBe(1);
    expect(fetchImpl.mock.calls.filter(([url]) => new URL(url).pathname === '/state')).toHaveLength(2);
  });

  it('respects Retry-After before automatic replay and reports the background acknowledgement', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    let fail = true;
    const fetchImpl = vi.fn(async (url, options) => {
      if (new URL(url).pathname.endsWith('/finalize') && fail) {
        fail = false;
        return { ...reply({ ok: false }, 503), headers: { get: () => '7' } };
      }
      return server.fetchImpl(url, options);
    });
    const scheduled = [];
    let wallClock = Date.UTC(2026, 10, 5);
    const onManagementSaveStatus = vi.fn();
    const client = clientFor(store, { fetchImpl }, { onManagementSaveStatus, nowMs: () => wallClock,
      setTimeoutImpl: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; } });
    expect(await client.saveStateApiFirst(state('transient outage'))).toMatchObject({ ok: false, pending: true });
    const retry = scheduled.find(({ delay }) => delay === 7000);
    expect(retry).toBeDefined();
    expect(server.effects).toBe(0);
    wallClock = store.readPendingState('checkpoint-fixture').retryPolicy.notBeforeMs;
    retry.callback();
    await vi.waitFor(() => expect(server.effects).toBe(1));
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
    expect(onManagementSaveStatus).toHaveBeenLastCalledWith(expect.objectContaining({ ok: true, pending: false, revision: 1 }));
  });

  it('cancels an oversized streamed checkpoint response at the response envelope boundary', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([97, 98, 99]));
      controller.enqueue(new Uint8Array([100, 101]));
    }, cancel });
    await expect(api.readApiResponse(new Response(body), 4)).rejects.toThrow('envelope budget');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('polls an unchanged revision without chunk downloads and reuses only an isolated verified canonical snapshot', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    const client = clientFor(store, server);
    const next = state('verified canonical notes');
    await client.saveStateApiFirst(next);
    const first = await client.loadStateFromApi('checkpoint-fixture', next.settings.pilotAccess);
    first.state.profiles[0].notes = 'changed optimistic caller copy';
    const chunksBefore = server.requests.filter(({ pathname }) => pathname.startsWith('/state/checkpoint/') && pathname.includes('/chunks/')).length;
    const second = await client.loadStateFromApi('checkpoint-fixture', next.settings.pilotAccess);
    expect(second.state.profiles[0].notes).toBe('verified canonical notes');
    expect(server.requests.filter(({ pathname }) => pathname.startsWith('/state/checkpoint/') && pathname.includes('/chunks/'))).toHaveLength(chunksBefore);
    expect(server.fetchImpl.mock.calls.at(-1)[0]).toContain('?knownRevision=1');
  });

  it('honors capability-discovery rate limits before attempting any mutation transport', async () => {
    const { store } = durableStore();
    const fetchImpl = vi.fn(async () => ({ ...reply({ ok: false }, 429), headers: { get: () => '7' } }));
    const scheduled = [];
    const client = clientFor(store, { fetchImpl }, { nowMs: () => 1000, setTimeoutImpl: (_callback, delay) => { scheduled.push(delay); return scheduled.length; } });
    expect(await client.saveStateApiFirst(state('rate-limited discovery'))).toMatchObject({ ok: false, pending: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(scheduled).toContain(7000);
    expect(store.readPendingState('checkpoint-fixture')).toBeTruthy();
  });

  it.each([
    ['wrong tenant', { accountKey: 'other-tenant' }],
    ['wrong operation', { mutationId: 'stale-operation' }],
    ['missing operation', { mutationId: undefined }],
    ['stale revision', { revision: 7 }],
    ['future revision', { revision: 9 }]
  ])('rejects a %s checkpoint acknowledgement for both finalization and completed receipt', async (_label, changed) => {
    const next = state('immutable checkpoint');
    const pending = { state: next, accountKey: 'checkpoint-fixture', expectedRevision: 7, mutationId: 'expected-operation', ...transport.sourceForState(next) };
    const valid = { ok: true, accountKey: pending.accountKey, mutationId: pending.mutationId, revision: 8 };
    for (const completed of [false, true]) {
      const request = vi.fn(async (pathname) => pathname === '/state/checkpoints'
        ? completed ? { ok: true, completed: true, result: { ...valid, ...changed } } : { ok: true, id: 'a'.repeat(64), received: [0] }
        : { ...valid, ...changed });
      expect(await transport.uploadCheckpoint(request, pending, 'synthetic-test-key')).toMatchObject({ ok: false, code: 'CHECKPOINT_ACK_INVALID', httpStatus: 409 });
    }
  });

  it('persists a bad-acknowledgement pause without clearing intent or confirming success across restart', async () => {
    const { store } = durableStore();
    const server = checkpointServer();
    const fetchImpl = vi.fn(async (url, options) => {
      const response = await server.fetchImpl(url, options);
      if (!new URL(url).pathname.endsWith('/finalize')) return response;
      return reply({ ...JSON.parse(await response.text()), mutationId: 'another-operation' });
    });
    const onManagementSaveStatus = vi.fn();
    const next = state('retained after bad acknowledgement');
    expect(await clientFor(store, { fetchImpl }, { onManagementSaveStatus }).saveStateApiFirst(next))
      .toMatchObject({ ok: false, pending: true, code: 'CHECKPOINT_ACK_INVALID' });
    expect(server.effects).toBe(1);
    expect(store.readPendingState('checkpoint-fixture')).toMatchObject({ pauseCode: 'CHECKPOINT_ACK_INVALID', state: next });
    expect(onManagementSaveStatus).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false, pending: true }));
    const before = server.fetchImpl.mock.calls.length;
    store.closeDatabase();
    expect(await clientFor(store, server).loadStateApiFirst('checkpoint-fixture', next.settings.pilotAccess))
      .toMatchObject({ authoritative: false, pending: true, state: next });
    expect(server.fetchImpl.mock.calls).toHaveLength(before);
    expect(store.readPendingState('checkpoint-fixture')).toMatchObject({ pauseCode: 'CHECKPOINT_ACK_INVALID' });
  });

  it.each([
    ['wrong tenant', { accountKey: 'other-tenant' }],
    ['wrong revision', { revision: 2 }],
    ['wrong index', { index: 1 }]
  ])('rejects a recovery chunk with %s even when its bytes and checksum match', async (_label, changed) => {
    const source = Buffer.from(JSON.stringify(state('verified chunk contents')));
    const manifest = { ok: true, protocol: 'checkpoint-v1', accountKey: 'checkpoint-fixture', revision: 1,
      sourceBytes: source.length, chunkCount: 1, chunkBytes: 262_144, sha256: createHash('sha256').update(source).digest('hex') };
    const request = vi.fn().mockResolvedValueOnce(manifest).mockResolvedValueOnce({ ok: true, accountKey: 'checkpoint-fixture', revision: 1, index: 0,
      data: source.toString('base64'), ...changed });
    await expect(transport.downloadCheckpoint(request, 'checkpoint-fixture', 'synthetic-test-key')).rejects.toThrow('venue, revision, and index');
  });
});

describe('checkpoint HTTP ownership before acknowledgement', () => {
  it.each([401, 403, 503])('retains the original pending save when actual HTTP%s falsely claims a matching commit', async status => {
    const { store } = durableStore(), server = checkpointServer();
    const fetchImpl = vi.fn(async (url, options) => {
      if (new URL(url).pathname.endsWith('/finalize')) {
        const pending = store.readPendingState('checkpoint-fixture');
        if (!pending) throw Error('Expected an actual protected pending source');
        return reply({ ok: true, accountKey: pending.accountKey, mutationId: pending.mutationId,
          revision: pending.expectedRevision + 1, publication: { status: 'pending' } }, status);
      }
      return server.fetchImpl(url, options);
    });
    const result = await clientFor(store, { fetchImpl }).saveStateApiFirst(state('Synthetic HTTP ownership'));
    expect(server.effects).toBe(0);
    expect(result).toMatchObject({ ok: false, pending: true });
    expect(store.readPendingState('checkpoint-fixture')).not.toBeNull();
  });
  it('retains the original source when a failed begin response falsely supplies a completed receipt', async () => {
    const { store } = durableStore(), server = checkpointServer();
    const fetchImpl = vi.fn(async (url, options) => {
      if (new URL(url).pathname === '/state/checkpoints') {
        const pending = store.readPendingState('checkpoint-fixture');
        if (!pending) throw Error('Expected an actual protected pending source');
        return reply({ ok: true, id: 'a'.repeat(64), received: [], completed: true,
          result: { ok: true, accountKey: pending.accountKey, mutationId: pending.mutationId,
            revision: pending.expectedRevision + 1, publication: { status: 'pending' } } }, 503);
      }
      return server.fetchImpl(url, options);
    });
    const result = await clientFor(store, { fetchImpl }).saveStateApiFirst(state('Synthetic false completion'));
    expect(server.effects).toBe(0);
    expect(result).toMatchObject({ ok: false, pending: true });
    expect(store.readPendingState('checkpoint-fixture')).not.toBeNull();
  });
  it('accepts the actual successful response from the unchanged transactional fixture exactly once', async () => {
    const { store } = durableStore(), server = checkpointServer();
    const result = await clientFor(store, server).saveStateApiFirst(state('Synthetic actual success'));
    expect(result).toMatchObject({ ok: true, authoritative: true, revision: 1 });
    expect(server.effects).toBe(1);expect(store.readPendingState('checkpoint-fixture')).toBeNull();
  });
});


describe('checkpoint capability HTTP ownership', () => {
  it('does not cache a failed HTTP response whose body advertises valid support', async () => {
    const { store } = durableStore(), server = checkpointServer(); let healthy = false, capabilityCalls = 0;
    const fetchImpl = vi.fn(async (url, options) => {
      if (new URL(url).pathname === '/state/capabilities') {
        capabilityCalls += 1;
        if (!healthy) return reply({ ok: true, checkpoint: capabilities }, 503);
      }
      return server.fetchImpl(url, options);
    });
    const client = clientFor(store, { fetchImpl }), access = state().settings.pilotAccess;
    expect(await client.getPersistenceCapabilities(access)).toMatchObject({ ok: false, checkpoint: null, httpStatus: 503 });
    expect(store.readPendingState('checkpoint-fixture')).toBeNull();
    healthy = true;
    expect(await client.getPersistenceCapabilities(access)).toMatchObject({ ok: true, checkpoint: capabilities });
    expect(capabilityCalls).toBe(2);expect(server.effects).toBe(0);
  });
});

function legacyHttpServer({ saveStatus = 200, readStatus = 200 } = {}) {
  let effects = 0, reads = 0;
  const fetchImpl = vi.fn(async (url, options) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/state/capabilities') return reply({ ok: false }, 404);
    if (pathname === '/state' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (saveStatus === 200) effects += 1;
      return reply({ ok: true, accountKey: 'legacy-http-fixture', mutationId: body.mutationId,
        revision: body.expectedRevision + 1, publication: { status: 'pending' } }, saveStatus);
    }
    if (pathname === '/state/legacy-http-fixture') {
      reads += 1;
      return reply({ ...(readStatus === 200 ? {} : { ok: true }), accountKey: 'legacy-http-fixture', revision: 8,
        state: state('Synthetic legacy response', 'legacy-http-fixture') }, readStatus);
    }
    throw Error('Unexpected synthetic legacy fixture route');
  });
  return { fetchImpl, get effects() { return effects; }, get reads() { return reads; } };
}

describe('durable legacy state HTTP ownership', () => {
  it.each([401, 403, 503])('retains pending state on failed legacy HTTP%s even when its body claims success', async status => {
    const { store } = durableStore(), server = legacyHttpServer({ saveStatus: status });
    const client = clientFor(store, server);
    const original = state('Original protected legacy intent', 'legacy-http-fixture');
    const result = await client.saveStateApiFirst(original);
    expect(server.effects).toBe(0);
    expect(result).toMatchObject({ ok: false, pending: true });
    expect(store.readPendingState('legacy-http-fixture')).toMatchObject({ state: original, transport: 'legacy' });
  });
  it.each([403, 503])('rejects state carried by failed legacy read HTTP%s before authoritative adoption', async status => {
    const { store } = durableStore(), server = legacyHttpServer({ readStatus: status });
    const client = clientFor(store, server);
    const record = await client.peekStateFromApi('legacy-http-fixture', state('', 'legacy-http-fixture').settings.pilotAccess);
    expect(server.reads).toBe(1); expect(server.effects).toBe(0);
    expect(record).toBeNull(); expect(store.readPendingState('legacy-http-fixture')).toBeNull();
  });
  it('accepts an actual legacy successful save and acknowledges its original pending state', async () => {
    const { store } = durableStore(), server = legacyHttpServer();
    const client = clientFor(store, server);
    expect(await client.saveStateApiFirst(state('Actual synthetic legacy success', 'legacy-http-fixture'))).toMatchObject({ ok: true, authoritative: true, revision: 1 });
    expect(server.effects).toBe(1); expect(store.readPendingState('legacy-http-fixture')).toBeNull();
  });
  it('preserves successful legacy records that omit an ok field', async () => {
    const { store } = durableStore(), server = legacyHttpServer();
    const client = clientFor(store, server);
    expect(await client.peekStateFromApi('legacy-http-fixture', state('', 'legacy-http-fixture').settings.pilotAccess))
      .toMatchObject({ authoritative: true, revision: 8, state: state('Synthetic legacy response', 'legacy-http-fixture') });
    expect(server.reads).toBe(1); expect(server.effects).toBe(0);
  });
  it('preserves the released non-durable request failure payload shape', async () => {
    const client = api.createOrbitApiClient(base({ fetchImpl: vi.fn(async () => reply({ ok: true, marker: 'synthetic-retained-shape' }, 403)) }));
    expect(await client.requestOrbitApi('/state/legacy-http-fixture', { returnFailurePayload: true }))
      .toEqual({ ok: true, marker: 'synthetic-retained-shape', httpStatus: 403 });
  });
});
