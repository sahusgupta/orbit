// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../../domain/types';
import { normalizeState } from '../../../domain/state';
import { createManagementPersistence } from '../../../app/persistence/managementPersistence';
import { useManagementPlayerUpdateSync } from './useManagementPlayerUpdateSync';

type Persistence = ReturnType<typeof createManagementPersistence>;
const bridge = vi.hoisted(() => ({
  load: vi.fn<Persistence['loadStateFromLocalBridge']>(),
  publish: vi.fn<Persistence['publishStateToLocalBridge']>(),
  cache: vi.fn<(state: AppState) => void>()
}));
vi.mock('../../../app/persistence/managementPersistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../app/persistence/managementPersistence')>();
  return {
    ...actual, hasManagementDesktopPersistence: () => false,
    loadManagementStateFromLocalBridge: (...args: Parameters<Persistence['loadStateFromLocalBridge']>) => bridge.load(...args),
    publishStateToLocalOrbitBridge: (...args: Parameters<Persistence['publishStateToLocalBridge']>) => bridge.publish(...args)
  };
});
vi.mock('../../../app/persistence/browserStateRepository', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../app/persistence/browserStateRepository')>();
  return { ...actual, saveBrowserManagementState: (state: AppState) => bridge.cache(state) };
});

const accountKey = 'synthetic-revision-race';
const otherAccountKey = 'synthetic-revision-other';
const origin = 'http://127.0.0.1:9';
const baseState = (key = accountKey) => normalizeState({
  settings: { pilotAccess: { authorized: true, authorizationCode: 'inert-fixture-key', licenseId: key,
    issuedTo: 'Synthetic room', expiresAt: '2099-12-31', activatedAt: '2026-10-31T00:00:00.000Z' } },
  profiles: [{
    id: 'synthetic-profile', name: 'Synthetic Player', notes: 'original', phone: '', birthday: '',
    membershipStartDate: '', membershipExpirationDate: '', totalTimePlayedHours: 0, lastSessionTimePlayedHours: 0,
    commonlyPlaysWithProfileIds: [], preferredGameId: '', preferredGameIds: [], gamePlayCounts: {}, mostPlayedGameId: '',
    preferredStakes: '', typicalBuyInMin: 0, typicalBuyInMax: 0, willingnessToMove: false,
    typicalAvailability: '', usualCompanions: [], preferredTags: []
  }]
});
const record = (revision: number, state: AppState, key = accountKey) => new Response(JSON.stringify({ accountKey: key, revision, state }),
  { status: 200, headers: { 'content-type': 'application/json' } });
const cleanups: Array<() => Promise<void>> = [];

async function flush() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

async function fixture(initialPending = false, options: {
  deferBody?: boolean;
  throwAcceptanceOnce?: boolean;
  rejectAcceptanceOnce?: boolean;
  missingAfterRead?: boolean;
  unchangedRemote?: boolean;
  malformedNormalization?: boolean;
} = {}) {
  const base = baseState();
  const other = baseState(otherAccountKey);
  const remote = options.unchangedRemote ? structuredClone(base)
    : normalizeState({ ...base, profiles: base.profiles.map(profile => ({ ...profile, notes: 'external note' })) });
  let release = (_response: Response) => {};
  const pendingResponse = new Promise<Response>(resolve => { release = resolve; });
  const remoteBody = { accountKey, revision: 2, state: options.malformedNormalization
    ? { ...remote, settings: { ...remote.settings, collectionProfiles: {} } }
    : remote };
  let releaseBody = (_body: typeof remoteBody) => {};
  const pendingBody = new Promise<typeof remoteBody>(resolve => { releaseBody = resolve; });
  let bodyStarted = false;
  const headersBeforeBody = record(2, remote);
  vi.spyOn(headersBeforeBody, 'json').mockImplementation(() => { bodyStarted = true; return pendingBody; });
  let gets = 0;
  const posts: Array<{ expectedRevision: number; mutationId: string; state: AppState }> = [];
  const fetchState: typeof fetch = vi.fn(async (input, init) => {
    if (init?.method === 'POST') {
      expect(input).toBe(`${origin}/state`);
      const body: { expectedRevision: number; mutationId: string; state: AppState } = JSON.parse(String(init.body));
      posts.push(body);
      return new Response(JSON.stringify({ ok: true, revision: body.expectedRevision + 1 }), { status: 200 });
    }
    if (input === `${origin}/state/${otherAccountKey}`) return record(10, other, otherAccountKey);
    expect(input).toBe(`${origin}/state/${accountKey}`);
    gets += 1;
    if (gets === 1) return record(1, base);
    if (gets === 2) return options.deferBody ? headersBeforeBody : pendingResponse;
    if (options.missingAfterRead) return new Response(null, { status: 404 });
    // Each later poll owns a fresh body; never reuse an already-consumed Response.
    return record(2, remote);
  });
  const persistence = createManagementPersistence({ bridgeBaseUrl: origin, fetchState, firebaseEnabled: false,
    getDesktopPersistence: () => undefined, saveFirebaseState: async () => undefined, storage: localStorage });
  await persistence.loadStateFromLocalBridge(accountKey);
  let acceptanceChecks = 0;
  bridge.load.mockImplementation((key, canAcceptRead, readOptions) => persistence.loadStateFromLocalBridge(key, () => {
    acceptanceChecks += 1;
    if (options.throwAcceptanceOnce && acceptanceChecks === 1) throw new Error('Synthetic acceptance failure after body parsing.');
    if (options.rejectAcceptanceOnce && acceptanceChecks === 1) return false;
    return canAcceptRead ? canAcceptRead() : true;
  }, readOptions));
  bridge.publish.mockImplementation(persistence.publishStateToLocalBridge);
  const stateRef = { current: base };
  const gate = { pending: initialPending };
  const setState = vi.fn();
  const clearUndo = vi.fn();
  const setSaveStatus = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let mounted = false;
  function Harness({ activeAccountKey }: { activeAccountKey: string }) {
    useManagementPlayerUpdateSync({ activeAccountKey, hasAuthenticated: true,
      state: stateRef.current, stateRef, isManagementSavePending: () => gate.pending, setState,
      announceIncomingPlayerRequest: vi.fn(), clearUndo, setSaveStatus });
    return null;
  }
  const unmount = async () => {
    if (!mounted) return;
    await act(async () => root.unmount());
    mounted = false;
  };
  cleanups.push(async () => {
    await unmount();
    container.remove(); release(record(2, remote)); releaseBody(remoteBody);
    await act(flush);
  });
  await act(async () => { root.render(createElement(Harness, { activeAccountKey: accountKey })); });
  mounted = true;
  return {
    base, other, remote, stateRef, gate, setState, clearUndo, setSaveStatus, posts, persistence, unmount,
    getCount: () => gets, bodyStarted: () => bodyStarted, acceptanceChecks: () => acceptanceChecks,
    queueAfterBody(callback: () => void) {
      expect(bodyStarted).toBe(true);
      return pendingBody.then(callback);
    },
    async switchAccount() {
      stateRef.current = other;
      await act(async () => { root.render(createElement(Harness, { activeAccountKey: otherAccountKey })); });
    },
    async release() { release(record(2, remote)); releaseBody(remoteBody); await act(flush); }
  };
}

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External network forbidden in isolated composition fixture.'); }));
});
afterEach(async () => {
  try { for (const close of cleanups.splice(0)) await close(); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('actual browser persistence and incoming-sync composition', () => {
  it('advances the save revision when the incoming snapshot is accepted and rendered', async () => {
    const f = await fixture();
    await f.release();
    expect(f.setState).toHaveBeenCalledTimes(1);
    expect(f.stateRef.current.profiles[0].notes).toBe('external note');
    await f.persistence.publishStateToLocalBridge(f.stateRef.current);
    expect(f.posts[0].expectedRevision).toBe(2);
  });
  it('does not start a background read when a local save is already pending', async () => {
    const f = await fixture(true);
    await act(flush);
    expect(f.getCount()).toBe(1);
    expect(f.setState).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  const rejectedReads: Array<{ name: string; pending: boolean; changed: boolean }> = [
    { name: 'a save begins without replacing the local state', pending: true, changed: false },
    { name: 'the local state changes without a pending save', pending: false, changed: true },
    { name: 'a local edit also queues a save', pending: true, changed: true }
  ];
  it.each(rejectedReads)('retains the last applied save revision when $name', async ({ pending, changed }) => {
    const f = await fixture();
    const local = changed
      ? normalizeState({ ...f.base, profiles: f.base.profiles.map(profile => ({ ...profile, notes: 'local note' })) })
      : f.base;
    f.stateRef.current = local;
    f.gate.pending = pending;
    await f.release();
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    expect(f.stateRef.current).toBe(local);
    await f.persistence.publishStateToLocalBridge(local);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  it('does not adopt a response revision after the polling effect unmounts', async () => {
    const f = await fixture();
    await f.unmount();
    await f.release();
    expect(f.stateRef.current).toBe(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  it('retires the old account read without lending its revision to either account after a switch', async () => {
    const f = await fixture();
    await f.switchAccount();
    await f.release();
    expect(f.stateRef.current).toBe(f.other);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    await f.persistence.publishStateToLocalBridge(f.other);
    expect(f.posts.map(post => post.expectedRevision)).toEqual([1, 10]);
  });

  it.each(rejectedReads.filter(item => item.pending !== item.changed))('checks ownership after deferred JSON when $name', async ({ pending, changed }) => {
    const f = await fixture(false, { deferBody: true });
    expect(f.getCount()).toBe(2);
    expect(f.bodyStarted()).toBe(true);
    const local = changed
      ? normalizeState({ ...f.base, profiles: f.base.profiles.map(profile => ({ ...profile, notes: 'local note after headers' })) })
      : f.base;
    f.stateRef.current = local;
    f.gate.pending = pending;
    await f.release();
    expect(f.stateRef.current).toBe(local);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(local);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  it.each(rejectedReads)('retains the prior revision when a queued body microtask means $name', async ({ pending, changed }) => {
    const f = await fixture(false, { deferBody: true });
    const local = changed
      ? normalizeState({ ...f.base, profiles: f.base.profiles.map(profile => ({ ...profile, notes: 'local note from queued continuation' })) })
      : f.base;
    // The adapter already awaits this native body Promise. This independently
    // queued continuation can run before its hook consumer resumes.
    const localContinuation = f.queueAfterBody(() => {
      f.stateRef.current = local;
      f.gate.pending = pending;
    });
    await f.release();
    await localContinuation;
    expect(f.stateRef.current).toBe(local);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(local);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  it('releases the busy gate after a throwing acceptance predicate so the next poll can recover', async () => {
    const f = await fixture(false, { throwAcceptanceOnce: true });
    await f.release();
    expect(f.acceptanceChecks()).toBe(1);
    expect(f.getCount()).toBe(2);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await flush(); });
    expect(f.getCount()).toBe(3);
    expect(f.acceptanceChecks()).toBe(2);
    expect(f.setState).toHaveBeenCalledTimes(1);
    expect(bridge.cache).toHaveBeenCalledTimes(1);
    expect(f.clearUndo).toHaveBeenCalledTimes(1);
    expect(f.stateRef.current.profiles[0].notes).toBe('external note');
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.stateRef.current);
    expect(f.posts[0].expectedRevision).toBe(2);
  });

  it.each(['reject', 'throw'] as const)('keeps a deferred %s from applying or initializing the bridge before a later missing read', async outcome => {
    const f = await fixture(false, { deferBody: true, missingAfterRead: true,
      rejectAcceptanceOnce: outcome === 'reject', throwAcceptanceOnce: outcome === 'throw' });
    await f.release();
    expect(f.acceptanceChecks()).toBe(1);
    expect(f.stateRef.current).toBe(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    expect(f.posts).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await flush(); });
    expect(f.getCount()).toBe(3);
    expect(bridge.publish).toHaveBeenCalledOnce();
    expect(f.posts).toHaveLength(1);
    expect(f.posts[0].expectedRevision).toBe(1);
    expect(f.posts[0].state).toEqual(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
  });

  it('accepts a revision with unchanged operations without applying UI or reinitializing after a later missing read', async () => {
    const f = await fixture(false, { deferBody: true, unchangedRemote: true, missingAfterRead: true });
    await f.release();
    expect(f.acceptanceChecks()).toBe(1);
    expect(f.stateRef.current).toBe(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    expect(f.posts[0].expectedRevision).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); await flush(); });
    expect(f.getCount()).toBe(3);
    expect(bridge.publish).not.toHaveBeenCalled();
    expect(f.posts).toHaveLength(1);
  });

  it('does not acknowledge a body whose malformed collection profiles fail normalization', async () => {
    const f = await fixture(false, { deferBody: true, malformedNormalization: true });
    await f.release();
    expect(f.acceptanceChecks()).toBe(0);
    expect(f.stateRef.current).toBe(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    expect(f.posts[0].expectedRevision).toBe(1);
  });

  it('does not acknowledge a snapshot when comparing local operations throws', async () => {
    const f = await fixture(false, { deferBody: true });
    Object.defineProperty(f.base.profiles, 'toJSON', { configurable: true,
      value() { throw new Error('Synthetic local operation comparison failure.'); } });
    try { await f.release(); }
    finally { Reflect.deleteProperty(f.base.profiles, 'toJSON'); }
    expect(f.acceptanceChecks()).toBe(0);
    expect(f.stateRef.current).toBe(f.base);
    expect(f.setState).not.toHaveBeenCalled();
    expect(bridge.cache).not.toHaveBeenCalled();
    expect(f.clearUndo).not.toHaveBeenCalled();
    expect(f.setSaveStatus).not.toHaveBeenCalled();
    expect(bridge.publish).not.toHaveBeenCalled();
    await f.persistence.publishStateToLocalBridge(f.base);
    expect(f.posts[0].expectedRevision).toBe(1);
  });
});
