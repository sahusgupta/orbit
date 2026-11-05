import { describe, expect, it, vi } from 'vitest';
import { normalizeState, parsePersistedAppState, seedState } from '../../domain/state';
import type { AppState, PersistedStateRecord, PlayerProfile } from '../../domain/types';
import type { BrowserStorage } from './browserStateRepository';
import { BrowserManagementRecoveryError, createManagementPersistence, type ManagementStateSubscriptionEvent } from './managementPersistence';
import { createBrowserCheckpointJournal, type BrowserCheckpointBackend } from './browserCheckpointJournal';
import { checkpointSha256 } from './checkpointTransport';
import { loadBrowserManagementStateForAccount } from './browserStateRepository';

const buildState = (): AppState => ({
  ...structuredClone(seedState),
  settings: {
    ...structuredClone(seedState.settings),
    pilotAccess: {
      authorized: true,
      authorizationCode: 'REF-019-PERSISTENCE-CODE',
      expiresAt: '2099-12-31T23:59:59.000Z',
      activatedAt: '2026-08-08T12:00:00.000Z',
      licenseId: 'ref-019-persistence'
    }
  }
});

const profile = (id: string, name: string): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '',
  membershipExpirationDate: '',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: 'desktop',
  preferredGameIds: ['desktop'],
  gamePlayCounts: {},
  mostPlayedGameId: 'desktop',
  preferredStakes: '',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: true,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: ''
});

const createStorage = () => {
  const values = new Map<string, string>();
  const storage: BrowserStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
  return { storage, values };
};

const checkpointCapabilities = { protocol: 'checkpoint-v1', chunkBytes: 262144, maximumSourceBytes: 33554432, maximumChunks: 128, maximumEnvelopeBytes: 400000 };

function createJournalFixture() {
  type EncryptedRecord = NonNullable<Awaited<ReturnType<BrowserCheckpointBackend['get']>>>;
  const records = new Map<string, EncryptedRecord>();
  let key: CryptoKey | undefined;
  const backend: BrowserCheckpointBackend = {
    getKey: async () => key, ensureKey: async (candidate) => key ??= candidate,
    get: async (reference) => records.get(reference),
    putIfAbsent: async (reference, value) => { const prior = records.get(reference); if (!prior) records.set(reference, value); return prior; },
    deleteIfToken: async (reference, token) => records.get(reference)?.token === token && records.delete(reference)
  };
  return { backend, records, journal: createBrowserCheckpointJournal({ backend }) };
}

function createCheckpointApi(initialState: AppState | null = buildState()) {
  const accountKey = initialState?.settings.pilotAccess?.licenseId || 'ref-019-persistence';
  let canonical = initialState;
  let revision = initialState ? 1 : 0;
  let effects = 0;
  let loseAcknowledgement = false;
  let rejectBegin: { status: number; retryAfter?: string } | undefined;
  let transform: ((state: AppState) => AppState) | undefined;
  let mutationId = '';
  let expectedRevision = 0;
  const completed = new Map<string, number>();
  const chunks = new Map<number, Buffer>();
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  const identities: string[] = [];
  const fetchState: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method || 'GET';
    calls.push({ path, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (path.endsWith('/capabilities')) return Response.json({ ok: true, checkpoint: checkpointCapabilities });
    if (method === 'GET' && path.includes('/state/checkpoint/')) {
      if (!canonical) return Response.json({ ok: false }, { status: 404 });
      const bytes = Buffer.from(JSON.stringify(canonical));
      const index = path.match(/\/chunks\/(\d+)$/)?.[1];
      if (index !== undefined) return Response.json({ ok: true, accountKey, revision,
        index: Number(index), data: bytes.subarray(Number(index) * 262144, (Number(index) + 1) * 262144).toString('base64') });
      return Response.json({ ok: true, protocol: 'checkpoint-v1', accountKey, revision,
        sourceBytes: bytes.length, chunkCount: Math.ceil(bytes.length / 262144), chunkBytes: 262144, sha256: await checkpointSha256(bytes),
        notModified: url.searchParams.get('knownRevision') === String(revision) });
    }
    const body: unknown = JSON.parse(String(init?.body));
    if (typeof body !== 'object' || body === null) throw new Error('Expected a test request object.');
    if (path.endsWith('/checkpoints')) {
      identities.push(String(Reflect.get(body, 'mutationId')));
      if (rejectBegin) return Response.json({ ok: false, error: 'Synthetic server rejection' }, { status: rejectBegin.status,
        headers: rejectBegin.retryAfter ? { 'retry-after': rejectBegin.retryAfter } : undefined });
      mutationId = String(Reflect.get(body, 'mutationId'));
      const committedRevision = completed.get(mutationId);
      if (committedRevision) return Response.json({ ok: true, id: 'a'.repeat(64), completed: true,
        result: { ok: true, accountKey, mutationId, revision: committedRevision, duplicate: true, publication: { status: 'pending' } } });
      expectedRevision = Number(Reflect.get(body, 'expectedRevision'));
      if (expectedRevision !== revision) return Response.json({ ok: false, error: 'Synthetic revision conflict' }, { status: 409 });
      return Response.json({ ok: true, id: 'a'.repeat(64), received: [...chunks.keys()] });
    }
    const chunkIndex = path.match(/\/chunks\/(\d+)$/)?.[1];
    if (chunkIndex !== undefined) {
      chunks.set(Number(chunkIndex), Buffer.from(String(Reflect.get(body, 'data')), 'base64'));
      return Response.json({ ok: true });
    }
    if (path.endsWith('/finalize')) {
      expect(expectedRevision).toBe(revision);
      const parsed = parsePersistedAppState(Buffer.concat([...chunks.entries()].sort(([left], [right]) => left - right).map(([, bytes]) => bytes)).toString('utf8'));
      if (!parsed) throw new Error('Expected a test state.');
      canonical = transform ? transform(normalizeState(parsed)) : normalizeState(parsed);
      revision += 1;
      effects += 1;
      completed.set(mutationId, revision);
      chunks.clear();
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Synthetic lost commit acknowledgement'); }
      return Response.json({ ok: true, accountKey, mutationId, revision, publication: { status: 'pending' } });
    }
    throw new Error(`Unexpected isolated route ${path}`);
  };
  return { fetchState, calls, identities, get effects() { return effects; }, get canonical() { return canonical; },
    advanceCanonical: (value: AppState) => { canonical = value; revision += 1; },
    loseNextAcknowledgement: () => { loseAcknowledgement = true; },
    transformCommit: (value: (state: AppState) => AppState) => { transform = value; },
    rejectBegin: (value?: { status: number; retryAfter?: string }) => { rejectBegin = value; } };
}

const browserAdapter = (api: ReturnType<typeof createCheckpointApi>, fixture: ReturnType<typeof createJournalFixture>, options: { now?: () => number } = {}) =>
  createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState: api.fetchState, checkpointJournal: fixture.journal,
    firebaseEnabled: false, getDesktopPersistence: () => undefined, saveFirebaseState: async () => undefined,
    storage: createStorage().storage, now: options.now, random: () => 0.5 });

describe('management persistence adapter', () => {
  it('forwards the optional desktop revision subscription and returns its synchronous cleanup', () => {
    const access = buildState().settings.pilotAccess!;
    const onEvent = vi.fn<(event: ManagementStateSubscriptionEvent) => void>();
    const cleanup = vi.fn();
    const subscribe = vi.fn((_access: typeof access, callback: (event: ManagementStateSubscriptionEvent) => void) => {
      callback({ type: 'change', revision: 7 });
      return cleanup;
    });
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState: vi.fn<typeof fetch>(), firebaseEnabled: false,
      getDesktopPersistence: () => ({ saveState: vi.fn(async () => ({ ok: true, path: 'desktop' })), subscribeToManagementState: subscribe }),
      saveFirebaseState: vi.fn(async () => undefined), storage: createStorage().storage
    });
    expect(persistence.subscribeToDesktopStateForAccount(access, onEvent)).toBe(cleanup);
    expect(subscribe).toHaveBeenCalledWith(access, onEvent);
    expect(onEvent).toHaveBeenCalledWith({ type: 'change', revision: 7 });
  });

  it('reports an unsupported desktop subscription without inventing one or starting a request', () => {
    const fetchState = vi.fn<typeof fetch>();
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState, firebaseEnabled: false,
      getDesktopPersistence: () => ({ saveState: vi.fn(async () => ({ ok: true, path: 'desktop' })) }),
      saveFirebaseState: vi.fn(async () => undefined), storage: createStorage().storage
    });
    expect(persistence.subscribeToDesktopStateForAccount(buildState().settings.pilotAccess!, vi.fn())).toBeUndefined();
    expect(fetchState).not.toHaveBeenCalled();
  });

  it('preserves online confirmation for legacy credential-derived accounts without creating a durable journal', async () => {
    const fixture = createJournalFixture();
    const state = buildState();
    if (state.settings.pilotAccess) delete state.settings.pilotAccess.licenseId;
    const fetchState: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/capabilities')) return Response.json({ ok: true, checkpoint: checkpointCapabilities });
      const body = JSON.parse(String(init?.body));
      return Response.json({ ok: true, id: 'a'.repeat(64), completed: true,
        result: { accountKey: body.accountKey, mutationId: body.mutationId, revision: 1, duplicate: true } });
    };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage });
    expect(await persistence.saveState(state)).toMatchObject({ ok: true, accountKey: 'ref-019-persistence-code', revision: 1 });
    expect(fixture.records.size).toBe(0);
  });

  it('keeps a cold optional browser read separate from an admitted save awaiting its actual acknowledgement', async () => {
    const fixture = createJournalFixture();
    let releaseBegin: () => void = () => { throw new Error('Expected save gate.'); };
    const beginGate = new Promise<void>((resolve) => { releaseBegin = resolve; });
    let markBegin: () => void = () => { throw new Error('Expected request marker.'); };
    const beginStarted = new Promise<void>((resolve) => { markBegin = resolve; });
    const fetchState: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/state/ref-019-persistence')) return Response.json({ ok: false }, { status: 404 });
      if (String(input).endsWith('/capabilities')) return Response.json({ ok: true, checkpoint: checkpointCapabilities });
      const body = JSON.parse(String(init?.body));
      markBegin();
      await beginGate;
      return Response.json({ ok: true, id: 'a'.repeat(64), completed: true,
        result: { accountKey: body.accountKey, mutationId: body.mutationId, revision: 1, duplicate: true } });
    };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage });
    const read = persistence.loadStateFromLocalBridge('ref-019-persistence');
    expect(persistence.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
    expect(await read).toEqual({ status: 'missing' });
    const saving = persistence.saveState(buildState());
    await beginStarted;
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    releaseBegin();
    expect(await saving).toMatchObject({ ok: true, revision: 1 });
    expect(persistence.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
  });
  it.each([
    { accountKey: 'another-venue' }, { mutationId: 'another-operation' }, { revision: 99 }
  ])('retains the journal and pauses reconciliation for a mismatched successful acknowledgement %j', async (override) => {
    const api = createCheckpointApi();
    const fixture = createJournalFixture();
    let now = 0;
    const fetchState: typeof fetch = async (input, init) => {
      const response = await api.fetchState(input, init);
      if (new URL(String(input)).pathname.endsWith('/finalize') && response.ok) {
        return Response.json({ ...await response.json(), ...override });
      }
      return response;
    };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage, now: () => now });
    const initial = buildState();
    await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const next = normalizeState(initial);
    next.scriptTemplates.push('Never confirm a mismatched response');
    expect(await persistence.saveState(next)).toMatchObject({ ok: false, pending: true, conflict: true, cloud: 'not-committed' });
    expect((await fixture.journal.load(next))?.state).toEqual(next);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    const requests = api.calls.length;
    now += 24 * 60 * 60 * 1000;
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toEqual({ status: 'unavailable' });
    expect(api.calls).toHaveLength(requests);
    expect(api.effects).toBe(1);
  });

  it('bounds canonical memory to two accounts and preserves pending intent when another account evicts its cache', async () => {
    const states = ['budget-one', 'budget-two', 'budget-three'].map((accountKey) => {
      const state = buildState();
      if (state.settings.pilotAccess) state.settings.pilotAccess.licenseId = accountKey;
      return state;
    });
    const apis = states.map((state) => createCheckpointApi(state));
    const fetchState: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      let accountKey = decodeURIComponent(path.split('/')[3] || '');
      if (init?.body) accountKey = String(Reflect.get(JSON.parse(String(init.body)), 'accountKey'));
      const selected = states.findIndex((state) => state.settings.pilotAccess?.licenseId === accountKey);
      return apis[selected < 0 ? 0 : selected].fetchState(input, init);
    };
    const fixture = createJournalFixture();
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage, now: () => 0 });
    for (const state of states) await persistence.loadExistingStateForAccount(state.settings.pilotAccess!);
    const previousChunks = apis[0].calls.filter((call) => call.path.includes('/chunks/')).length;
    await persistence.loadExistingStateForAccount(states[0].settings.pilotAccess!);
    expect(apis[0].calls.filter((call) => call.path.includes('/chunks/')).length).toBe(previousChunks + 1);
    const pending = normalizeState(states[0]);
    pending.scriptTemplates.push('Never evict this pending intent');
    apis[0].rejectBegin({ status: 503, retryAfter: '30' });
    expect(await persistence.saveState(pending)).toMatchObject({ ok: false, pending: true });
    for (const state of states.slice(1)) await persistence.loadExistingStateForAccount(state.settings.pilotAccess!);
    expect((await fixture.journal.load(pending))?.state).toEqual(pending);
    expect(persistence.getDurablePendingAdmission('budget-one').pending).toBe(true);
  });

  it('caps volatile credential saves at two accounts without evicting either unresolved operation', async () => {
    let now = 0;
    let confirmedAccount = '';
    const identities: Array<{ accountKey: string; mutationId: string }> = [];
    const fetchState: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/capabilities')) return Response.json({ ok: true, checkpoint: checkpointCapabilities });
      const body = JSON.parse(String(init?.body));
      identities.push({ accountKey: String(body.accountKey), mutationId: String(body.mutationId) });
      if (body.accountKey === confirmedAccount) return Response.json({ ok: true, id: 'a'.repeat(64), completed: true,
        result: { ok: true, accountKey: body.accountKey, mutationId: body.mutationId, revision: 1, duplicate: true, publication: { status: 'pending' } } });
      return Response.json({ ok: false, error: 'Synthetic offline credential save' }, { status: 503 });
    };
    const fixture = createJournalFixture();
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage, now: () => now, random: () => 0.5 });
    const states = ['credential-one', 'credential-two', 'credential-three'].map((accountKey) => {
      const state = buildState();
      if (state.settings.pilotAccess) state.settings.pilotAccess.licenseId = accountKey;
      state.settings.accountLogin = { username: `${accountKey}@example.test`, passwordSalt: 'synthetic-salt', passwordHash: 'synthetic-hash', createdAt: '2026-11-03T12:00:00.000Z' };
      return state;
    });
    for (const state of states.slice(0, 2)) expect(await persistence.saveState(state)).toMatchObject({ ok: false, pending: false });
    expect(await persistence.saveState(states[2])).toMatchObject({ ok: false, error: expect.stringContaining('retained work has not been evicted') });
    expect(identities).toHaveLength(2);
    expect(fixture.records.size).toBe(0);
    expect(persistence.getDurablePendingAdmission('credential-one').pending).toBe(true);
    expect(persistence.getDurablePendingAdmission('credential-two').pending).toBe(true);
    now += 1000;
    confirmedAccount = 'credential-one';
    expect(await persistence.saveState(states[0])).toMatchObject({ ok: true });
    expect(identities[2].mutationId).toBe(identities[0].mutationId);
    expect(persistence.getDurablePendingAdmission('credential-one').pending).toBe(false);
    expect(await persistence.saveState(states[2])).toMatchObject({ ok: false, pending: false });
    expect(persistence.getDurablePendingAdmission('credential-two').pending).toBe(true);
    expect(persistence.getDurablePendingAdmission('credential-three').pending).toBe(true);
  });

  it('preserves the legacy browser memory cache after an unavailable server without replacing protected pending work', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: async (input) => String(input).endsWith('/capabilities')
        ? Response.json({ ok: false }, { status: 404 }) : Response.json({ ok: false, error: 'Synthetic legacy outage' }, { status: 503 }),
      firebaseEnabled: false, getDesktopPersistence: () => undefined, saveFirebaseState: async () => undefined, storage });
    expect(await persistence.saveState(state)).toMatchObject({ ok: false });
    expect(loadBrowserManagementStateForAccount(state.settings.pilotAccess!, storage)?.state).toEqual(state);
  });

  it('reuses a validated canonical snapshot when an idle checkpoint manifest reports the same revision', async () => {
    const api = createCheckpointApi();
    const persistence = browserAdapter(api, createJournalFixture());
    const access = buildState().settings.pilotAccess!;
    await persistence.loadExistingStateForAccount(access);
    const requests = api.calls.length;
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toMatchObject({ status: 'available' });
    expect(api.calls.slice(requests).map((call) => call.path)).toEqual(['/state/checkpoint/ref-019-persistence']);
  });

  it('blocks mutations after loading desktop pending metadata until an authoritative record clears it', async () => {
    const state = buildState();
    let record: PersistedStateRecord = { schemaVersion: 4, savedAt: '2026-11-03T12:00:00.000Z', state,
      accountKey: 'ref-019-persistence', pending: true, authoritative: false };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false, getDesktopPersistence: () => ({ loadState: async () => record, loadStateForAccount: async () => record,
        saveState: async () => ({ ok: false, path: 'desktop' }) }),
      saveFirebaseState: async () => undefined, storage: createStorage().storage });
    await persistence.loadExistingStateForAccount(state.settings.pilotAccess!);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    record = { ...record, pending: false };
    await persistence.loadDesktopStateForAccount(state.settings.pilotAccess!);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    record = { ...record, authoritative: true };
    await persistence.loadDesktopState();
    expect(persistence.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
  });

  it('recreates the browser adapter, hydrates the original pending snapshot, and acknowledges the original committed receipt', async () => {
    const initial = buildState();
    initial.settings.accountLogin = { username: 'synthetic@example.test', passwordSalt: 'synthetic-salt', passwordHash: 'synthetic-hash', createdAt: '2026-11-03T12:00:00.000Z' };
    const api = createCheckpointApi(initial);
    const fixture = createJournalFixture();
    let now = 0;
    const first = browserAdapter(api, fixture, { now: () => now });
    await first.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const next = normalizeState(initial);
    next.scriptTemplates.push('Retained ordinary action');
    next.settings.activeStaffId = 'transient-selection';
    api.loseNextAcknowledgement();
    expect(await first.saveState(next)).toMatchObject({ ok: false, pending: true });
    const original = await fixture.journal.load(next);
    expect(first.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    now += 1000;
    const recreated = browserAdapter(api, fixture, { now: () => now });
    expect(await recreated.loadExistingStateForAccount(initial.settings.pilotAccess!)).toEqual(normalizeState(next));
    expect(api.identities).toHaveLength(2);
    expect(api.identities[0]).toBe(api.identities[1]);
    expect(api.effects).toBe(1);
    expect(original?.sourceHash).toBe(await checkpointSha256(new TextEncoder().encode(JSON.stringify(next))));
    expect(await fixture.journal.hasPending('ref-019-persistence')).toBe(false);
    expect(recreated.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
  });

  it('reads the transformed authoritative body after replay instead of confirming its optimistic checkpoint as canonical', async () => {
    const initial = buildState();
    initial.profiles = [profile('deleted-player', 'Synthetic Player')];
    initial.selfCheckIn = { capabilityGeneration: 'original-capability', generatedAt: '2026-11-03T12:00:00.000Z' };
    const pendingState = normalizeState(initial);
    pendingState.scriptTemplates.push('Retained pending operation');
    const fixture = createJournalFixture();
    await fixture.journal.store({ state: pendingState, expectedRevision: 1, mutationId: 'browser:restored-pending' });
    const api = createCheckpointApi(initial);
    api.transformCommit((state) => ({ ...state, profiles: [], selfCheckIn: { capabilityGeneration: 'server-preserved-capability', generatedAt: '2026-11-03T12:01:00.000Z' } }));
    const persistence = browserAdapter(api, fixture);
    const recovered = await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    expect(recovered?.profiles).toEqual([]);
    expect(recovered?.selfCheckIn?.capabilityGeneration).toBe('server-preserved-capability');
    expect(recovered?.scriptTemplates).toContain('Retained pending operation');
    expect(api.effects).toBe(1);
    expect(api.identities).toEqual(['browser:restored-pending']);
    expect(await fixture.journal.hasPending('ref-019-persistence')).toBe(false);
  });

  it.each(['false', 'throw'] as const)('bounds recovery when local acknowledgement cleanup returns %s after server commit', async (failure) => {
    const api = createCheckpointApi();
    const fixture = createJournalFixture();
    const originalDelete = fixture.backend.deleteIfToken;
    fixture.backend.deleteIfToken = async () => {
      if (failure === 'throw') throw new Error('Synthetic local cleanup failure');
      return false;
    };
    const persistence = browserAdapter(api, fixture);
    const initial = buildState();
    await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const next = normalizeState(initial);
    next.scriptTemplates.push('Durably committed action');
    expect(await persistence.saveState(next)).toMatchObject({ ok: true, revision: 2 });
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    const requests = api.calls.length;
    const receipts = api.identities.length;
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toMatchObject({ status: 'available' });
    expect(api.calls.length - requests).toBeLessThanOrEqual(2);
    expect(api.identities.length).toBe(receipts);
    expect(api.effects).toBe(1);
    fixture.backend.deleteIfToken = originalDelete;
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toMatchObject({ status: 'available' });
    expect(persistence.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
  });

  it('honors Retry-After and exponential delays before replaying retained browser work', async () => {
    const api = createCheckpointApi();
    const fixture = createJournalFixture();
    let now = 0;
    const persistence = browserAdapter(api, fixture, { now: () => now });
    await persistence.loadExistingStateForAccount(buildState().settings.pilotAccess!);
    const next = normalizeState(buildState());
    next.scriptTemplates.push('Retry this original action');
    api.rejectBegin({ status: 429, retryAfter: '10' });
    expect(await persistence.saveState(next)).toMatchObject({ ok: false, pending: true });
    const attempts = api.identities.length;
    now = 9999;
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toEqual({ status: 'unavailable' });
    expect(await persistence.saveState(next)).toMatchObject({ ok: false, pending: true });
    expect(api.identities).toHaveLength(attempts);
    now = 10000;
    api.rejectBegin({ status: 503 });
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toEqual({ status: 'unavailable' });
    expect(api.identities).toHaveLength(attempts + 1);
    now = 11999;
    await persistence.loadStateFromLocalBridge('ref-019-persistence');
    expect(api.identities).toHaveLength(attempts + 1);
    now = 12000;
    api.rejectBegin();
    expect(await persistence.loadStateFromLocalBridge('ref-019-persistence')).toMatchObject({ status: 'available' });
    expect(api.effects).toBe(1);
  });

  it.each([401, 403, 409, 410])('pauses permanent HTTP %s failures while retaining the operation for reconciliation', async (status) => {
    const api = createCheckpointApi();
    const fixture = createJournalFixture();
    let now = 0;
    const persistence = browserAdapter(api, fixture, { now: () => now });
    await persistence.loadExistingStateForAccount(buildState().settings.pilotAccess!);
    const next = normalizeState(buildState());
    next.scriptTemplates.push('Retain rejected action');
    api.rejectBegin({ status });
    expect(await persistence.saveState(next)).toMatchObject({ ok: false, pending: true });
    const requests = api.calls.length;
    now += 24 * 60 * 60 * 1000;
    for (let index = 0; index < 3; index += 1) await persistence.loadStateFromLocalBridge('ref-019-persistence');
    expect(api.calls).toHaveLength(requests);
    expect(await fixture.journal.hasPending('ref-019-persistence')).toBe(true);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    if ([401, 403].includes(status)) {
      api.rejectBegin();
      expect(await persistence.loadExistingStateForAccount(buildState().settings.pilotAccess!)).toMatchObject({ scriptTemplates: next.scriptTemplates });
      expect(api.effects).toBe(1);
    }
  });

  it('saves credential changes online with a deterministic transient receipt and never claims durable enqueue', async () => {
    const initial = buildState();
    initial.settings.accountLogin = { username: 'synthetic@example.test', passwordSalt: 'synthetic-salt', passwordHash: 'old-synthetic-hash', createdAt: '2026-11-03T12:00:00.000Z' };
    const api = createCheckpointApi(initial);
    const fixture = createJournalFixture();
    let now = 0;
    const persistence = browserAdapter(api, fixture, { now: () => now });
    await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const next = normalizeState(initial);
    if (next.settings.accountLogin) next.settings.accountLogin.passwordHash = 'new-synthetic-hash';
    api.loseNextAcknowledgement();
    expect(await persistence.saveState(next)).toMatchObject({ ok: false, pending: false });
    expect(fixture.records.size).toBe(0);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence').pending).toBe(true);
    now += 1000;
    expect(await persistence.saveState(next)).toMatchObject({ ok: true, revision: 2 });
    expect(api.identities[0]).toMatch(/^browser-credentials:1:[a-f0-9]{64}$/);
    expect(api.identities[0]).toBe(api.identities[1]);
    expect(api.effects).toBe(1);
    expect(fixture.records.size).toBe(0);
    expect(persistence.getDurablePendingAdmission('ref-019-persistence')).toEqual({ pending: false });
  });

  it('rejects a newer snapshot behind unresolved work without replacing its cache or durable record', async () => {
    const api = createCheckpointApi();
    const fixture = createJournalFixture();
    const { storage } = createStorage();
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState: api.fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage, random: () => 0.5 });
    const initial = buildState();
    await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const first = normalizeState(initial);
    first.scriptTemplates.push('First durable intent');
    api.loseNextAcknowledgement();
    expect(await persistence.saveState(first)).toMatchObject({ ok: false, pending: true });
    const newer = structuredClone(first);
    newer.scriptTemplates.push('Second unaccepted intent');
    expect(await persistence.saveState(newer)).toMatchObject({ ok: false, conflict: true });
    expect((await fixture.journal.load(first))?.state).toEqual(first);
    expect(loadBrowserManagementStateForAccount(initial.settings.pilotAccess!, storage)?.state).toEqual(first);
    expect(api.effects).toBe(1);
  });

  it('blocks new-account onboarding when authoritative recovery is unavailable or an uncommitted checkpoint exists', async () => {
    const api = createCheckpointApi(null);
    const fixture = createJournalFixture();
    const persistence = browserAdapter(api, fixture);
    const initial = buildState();
    expect(await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!)).toBeNull();
    await fixture.journal.store({ state: initial, mutationId: 'browser:uncommitted', expectedRevision: 0 });
    await expect(persistence.loadExistingStateForAccount(initial.settings.pilotAccess!)).rejects.toBeInstanceOf(BrowserManagementRecoveryError);
    expect(await fixture.journal.hasPending('ref-019-persistence')).toBe(true);
    const unavailable = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState: async () => { throw new Error('Synthetic offline'); },
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage });
    await expect(unavailable.loadExistingStateForAccount(initial.settings.pilotAccess!)).rejects.toMatchObject({ code: 'BROWSER_RECOVERY_UNAVAILABLE' });
  });

  it('durably retains a large browser save and retries its original receipt after a lost acknowledgement', async () => {
    const state = buildState();
    state.scriptTemplates = ['♠'.repeat(750000)];
    type EncryptedRecord = NonNullable<Awaited<ReturnType<BrowserCheckpointBackend['get']>>>;
    const records = new Map<string, EncryptedRecord>();
    let key: CryptoKey | undefined;
    const backend: BrowserCheckpointBackend = {
      getKey: async () => key, ensureKey: async (candidate) => key ??= candidate,
      get: async (reference) => records.get(reference),
      putIfAbsent: async (reference, value) => { const prior = records.get(reference); if (!prior) records.set(reference, value); return prior; },
      deleteIfToken: async (reference, token) => records.get(reference)?.token === token && records.delete(reference)
    };
    const checkpointJournal = createBrowserCheckpointJournal({ backend });
    const cap = { protocol: 'checkpoint-v1', chunkBytes: 262144, maximumSourceBytes: 33554432, maximumChunks: 128, maximumEnvelopeBytes: 400000 };
    const identities: string[] = [];
    let committed = false;
    let effects = 0;
    const fetchState: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/capabilities')) return Response.json({ ok: true, checkpoint: cap });
      expect(path).not.toBe('/state');
      expect(new TextEncoder().encode(String(init?.body)).length).toBeLessThan(400000);
      const body = JSON.parse(String(init?.body)) as { mutationId?: string };
      if (path.endsWith('/checkpoints')) {
        identities.push(String(body.mutationId));
        return Response.json({ ok: true, id: 'a'.repeat(64), received: [], ...(committed ? { completed: true,
          result: { accountKey: 'ref-019-persistence', mutationId: body.mutationId, revision: 1, publication: { status: 'pending' } } } : {}) });
      }
      if (path.endsWith('/finalize')) { committed = true; effects += 1; throw new Error('Synthetic lost acknowledgement'); }
      return Response.json({ ok: true });
    };
    const { storage } = createStorage();
    let now = 0;
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState, checkpointJournal,
      firebaseEnabled: false, getDesktopPersistence: () => undefined, saveFirebaseState: async () => undefined, storage, now: () => now, random: () => 0.5 });
    expect(await persistence.saveState(state)).toMatchObject({ ok: false, pending: true, cloud: 'not-committed' });
    expect((await checkpointJournal.load(state))?.state.scriptTemplates).toEqual(state.scriptTemplates);
    now += 1000;
    expect(await persistence.saveState(state)).toMatchObject({ ok: true, revision: 1, cloud: 'server-pending' });
    expect(identities[0]).toBe(identities[1]);
    expect(effects).toBe(1);
    expect(await checkpointJournal.load(state)).toBeNull();
  });

  it('treats browser storage as cache and commits through the revisioned localhost API', async () => {
    const state = buildState();
    const { storage, values } = createStorage();
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchState: typeof fetch = async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, revision: 1, publication: { status: 'pending' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    };
    const saveFirebaseState = vi.fn(async () => undefined);
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState,
      firebaseEnabled: false,
      getDesktopPersistence: () => undefined,
      saveFirebaseState,
      storage
    });

    await expect(persistence.saveState(state)).resolves.toEqual({
      ok: true,
      path: 'orbit-api',
      accountKey: 'ref-019-persistence',
      revision: 1,
      publication: { status: 'pending' },
      cloud: 'server-pending'
    });
    expect(JSON.parse(values.get('table-manager-state-v1') ?? '{}')).toEqual({
      schemaVersion: 5,
      cache: 'memory-only',
      restrictedDataPersisted: false
    });
    expect(fetchCalls.map((call) => call.input)).toEqual(['http://127.0.0.1:4629/state/capabilities', 'http://127.0.0.1:4629/state']);
    const requestBody = JSON.parse(String(fetchCalls[1].init?.body));
    expect(requestBody).toMatchObject({
      expectedRevision: 0,
      state: { settings: { pilotAccess: { licenseId: 'ref-019-persistence' } } }
    });
    expect(requestBody.mutationId).toMatch(/^browser:[a-f0-9-]{36}$/);
    expect(saveFirebaseState).not.toHaveBeenCalled();
  });

  it('selects desktop persistence, skips the localhost bridge and renderer Firebase publication', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const fetchState = vi.fn<typeof fetch>();
    const desktopSave = vi.fn(async () => ({ ok: true, path: 'desktop', accountKey: 'ref-019-persistence' }));
    const saveFirebaseState = vi.fn(async () => {
      throw new Error('optional Firebase unavailable');
    });
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState,
      firebaseEnabled: true,
      getDesktopPersistence: () => ({ saveState: desktopSave }),
      saveFirebaseState,
      storage
    });

    await expect(persistence.saveState(state)).resolves.toEqual({
      ok: true,
      path: 'desktop',
      accountKey: 'ref-019-persistence',
      cloud: 'server-pending'
    });
    expect(desktopSave).toHaveBeenCalledWith(state);
    expect(fetchState).not.toHaveBeenCalled();
    expect(saveFirebaseState).not.toHaveBeenCalled();
  });

  it('preserves the selected local persistence failure as the visible save result', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false,
      getDesktopPersistence: () => ({
        saveState: async () => {
          throw new Error('desktop save failed');
        }
      }),
      saveFirebaseState: async () => undefined,
      storage
    });

    await expect(persistence.saveState(state)).rejects.toThrow('desktop save failed');
  });

  it('maps localhost bridge reads without exposing HTTP policy to synchronization hooks', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const urls: string[] = [];
    const fetchState: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/missing')) return new Response(null, { status: 404 });
      if (url.endsWith('/offline')) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({ state }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState,
      firebaseEnabled: false,
      getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined,
      storage
    });

    await expect(persistence.loadStateFromLocalBridge('missing')).resolves.toEqual({ status: 'missing' });
    await expect(persistence.loadStateFromLocalBridge('offline')).resolves.toEqual({ status: 'unavailable' });
    await expect(persistence.loadStateFromLocalBridge('club one')).resolves.toEqual({ status: 'available', state });
    expect(urls.at(-1)).toBe('http://127.0.0.1:4629/state/club%20one');
  });

  it('restores desktop state first and falls back locally while replacing pilot access', async () => {
    const desktopState = buildState();
    desktopState.games = [{ id: 'desktop', name: 'Desktop', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }];
    desktopState.profiles = [profile('lucky-regular', 'Lucky Lodge Regular')];
    desktopState.settings.accountLogin = {
      username: 'manager@luckylodge.example',
      passwordSalt: 'provisioned-salt',
      passwordHash: 'provisioned-hash',
      createdAt: '2026-08-11T15:00:00.000Z'
    };
    const localState = buildState();
    localState.games = [{ id: 'local', name: 'Local', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }];
    const replacementAccess = {
      ...localState.settings.pilotAccess!,
      expiresAt: '2099-11-30T23:59:59.000Z'
    };
    const { storage, values } = createStorage();
    values.set('table-manager-state-v1:ref-019-persistence', JSON.stringify(localState));
    const desktopLoad = vi.fn(async () => ({
      schemaVersion: 4,
      savedAt: '2026-08-08T22:00:00.000Z',
      state: desktopState
    }));
    const desktopPersistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false,
      getDesktopPersistence: () => ({
        loadStateForAccount: desktopLoad,
        saveState: async () => ({ ok: true, path: 'desktop' })
      }),
      saveFirebaseState: async () => undefined,
      storage
    });

    await expect(desktopPersistence.loadExistingStateForAccount(replacementAccess)).resolves.toMatchObject({
      games: [{ name: 'Desktop' }],
      profiles: [{ name: 'Lucky Lodge Regular' }],
      settings: {
        pilotAccess: replacementAccess,
        accountLogin: { username: 'manager@luckylodge.example' }
      }
    });
    expect(desktopLoad).toHaveBeenCalledWith(replacementAccess);

    const fallbackPersistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false,
      getDesktopPersistence: () => ({
        loadStateForAccount: async () => {
          throw new Error('desktop unavailable');
        },
        saveState: async () => ({ ok: true, path: 'desktop' })
      }),
      saveFirebaseState: async () => undefined,
      storage
    });
    await expect(fallbackPersistence.loadExistingStateForAccount(replacementAccess)).resolves.toMatchObject({
      games: [{ name: 'Local' }],
      settings: { pilotAccess: replacementAccess }
    });
  });

  it('registers update preservation against the latest supplied state and cleans up', () => {
    const state = buildState();
    let prepare: ((requestId: string) => void) | undefined;
    const cleanup = vi.fn();
    const preserveStateForUpdate = vi.fn(async () => ({ ok: true }));
    const { storage } = createStorage();
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false,
      getDesktopPersistence: () => ({
        onPrepareForUpdate: (callback) => {
          prepare = callback;
          return cleanup;
        },
        preserveStateForUpdate,
        saveState: async () => ({ ok: true, path: 'desktop' })
      }),
      saveFirebaseState: async () => undefined,
      storage
    });

    const dispose = persistence.registerUpdatePreservation(() => state);
    prepare?.('update-1');
    expect(preserveStateForUpdate).toHaveBeenCalledWith('update-1', state);
    dispose?.();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('released read ownership with protected browser persistence', () => {
  it('does not accept a deferred legacy read revision after its caller loses ownership', async () => {
    const state = buildState();
    const posted: Array<{ expectedRevision: number }> = [];
    const fetchState: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/capabilities')) return Response.json({}, { status: 404 });
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        return Response.json({ ok: false }, { status: 409 });
      }
      return Response.json({ accountKey: 'ref-019-persistence', revision: 7, state });
    };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      firebaseEnabled: false, getDesktopPersistence: () => undefined, saveFirebaseState: async () => undefined, storage: createStorage().storage });
    let current = true;
    const candidate = await persistence.loadStateFromLocalBridge('ref-019-persistence', () => current, { deferRevisionAcceptance: true });
    expect(candidate.status).toBe('available');
    if (candidate.status !== 'available') throw new Error('Expected the deferred synthetic read');
    current = false;
    expect(candidate.acceptReadRevision?.()).toBe(false);
    expect(await persistence.publishStateToLocalBridge(state)).toMatchObject({ ok: false, conflict: true });
    expect(posted).toHaveLength(1);
    expect(posted[0].expectedRevision).toBe(0);
  });

  it('advances checkpoint revision and protected canonical data only when the deferred owner accepts', async () => {
    const initial = buildState();
    const api = createCheckpointApi(initial), fixture = createJournalFixture(), persistence = browserAdapter(api, fixture);
    await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    const remote = { ...initial, settings: { ...initial.settings, lowLight: true } };
    api.advanceCanonical(remote);
    let current = true;
    const candidate = await persistence.loadStateFromLocalBridge('ref-019-persistence', () => current, { deferRevisionAcceptance: true });
    expect(candidate.status).toBe('available');
    if (candidate.status !== 'available') throw new Error('Expected the verified checkpoint read');
    current = false;
    expect(candidate.acceptReadRevision?.()).toBe(false);
    expect(await persistence.saveState({ ...initial, scriptTemplates: ['Synthetic local change'] })).toMatchObject({ ok: false, conflict: true, pending: true });
    const rejectedBegin = api.calls.find(call => call.method === 'POST' && call.path.endsWith('/checkpoints'));
    expect(JSON.parse(rejectedBegin?.body || '{}').expectedRevision).toBe(1);
    expect(api.effects).toBe(0);
    expect(fixture.records.size).toBe(1);

    const acceptedApi = createCheckpointApi(initial), acceptedFixture = createJournalFixture();
    const acceptedPersistence = browserAdapter(acceptedApi, acceptedFixture);
    await acceptedPersistence.loadExistingStateForAccount(initial.settings.pilotAccess!);
    acceptedApi.advanceCanonical(remote);
    const accepted = await acceptedPersistence.loadStateFromLocalBridge('ref-019-persistence', () => true, { deferRevisionAcceptance: true });
    if (accepted.status !== 'available' || !accepted.state) throw new Error('Expected the accepted verified checkpoint');
    expect(accepted.acceptReadRevision?.()).toBe(true);
    expect(await acceptedPersistence.saveState({ ...accepted.state, scriptTemplates: ['Synthetic accepted change'] })).toMatchObject({ ok: true, revision: 3 });
    const acceptedBegin = acceptedApi.calls.find(call => call.method === 'POST' && call.path.endsWith('/checkpoints'));
    expect(JSON.parse(acceptedBegin?.body || '{}').expectedRevision).toBe(2);
    expect(acceptedApi.canonical?.settings.lowLight).toBe(true);
    expect(acceptedApi.effects).toBe(1);
  });
});

describe('checkpoint read HTTP provenance', () => {
  it.each([
    { boundary: 'manifest', status: 403 },
    { boundary: 'chunk', status: 503 }
  ])('rejects a valid checkpoint $boundary body carried by HTTP $status without accepting its revision', async ({ boundary, status }) => {
    const initial = buildState();
    const api = createCheckpointApi(initial), fixture = createJournalFixture();
    let rejectRead = false;
    let rejectedResponses = 0;
    const fetchState: typeof fetch = async (input, init) => {
      const response = await api.fetchState(input, init);
      const pathname = new URL(String(input)).pathname;
      const checkpointRead = (init?.method || 'GET') === 'GET' && pathname.includes('/state/checkpoint/');
      const selectedBoundary = boundary === 'chunk' ? pathname.includes('/chunks/') : !pathname.includes('/chunks/');
      if (rejectRead && checkpointRead && selectedBoundary && response.ok) {
        rejectedResponses += 1;
        return Response.json(await response.json(), { status });
      }
      return response;
    };
    const persistence = createManagementPersistence({ bridgeBaseUrl: 'http://127.0.0.1:4629', fetchState,
      checkpointJournal: fixture.journal, firebaseEnabled: false, getDesktopPersistence: () => undefined,
      saveFirebaseState: async () => undefined, storage: createStorage().storage, now: () => 0 });
    expect(await persistence.loadExistingStateForAccount(initial.settings.pilotAccess!)).toMatchObject({ settings: { lowLight: initial.settings.lowLight } });
    api.advanceCanonical({ ...initial, settings: { ...initial.settings, lowLight: !initial.settings.lowLight } });
    rejectRead = true;
    await expect(persistence.loadExistingStateForAccount(initial.settings.pilotAccess!)).rejects.toMatchObject({
      code: 'BROWSER_RECOVERY_UNAVAILABLE'
    });
    expect(rejectedResponses).toBe(1);
    rejectRead = false;
    expect(await persistence.saveState({ ...initial, scriptTemplates: ['The failed HTTP read did not own revision two'] }))
      .toMatchObject({ ok: false, conflict: true, pending: true });
    const begin = api.calls.find(call => call.method === 'POST' && call.path.endsWith('/checkpoints'));
    expect(JSON.parse(begin?.body || '{}').expectedRevision).toBe(1);
    expect(api.effects).toBe(0);
    expect(fixture.records.size).toBe(1);
  });
});
