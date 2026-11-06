import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import api from './orbitApiClient.cjs';
import local from './localStore.cjs';
import update from './updateController.cjs';

const account = 'retry-fixture';
const access = () => ({ licenseId: account, authorizationCode: 'synthetic-key', authorized: true, expiresAt: '2099-12-31' });
const state = () => ({ games: [], sessions: [], playerSessions: [], profiles: [], playerLedger: [{ id: 'financial-marker', amount: 12.75 }], settings: { pilotAccess: access() } });
const reply = (payload, status = 200, retryAfter) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: (name) => name === 'retry-after' ? retryAfter : null }, text: async () => JSON.stringify(payload) });
const caps = { protocol: 'checkpoint-v1', chunkBytes: 262144, maximumSourceBytes: 33554432, maximumChunks: 128, maximumEnvelopeBytes: 400000, expiresAfterMs: 86400000 };
function files() {
  const data = new Map();
  return { data, existsSync: name => data.has(name), readFileSync: name => data.get(name), mkdirSync: () => {},
    writeFileSync: vi.fn((name, value) => data.set(name, value)), renameSync: vi.fn((from, to) => { data.set(to, data.get(from)); data.delete(from); }) };
}
function fixture(status = 401, retryAfter, fileSystem = files()) {
  let clock = 1000; let first = true; let effects = 0; let manifest; let committed; let proof; let capabilityAvailable = true;
  let heldProof; let heldFailure; const requests = []; const chunks = new Map(); const timers = [];
  const store = local.createLocalStore({ app: { getPath: () => 'synthetic-retry-store' }, fileSystem,
    encodeState: value => 'encrypted-test:' + Buffer.from(value).toString('base64'),
    decodeState: value => Buffer.from(value.slice('encrypted-test:'.length), 'base64').toString('utf8'), now: () => new Date(clock) });
  const fetchImpl = vi.fn(async (url, options) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, body, method: options.method || 'GET', auth: options.headers?.['x-orbit-api-key'], redirect: options.redirect });
    if (path === '/state/capabilities') return reply({ ok: true, checkpoint: capabilityAvailable ? caps : null });
    if (path === '/license/status') return reply({ ok: true, managed: true, active: true, license: null });
    if (path === '/state/checkpoint/' + account) {
      if (heldProof) { const held = heldProof; heldProof = null; return held; }
      if (proof) return proof;
      if (!committed) return reply({ ok: false, code: 'CHECKPOINT_STATE_NOT_FOUND' }, 404);
      return reply({ ok: true, ...manifest, revision: committed.revision, chunkBytes: caps.chunkBytes });
    }
    if (path === '/state/checkpoints') {
      if (committed && body.mutationId === committed.mutationId) return reply({ ok: true, id: 'a'.repeat(64), completed: true, result: committed, received: [] });
      if (manifest && manifest.mutationId !== body.mutationId) chunks.clear();
      manifest = body; return reply({ ok: true, id: 'a'.repeat(64), received: [...chunks.keys()] });
    }
    if (path.includes('/state/checkpoints/') && path.includes('/chunks/')) {
      chunks.set(Number(path.split('/').at(-1)), Buffer.from(body.data, 'base64')); return reply({ ok: true });
    }
    if (path.endsWith('/finalize')) {
      if (first) { first = false; if (heldFailure) return heldFailure; return reply({ ok: false, code: status === 409 ? 'STATE_REVISION_CONFLICT' : 'SYNTHETIC_REJECTION', currentRevision: 1 }, status, retryAfter); }
      const source = Buffer.concat([...chunks.entries()].sort(([a], [b]) => a - b).map(([, bytes]) => bytes));
      expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.sha256);
      if (!committed || committed.mutationId !== manifest.mutationId) { effects++; committed = { accountKey: account, mutationId: manifest.mutationId, revision: manifest.expectedRevision + 1, publication: { status: 'pending' } }; }
      return reply({ ok: true, ...committed });
    }
    if (path.startsWith('/state/checkpoint/') && path.includes('/chunks/')) {
      const index = Number(path.split('/').at(-1)); return reply({ ok: true, accountKey: account, revision: committed.revision, index, data: chunks.get(index).toString('base64') });
    }
    throw new Error('Unexpected synthetic route: ' + path);
  });
  const makeClient = () => api.createOrbitApiClient({ ...store, app: { getVersion: () => 'test' },
    environment: { ORBIT_API_URL: 'http://127.0.0.1:9' }, fetchImpl, nowMs: () => clock, now: () => new Date(clock),
    writeOrbitApiLog: vi.fn(), loadStateWithFirebaseFallback: async () => null, saveStateEverywhere: vi.fn(),
    setTimeoutImpl: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }, clearTimeoutImpl: vi.fn() });
  return { store, fileSystem, fetchImpl, requests, timers, makeClient, get effects() { return effects; },
    setClock: value => { clock = value; }, setProof: value => { proof = value; },
    setCapabilities: value => { capabilityAvailable = value; },
    holdProof: () => { let release; heldProof = new Promise(resolve => { release = resolve; }); return value => release(value); },
    holdFailure: () => { let release; heldFailure = new Promise(resolve => { release = resolve; }); return value => release(value); } };
}
const identity = pending => ({ mutationId: pending.mutationId, expectedRevision: pending.expectedRevision, sha256: pending.sha256, transport: pending.transport, state: pending.state });
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function updater(client) {
  return update.createUpdateController({ preserveStateForUpdate: next => { client.preservePendingState(next); return { ok: true }; },
    saveStateToApi: client.saveStateToApi, writeOrbitApiLog: vi.fn() });
}

describe('pending replay policy compatibility controls', () => {
  it('retains old pending records without policy and original literal accounting details', () => {
    const f = fixture(); const next = state();
    const pending = f.store.writePendingState({ accountKey: account, state: next, expectedRevision: 0, mutationId: 'old-operation', sha256: createHash('sha256').update(JSON.stringify(next)).digest('hex') });
    f.store.closeDatabase();
    expect(identity(f.store.readPendingState(account))).toEqual(identity(pending));
    expect(f.store.readPendingState(account).retryPolicy).toBeUndefined();
    expect(f.store.readPendingState(account).state.playerLedger).toEqual([{ id: 'financial-marker', amount: 12.75 }]);
  });
});

describe('pending replay admission regression', () => {
  it.each([401, 403, 409, 422])('passive reads and repeated saves cannot bypass HTTP%s pause', async status => {
    const f = fixture(status); const client = f.makeClient(); const next = state();
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    const original = identity(f.store.readPendingState(account)); const calls = f.requests.length;
    expect(calls).toBeGreaterThan(3);
    await client.loadStateApiFirst(account, access()); await client.loadStateApiFirst(account, access());
    await client.saveStateToApi(next);
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0);
    expect(identity(f.store.readPendingState(account))).toEqual(original);
    expect(f.store.readPendingState(account).retryPolicy).toMatchObject({ kind: status === 401 || status === 403 ? 'auth' : 'permanent', httpStatus: status });
  });
  it.each([401, 403, 409])('restart preserves HTTP%s pause before a passive read', async status => {
    const f = fixture(status); const client = f.makeClient();
    await client.saveStateApiFirst(state()); const original = identity(f.store.readPendingState(account)); const calls = f.requests.length;
    f.store.closeDatabase(); const reopened = f.makeClient();
    expect(await reopened.loadStateApiFirst(account, access())).toMatchObject({ pending: true, authoritative: false });
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0); expect(identity(f.store.readPendingState(account))).toEqual(original);
  });
  it.each([429, 503])('reads, timer and actual update flush honor Retry-After for HTTP%s', async status => {
    const f = fixture(status, '7'); const client = f.makeClient(); const next = state();
    await client.saveStateApiFirst(next); const original = identity(f.store.readPendingState(account)); const calls = f.requests.length;
    const retry = f.timers.find(timer => timer.delay === 7000); expect(retry).toBeDefined();
    await client.loadStateApiFirst(account, access());
    expect(await updater(client).handleRendererStateFlush('synthetic-flush', next)).toEqual({ ok: true }); await settle();
    f.setClock(5000); retry.callback(); await settle();
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0); expect(identity(f.store.readPendingState(account))).toEqual(original);
    expect(f.store.readPendingState(account).retryPolicy).toMatchObject({ kind: 'transient', notBeforeMs: 8000 });
    f.setClock(8000); const due = [...f.timers].reverse().find(timer => timer.delay === 3000); expect(due).toBeDefined(); due.callback();
    await vi.waitFor(() => expect(f.effects).toBe(1)); expect(f.store.readPendingState(account)).toBeNull();
    expect(f.requests.filter(request => request.path === '/state/checkpoints').every(request => request.body.mutationId === original.mutationId && request.body.expectedRevision === original.expectedRevision && request.body.sha256 === original.sha256)).toBe(true);
  });
  it('restart cannot bypass persisted transient deadline', async () => {
    const f = fixture(503, '7'); await f.makeClient().saveStateApiFirst(state()); const calls = f.requests.length; const original = identity(f.store.readPendingState(account));
    f.store.closeDatabase(); f.setClock(7999);
    await f.makeClient().loadStateApiFirst(account, access());
    expect(f.requests).toHaveLength(calls); expect(identity(f.store.readPendingState(account))).toEqual(original);
  });
  it('explicit same-account proof only unlocks original auth pause, without commit or writer-revision adoption', async () => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const original = identity(f.store.readPendingState(account)); const writes = f.requests.filter(request => request.method === 'POST').length;
    expect(typeof client.resumePendingManagementState).toBe('function');
    expect(await client.resumePendingManagementState(access())).toMatchObject({ ok: true, pending: true });
    expect(f.requests.filter(request => request.method === 'POST')).toHaveLength(writes); expect(f.effects).toBe(0);
    expect(identity(f.store.readPendingState(account))).toEqual(original); expect(f.store.readPendingState(account).retryPolicy).toBeUndefined();
    expect(f.requests.filter(request => request.path === '/state/checkpoint/' + account)).toEqual([expect.objectContaining({ redirect: 'error' })]);
    await client.loadStateApiFirst(account, access()); expect(f.effects).toBe(1);
    expect(f.requests.filter(request => request.path === '/state/checkpoints').at(-1).body).toMatchObject({ mutationId: original.mutationId, expectedRevision: original.expectedRevision, sha256: original.sha256 });
  });
  it('accepts an exact HTTP200 scoped manifest without adopting its remote revision', async () => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const original = identity(f.store.readPendingState(account)); const posts = f.requests.filter(request => request.method === 'POST').length;
    f.setProof(reply({ ok: true, protocol: 'checkpoint-v1', accountKey: account, revision: 17, sourceBytes: 10, chunkBytes: 262144, chunkCount: 1, sha256: 'a'.repeat(64) }));
    expect(await client.resumePendingManagementState(access())).toMatchObject({ ok: true, pending: true });
    expect(identity(f.store.readPendingState(account))).toEqual(original); expect(f.effects).toBe(0);
    expect(f.requests.filter(request => request.method === 'POST')).toHaveLength(posts);
    expect(f.requests.at(-1)).toMatchObject({ path: '/state/checkpoint/' + account, redirect: 'error' });
    f.setProof(undefined);
    await client.loadStateApiFirst(account, access());
    expect(f.requests.filter(request => request.path === '/state/checkpoints').at(-1).body.expectedRevision).toBe(0);
    expect(f.effects).toBe(1);
  });
  it('keeps pre-transport capability policy valid through atomic selection and restart', async () => {
    const f = fixture(503, '7'); f.setCapabilities(false); const client = f.makeClient();
    const next = state(); next.profiles.push({ id: 'retained-profile', notes: '♠'.repeat(700000) });
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: false, pending: true });
    const original = identity(f.store.readPendingState(account)); const policy = f.store.readPendingState(account).retryPolicy;
    expect(original.transport).toBeUndefined(); expect(policy).toMatchObject({ kind: 'transient', failureType: 'capability', httpStatus: 200 });
    expect(f.requests).toHaveLength(1); f.setClock(policy.notBeforeMs); f.setCapabilities(true);
    const release = f.holdFailure(); const replay = client.loadStateApiFirst(account, access());
    await vi.waitFor(() => expect(f.requests.filter(request => request.path.endsWith('/finalize'))).toHaveLength(1));
    expect(f.store.readPendingState(account).transport).toBe('checkpoint-v1');
    f.store.closeDatabase();
    expect(identity(f.store.readPendingState(account))).toEqual({ ...original, transport: 'checkpoint-v1' });
    expect(f.store.readPendingState(account).retryPolicy).toEqual(policy);
    expect(() => f.store.selectPendingTransport(account, original.mutationId, 'legacy')).toThrow('receipt namespace');
    release(reply({ ok: false, code: 'SYNTHETIC_REJECTION' }, 503, '7')); await replay;
    const retryPolicy = f.store.readPendingState(account).retryPolicy; expect(retryPolicy).toMatchObject({ kind: 'transient', httpStatus: 503 });
    f.store.closeDatabase(); f.setClock(retryPolicy.notBeforeMs);
    expect(await f.makeClient().loadStateApiFirst(account, access())).toMatchObject({ authoritative: true, revision: 1, state: next });
    expect(f.effects).toBe(1); expect(f.store.readPendingState(account)).toBeNull();
    const starts = f.requests.filter(request => request.path === '/state/checkpoints');
    expect(starts).toHaveLength(2); expect(starts.every(request => request.body.mutationId === original.mutationId && request.body.sha256 === original.sha256 && request.body.expectedRevision === original.expectedRevision)).toBe(true);
  });
  it('keeps an explicitly proven credential ahead of a stale passive poll for the same operation', async () => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const original = identity(f.store.readPendingState(account));
    const validated = { ...access(), authorizationCode: 'new-proven-key' };
    expect(await client.resumePendingManagementState(validated)).toMatchObject({ ok: true, pending: true });
    expect(f.effects).toBe(0);
    await client.loadStateApiFirst(account, access());
    const starts = f.requests.filter(request => request.path === '/state/checkpoints');
    expect(starts.at(-1)).toMatchObject({ auth: 'new-proven-key', body: { mutationId: original.mutationId, expectedRevision: original.expectedRevision, sha256: original.sha256 } });
    expect(f.effects).toBe(1); expect(f.store.readPendingState(account)).toBeNull();
    const next = state(); next.playerLedger.push({ id: 'new-intent', amount: 0.25 });
    await client.saveStateToApi(next, access());
    expect(f.requests.filter(request => request.path === '/state/checkpoints').at(-1).auth).toBe(access().authorizationCode);
  });
  it('retires the proven operation credential before the next production-style save without an access argument', async () => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const original = identity(f.store.readPendingState(account));
    expect(await client.resumePendingManagementState({ ...access(), authorizationCode: 'proven-operation-key-B' })).toMatchObject({ ok: true, pending: true });
    await client.loadStateApiFirst(account, access());
    expect(f.effects).toBe(1); expect(f.store.readPendingState(account)).toBeNull();
    expect(f.requests.filter(request => request.path === '/state/checkpoints').at(-1).auth).toBe('proven-operation-key-B');
    const next = state(); next.settings.pilotAccess.authorizationCode = 'new-operation-key-C';
    next.playerLedger.push({ id: 'new-financial-marker', amount: 0.25 });
    expect(await client.saveStateApiFirst(next)).toMatchObject({ ok: true, revision: 2 });
    const start = f.requests.filter(request => request.path === '/state/checkpoints').at(-1);
    expect(start.body.mutationId).not.toBe(original.mutationId); expect(start.body.expectedRevision).toBe(1);
    expect(start.auth).toBe('new-operation-key-C'); expect(f.effects).toBe(2);
    expect(f.store.readPendingState(account)).toBeNull();
  });
  it.each(['wrong-account', 'truthy-ok', 'expired-access', 'unauthorized', 'created-status', 'array-sha', 'malformed-expiry', 'body-owned-404'])('rejects explicit proof %s without clearing auth pause', async scenario => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state()); const original = identity(f.store.readPendingState(account));
    const proof = { ok: true, protocol: 'checkpoint-v1', accountKey: scenario === 'wrong-account' ? 'other' : account, revision: 1, sourceBytes: 10, chunkBytes: 262144, chunkCount: 1, sha256: 'a'.repeat(64) };
    const selectedProof = scenario === 'truthy-ok' ? { ...proof, ok: 'true' } : scenario === 'array-sha' ? { ...proof, sha256: ['a'.repeat(64)] } : scenario === 'body-owned-404' ? { ok: false, code: 'CHECKPOINT_STATE_NOT_FOUND', httpStatus: 404 } : proof;
    f.setProof(reply(selectedProof, scenario === 'unauthorized' ? 403 : scenario === 'created-status' ? 201 : 200));
    if (scenario === 'expired-access') expect(Date.parse('1969-12-30T00:00:00.000Z')).toBeLessThan(1000);
    expect(typeof client.resumePendingManagementState).toBe('function');
    expect(await client.resumePendingManagementState(scenario === 'expired-access' ? { ...access(), expiresAt: '1969-12-30T00:00:00.000Z' } : scenario === 'malformed-expiry' ? { ...access(), expiresAt: 'not-a-date' } : access())).toMatchObject({ ok: false, pending: true });
    expect(identity(f.store.readPendingState(account))).toEqual(original); expect(f.store.readPendingState(account).retryPolicy.kind).toBe('auth'); expect(f.effects).toBe(0);
  });
  it('rechecks exact pause and ACK-invalid reason after awaited proof', async () => {
    const f = fixture(401); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const release = f.holdProof(); expect(typeof client.resumePendingManagementState).toBe('function');
    const resumed = client.resumePendingManagementState(access());
    await vi.waitFor(() => expect(f.requests.some(request => request.path === '/state/checkpoint/' + account)).toBe(true));
    const original = identity(f.store.readPendingState(account)); f.store.pausePendingState(account, original.mutationId);
    release(reply({ ok: false, code: 'CHECKPOINT_STATE_NOT_FOUND' }, 404));
    expect(await resumed).toMatchObject({ ok: false, pending: true });
    expect(f.store.readPendingState(account)).toMatchObject({ pauseCode: 'CHECKPOINT_ACK_INVALID' }); expect(f.effects).toBe(0);
  });
  it('a successful auth signal never overrides a permanent pause or transient deadline', async () => {
    for (const status of [409, 503]) {
      const f = fixture(status, '7'); const client = f.makeClient(); await client.saveStateApiFirst(state()); const calls = f.requests.length;
      expect(typeof client.resumePendingManagementState).toBe('function');
      expect(await client.resumePendingManagementState(access())).toMatchObject({ ok: false, pending: true });
      expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0);
    }
  });
  it('retains actual HTTP200 application failure as bounded transient policy instead of throwing', async () => {
    const f = fixture(200); const client = f.makeClient();
    expect(await client.saveStateApiFirst(state())).toMatchObject({ ok: false, pending: true });
    expect(f.store.readPendingState(account).retryPolicy).toMatchObject({ kind: 'transient', httpStatus: 200, failureType: 'application' });
    const calls = f.requests.length; await client.loadStateApiFirst(account, access());
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0);
  });
  it('retains owned HTTP200 for unreadable application responses without retry admission bypass', async () => {
    const f = fixture(); const originalFetch = f.fetchImpl.getMockImplementation();
    f.fetchImpl.mockImplementation(async (url, options) => {
      if (new URL(url).pathname.endsWith('/finalize')) return { ...reply(null), text: async () => '{invalid-json' };
      return originalFetch(url, options);
    });
    const client = f.makeClient();
    expect(await client.saveStateApiFirst(state())).toMatchObject({ ok: false, pending: true });
    expect(f.store.readPendingState(account).retryPolicy).toMatchObject({ kind: 'transient', httpStatus: 200, failureType: 'application' });
    const calls = f.fetchImpl.mock.calls.length;
    await client.loadStateApiFirst(account, access());
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls); expect(f.effects).toBe(0);
  });
  it.each(['operation', 'deadline', 'kind'])('corrupt persisted retry %s fails closed after restart', async corruption => {
    const f = fixture(401); await f.makeClient().saveStateApiFirst(state());
    const disk = JSON.parse(f.fileSystem.data.get(f.store.getDataPath()));
    const policy = disk.accounts[account].pendingSave.retryPolicy;
    if (corruption === 'operation') policy.mutationId = 'another-operation';
    if (corruption === 'deadline') policy.notBeforeMs = -1;
    if (corruption === 'kind') policy.kind = 'unknown-future-kind';
    f.fileSystem.data.set(f.store.getDataPath(), JSON.stringify(disk)); f.store.closeDatabase();
    const calls = f.requests.length;
    await expect(f.makeClient().loadStateApiFirst(account, access())).rejects.toThrow('retry policy');
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0);
  });
  it('concurrent due reads cannot recreate an acknowledged pending operation with a new ID', async () => {
    const f = fixture(503, '7'); const client = f.makeClient(); await client.saveStateApiFirst(state());
    const original = identity(f.store.readPendingState(account)); f.setClock(8000);
    await Promise.all([client.loadStateApiFirst(account, access()), client.loadStateApiFirst(account, access())]);
    expect(f.effects).toBe(1); expect(f.store.readPendingState(account)).toBeNull();
    const starts = f.requests.filter(request => request.path === '/state/checkpoints');
    expect(starts).toHaveLength(2); expect(starts.every(request => request.body.mutationId === original.mutationId)).toBe(true);
  });
  it.each([401, 429])('already-queued read and flush recheck HTTP%s policy at actual dispatch', async status => {
    const f = fixture(status, '7'); const client = f.makeClient(); const next = state(); const release = f.holdFailure();
    const first = client.saveStateApiFirst(next);
    await vi.waitFor(() => expect(f.requests.filter(request => request.path.endsWith('/finalize'))).toHaveLength(1));
    const calls = f.requests.length; const original = identity(f.store.readPendingState(account));
    const queuedRead = client.loadStateApiFirst(account, access());
    expect(await updater(client).handleRendererStateFlush('queued-flush', next)).toEqual({ ok: true });
    release(reply({ ok: false, code: 'SYNTHETIC_REJECTION' }, status, '7'));
    expect(await first).toMatchObject({ ok: false, pending: true }); await queuedRead;
    await client.loadStateApiFirst(account, access());
    expect(f.requests).toHaveLength(calls); expect(f.effects).toBe(0); expect(identity(f.store.readPendingState(account))).toEqual(original);
  });

});
