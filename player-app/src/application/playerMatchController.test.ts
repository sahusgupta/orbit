import { describe, expect, it, vi } from 'vitest';
import { applyMatchOperation, createMatchState } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import { defaultMatchPreferences, type MatchJournal, type MatchOperation, type MatchState } from '../domain/orbitMatchTypes';
import { createPlayerMatchController, type MatchControllerSnapshot, type MatchPersistencePort } from './playerMatchController';

const ref = { clubId: 'venue-one', gameId: 'game-one', kind: 'cash' as const };
const summary = { venueName: 'Example Venue', gameName: '1/2 NLH' };
const now = () => Date.parse('2026-10-12T12:00:00.000Z');
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
async function settle() { for (let index = 0; index < 30; index += 1) await Promise.resolve(); }

function harness(initial = createMatchState(defaultMatchPreferences), restored: MatchJournal | null = null) {
  let server: MatchState = initial;
  let journal = restored;
  let listener: ((state: MatchState) => void) | undefined;
  const subscriptions: Array<{ onState: (state: MatchState) => void; onError: (error: Error) => void; unsubscribe: () => void }> = [];
  let identifier = 0;
  const changes: MatchControllerSnapshot[] = [];
  const unsubscribe = vi.fn();
  const port = {
    loadJournal: vi.fn(async (_uid: string): Promise<unknown> => journal),
    saveJournal: vi.fn(async (_uid: string, next: MatchJournal) => { journal = structuredClone(next); }),
    fetchState: vi.fn(async (_uid: string) => server),
    mutate: vi.fn(async (_uid: string, operation: MatchOperation) => { server = applyMatchOperation(server, operation, now()); return server; }),
    subscribe: vi.fn((_uid: string, onState: (state: MatchState) => void, onError: (error: Error) => void) => {
      listener = onState;
      const subscription = { onState, onError, unsubscribe: vi.fn(() => unsubscribe()) };
      subscriptions.push(subscription);
      return subscription.unsubscribe;
    })
  } satisfies MatchPersistencePort;
  const controller = createPlayerMatchController({ uid: 'uid-one', preferences: defaultMatchPreferences, port,
    now, createId: () => `mutation-${String(++identifier).padStart(16, '0')}`, onChange: (snapshot) => changes.push(snapshot) });
  return { controller, port, changes, unsubscribe, subscriptions, journal: () => journal, server: () => server,
    setServer: (state: MatchState) => { server = state; },
    push: (state: MatchState) => { if (!listener) throw new Error('Missing subscription'); listener(state); } };
}

function conflictingPreferenceChain() {
  const original = createMatchState();
  const first: Extract<MatchOperation, { type: 'preferences' }> = { mutationId: 'local-preferences-0001', type: 'preferences', basePreferencesRevision: 0,
    preferences: { ...defaultMatchPreferences, maxDistanceMiles: 20 } };
  const second: Extract<MatchOperation, { type: 'preferences' }> = { mutationId: 'local-preferences-0002', type: 'preferences', basePreferencesRevision: 1,
    preferences: { ...first.preferences, maxWaitlist: 3 } };
  const remote = applyMatchOperation(original, { mutationId: 'remote-preferences-01', type: 'preferences', basePreferencesRevision: 0,
    preferences: { ...defaultMatchPreferences, favoriteClubIds: ['remote-venue'] } }, now());
  return { original, first, second, remote };
}

describe('Durable player Match controller', () => {
  it('rejects an early save until the owned journal has finished restoring', async () => {
    const initial = createMatchState({ ...defaultMatchPreferences, favoriteClubIds: ['restored-venue'] });
    const restored: MatchJournal = { uid: 'uid-one', confirmed: initial, pending: [] };
    const restoration = deferred<MatchJournal>();
    const state = harness(initial);
    state.port.loadJournal.mockImplementationOnce(() => restoration.promise);
    const starting = state.controller.start();
    await settle();
    await expect(state.controller.decide(ref, summary, 'saved')).resolves.toBe(false);
    expect(state.controller.snapshot()).toMatchObject({ ready: false, pending: false, working: false });
    expect(state.controller.snapshot().state.decisions).toEqual([]);
    expect(state.journal()).toBeNull();
    expect(state.port.saveJournal).not.toHaveBeenCalled();
    expect(state.port.fetchState).not.toHaveBeenCalled();
    expect(state.port.mutate).not.toHaveBeenCalled();
    restoration.resolve(restored);
    await starting;
    expect(state.controller.snapshot()).toMatchObject({ ready: true, pending: false, error: '', state: initial });
    expect(state.journal()).toEqual(restored);
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    state.controller.dispose();
  });

  it('restores and syncs the owned pending save after an explicit retry of a failed journal load', async () => {
    const pending: MatchOperation = { mutationId: 'restored-save-0000001', type: 'decide', ref, summary, decision: 'saved' };
    const restored: MatchJournal = { uid: 'uid-one', confirmed: createMatchState(), pending: [pending] };
    const state = harness(createMatchState(), restored);
    state.port.loadJournal.mockRejectedValueOnce(new Error('Secure journal unavailable'));
    await state.controller.start();
    expect(state.controller.snapshot()).toMatchObject({ ready: false, pending: false, error: 'Secure journal unavailable' });
    expect(state.port.fetchState).not.toHaveBeenCalled();
    expect(state.port.subscribe).not.toHaveBeenCalled();
    expect(state.port.mutate).not.toHaveBeenCalled();
    expect(state.journal()).toEqual(restored);
    await state.controller.retry();
    expect(state.port.loadJournal).toHaveBeenCalledTimes(2);
    expect(state.port.mutate).toHaveBeenCalledExactlyOnceWith('uid-one', pending);
    expect(state.controller.snapshot()).toMatchObject({ ready: true, pending: false, error: '', state: state.server() });
    expect(state.server().decisions).toMatchObject([{ mutationId: pending.mutationId, ref, decision: 'saved' }]);
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: state.server(), pending: [] });
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    state.controller.dispose();
  });

  it('retires a delayed journal restoration after disposal without publishing or syncing it', async () => {
    const pending: MatchOperation = { mutationId: 'disposed-save-0000001', type: 'decide', ref, summary, decision: 'saved' };
    const restoration = deferred<MatchJournal>();
    const state = harness();
    state.port.loadJournal.mockImplementationOnce(() => restoration.promise);
    const starting = state.controller.start();
    await settle();
    state.controller.dispose();
    const changes = state.changes.length;
    restoration.resolve({ uid: 'uid-one', confirmed: createMatchState(), pending: [pending] });
    await starting;
    await settle();
    expect(state.changes).toHaveLength(changes);
    expect(state.journal()).toBeNull();
    expect(state.port.saveJournal).not.toHaveBeenCalled();
    expect(state.port.fetchState).not.toHaveBeenCalled();
    expect(state.port.subscribe).not.toHaveBeenCalled();
    expect(state.port.mutate).not.toHaveBeenCalled();
    await expect(state.controller.decide(ref, summary, 'saved')).resolves.toBe(false);
  });

  it.each(['retry', 'start'] as const)('preserves a newly durable offline save when an overlapping %s finishes a captured old journal restore', async (overlap) => {
    const initial = createMatchState({ ...defaultMatchPreferences, favoriteClubIds: ['restored-venue'] });
    const oldJournal: MatchJournal = { uid: 'uid-one', confirmed: initial, pending: [] };
    const firstRestore = deferred<MatchJournal>();
    const secondRestore = deferred<MatchJournal>();
    const state = harness(initial, structuredClone(oldJournal));
    state.port.loadJournal.mockImplementationOnce(() => firstRestore.promise).mockImplementationOnce(() => secondRestore.promise);
    state.port.fetchState.mockRejectedValueOnce(new Error('Offline during initial fetch'));
    state.port.mutate.mockRejectedValueOnce(new Error('Offline while saving'));
    const starting = state.controller.start();
    const overlapping = overlap === 'retry' ? state.controller.retry() : state.controller.start();
    await settle();
    expect(state.controller.snapshot().ready).toBe(false);
    firstRestore.resolve(structuredClone(oldJournal));
    await starting;
    await expect(state.controller.decide(ref, summary, 'saved')).resolves.toBe(true);
    await settle();
    const saved = state.journal()?.pending[0];
    if (!saved || saved.type !== 'decide') throw new Error('The offline Save must be durable before the delayed restoration finishes');
    expect(state.controller.snapshot()).toMatchObject({ ready: true, pending: true, state: { decisions: [{ mutationId: saved.mutationId, ref, decision: 'saved' }] } });
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: initial, pending: [saved] });
    secondRestore.resolve(structuredClone(oldJournal));
    await overlapping;
    await settle();
    expect.soft(state.controller.snapshot()).toMatchObject({ ready: true, pending: true, state: { decisions: [{ mutationId: saved.mutationId, ref, decision: 'saved' }] } });
    expect.soft(state.journal()).toEqual({ uid: 'uid-one', confirmed: initial, pending: [saved] });
    await state.controller.retry();
    expect(state.port.mutate.mock.calls.map((call) => call[1])).toEqual([saved, saved]);
    expect(state.server().decisions).toMatchObject([{ mutationId: saved.mutationId, ref, decision: 'saved' }]);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, state: state.server() });
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: state.server(), pending: [] });
    state.controller.dispose();
  });

  it('restores server saves and preferences before further writes without replacing them with defaults', async () => {
    const server = applyMatchOperation(createMatchState({ ...defaultMatchPreferences, favoriteClubIds: ['existing-venue'] }), {
      mutationId: 'server-mutation-000001', type: 'decide', ref, summary, decision: 'saved'
    }, now());
    const state = harness(server);
    await state.controller.start();
    expect(state.controller.snapshot()).toMatchObject({ ready: true, pending: false, error: '', state: server });
    expect(state.port.mutate).not.toHaveBeenCalled();
    expect(state.journal()?.confirmed).toEqual(server);
  });

  it('keeps one healthy listener across repeated explicit retries and still receives another device state', async () => {
    const state = harness();
    await state.controller.start();
    await state.controller.retry();
    await state.controller.retry();
    expect(state.port.fetchState).toHaveBeenCalledTimes(3);
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    expect(state.subscriptions).toHaveLength(1);
    expect(state.unsubscribe).not.toHaveBeenCalled();
    const remote = applyMatchOperation(state.server(), { mutationId: 'other-device-save-0001', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[0].onState(remote);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ ready: true, pending: false, error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });

  it('installs the first listener only after an initially failed fetch succeeds on explicit retry', async () => {
    const state = harness();
    state.port.fetchState.mockRejectedValueOnce(new Error('Initial Match fetch failed'));
    await state.controller.start();
    expect(state.controller.snapshot()).toMatchObject({ ready: true, error: 'Initial Match fetch failed' });
    expect(state.port.subscribe).not.toHaveBeenCalled();
    await state.controller.retry();
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    const remote = applyMatchOperation(state.server(), { mutationId: 'other-device-save-0002', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[0].onState(remote);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
  });

  it('recovers a thrown initial subscription setup on explicit retry without sending an operation', async () => {
    const state = harness();
    state.port.subscribe.mockImplementationOnce(() => { throw new Error('Initial listener setup failed'); });
    await state.controller.start();
    expect(state.controller.snapshot().error).toBe('Initial listener setup failed');
    expect(state.subscriptions).toHaveLength(0);
    await state.controller.retry();
    expect(state.port.subscribe).toHaveBeenCalledTimes(2);
    expect(state.subscriptions).toHaveLength(1);
    const remote = applyMatchOperation(state.server(), { mutationId: 'other-device-save-0003', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[0].onState(remote);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
  });

  it('replaces a terminal listener on explicit retry and persists later state from the new subscription', async () => {
    const state = harness();
    await state.controller.start();
    const failed = state.subscriptions[0];
    failed.onError(new Error('Match listener terminated'));
    expect(state.controller.snapshot().error).toBe('Match listener terminated');
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    await state.controller.retry();
    expect(state.port.subscribe).toHaveBeenCalledTimes(2);
    expect(failed.unsubscribe).toHaveBeenCalledOnce();
    const remote = applyMatchOperation(state.server(), { mutationId: 'replacement-save-00001', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[1].onState(remote);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
    expect(state.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
    expect(failed.unsubscribe).toHaveBeenCalledOnce();
  });

  it('retires a synchronous subscription error and its returned noop before explicit retry installs a live listener', async () => {
    const state = harness();
    const noop = vi.fn();
    const failedCallbacks: Array<{ onState: (state: MatchState) => void; onError: (error: Error) => void }> = [];
    state.port.subscribe.mockImplementationOnce((_uid, onState, onError) => {
      failedCallbacks.push({ onState, onError });
      onError(new Error('Sign in to restore Match on your other devices.'));
      return noop;
    });
    await state.controller.start();
    expect(state.controller.snapshot().error).toContain('Sign in to restore Match');
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    await state.controller.retry();
    expect(state.port.subscribe).toHaveBeenCalledTimes(2);
    expect(noop).toHaveBeenCalledOnce();
    const remote = applyMatchOperation(state.server(), { mutationId: 'replacement-save-00002', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[0].onState(remote);
    await settle();
    failedCallbacks[0].onError(new Error('Retired synchronous callback'));
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
    expect(noop).toHaveBeenCalledOnce();
  });

  it('ignores retired listener state and error callbacks after a replacement is active', async () => {
    const state = harness();
    await state.controller.start();
    const failed = state.subscriptions[0];
    failed.onError(new Error('First listener terminated'));
    await state.controller.retry();
    expect(state.subscriptions).toHaveLength(2);
    const remote = applyMatchOperation(state.server(), { mutationId: 'replacement-save-00003', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[1].onState(remote);
    await settle();
    const writes = state.port.saveJournal.mock.calls.length;
    const changes = state.changes.length;
    const obsolete = applyMatchOperation(remote, { mutationId: 'obsolete-listener-save', type: 'decide', ref: { ...ref, gameId: 'obsolete-game' }, summary, decision: 'saved' }, now());
    failed.onState(obsolete);
    failed.onError(new Error('Obsolete listener error'));
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.saveJournal).toHaveBeenCalledTimes(writes);
    expect(state.changes).toHaveLength(changes);
    expect(state.subscriptions[1].unsubscribe).not.toHaveBeenCalled();
    state.controller.dispose();
  });

  it('does not install a replacement while refetch fails but recovers on the next explicit successful retry', async () => {
    const state = harness();
    await state.controller.start();
    const failed = state.subscriptions[0];
    failed.onError(new Error('Listener terminated before retry'));
    state.port.fetchState.mockRejectedValueOnce(new Error('Retry fetch failed'));
    await state.controller.retry();
    expect(state.controller.snapshot().error).toBe('Retry fetch failed');
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    expect(state.subscriptions).toHaveLength(1);
    await state.controller.retry();
    expect(state.subscriptions).toHaveLength(2);
    expect(failed.unsubscribe).toHaveBeenCalledOnce();
    const remote = applyMatchOperation(state.server(), { mutationId: 'replacement-save-00004', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.subscriptions[1].onState(remote);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ error: '', state: remote });
    expect(state.journal()?.confirmed).toEqual(remote);
    expect(state.port.mutate).not.toHaveBeenCalled();
    state.controller.dispose();
  });

  it('does not resubscribe or publish a retry result after disposal during its refetch', async () => {
    const state = harness();
    await state.controller.start();
    state.subscriptions[0].onError(new Error('Listener terminated before disposal'));
    const response = deferred<MatchState>();
    state.port.fetchState.mockImplementationOnce(() => response.promise);
    const retry = state.controller.retry();
    await settle();
    state.controller.dispose();
    const writes = state.port.saveJournal.mock.calls.length;
    const changes = state.changes.length;
    const remote = applyMatchOperation(state.server(), { mutationId: 'disposed-retry-save-01', type: 'decide', ref, summary, decision: 'saved' }, now());
    response.resolve(remote);
    await retry;
    await settle();
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    expect(state.port.saveJournal).toHaveBeenCalledTimes(writes);
    expect(state.changes).toHaveLength(changes);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(state.port.mutate).not.toHaveBeenCalled();
  });

  it('keeps a terminal listener notice after an already queued journal write and independent mutation acknowledge', async () => {
    const state = harness();
    await state.controller.start();
    const remote = applyMatchOperation(state.server(), { mutationId: 'queued-listener-save-01', type: 'decide', ref, summary, decision: 'saved' }, now());
    state.setServer(remote);
    const persist = state.port.saveJournal.getMockImplementation();
    if (!persist) throw new Error('Expected the characterized journal adapter');
    const write = deferred<void>();
    state.port.saveJournal.mockImplementationOnce(async (uid, journal) => { await write.promise; await persist(uid, journal); });
    state.subscriptions[0].onState(remote);
    await settle();
    state.subscriptions[0].onError(new Error('Listener terminated during journal write'));
    expect(state.controller.snapshot().error).toBe('Listener terminated during journal write');
    write.resolve();
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ state: remote, error: 'Listener terminated during journal write' });
    expect(state.journal()?.confirmed).toEqual(remote);
    await state.controller.decide({ ...ref, gameId: 'independent-later-game' }, summary, 'saved');
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ state: state.server(), pending: false, error: 'Listener terminated during journal write' });
    expect(state.journal()?.confirmed).toEqual(state.server());
    expect(state.port.subscribe).toHaveBeenCalledOnce();
    await state.controller.retry();
    expect(state.port.subscribe).toHaveBeenCalledTimes(2);
    expect(state.controller.snapshot()).toMatchObject({ state: state.server(), error: '' });
    state.controller.dispose();
  });

  it('requires a durable local journal before showing an optimistic save', async () => {
    const state = harness();
    await state.controller.start();
    const write = deferred<void>();
    state.port.saveJournal.mockImplementationOnce(() => write.promise);
    const save = state.controller.decide(ref, summary, 'saved');
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ working: true, pending: false });
    expect(state.controller.snapshot().state.decisions).toEqual([]);
    expect(state.port.mutate).not.toHaveBeenCalled();
    write.resolve();
    await expect(save).resolves.toBe(true);
    await settle();
    expect(state.controller.snapshot().state.decisions).toHaveLength(1);
  });

  it('does not expose or send a save whose required local write failed', async () => {
    const state = harness();
    await state.controller.start();
    state.port.saveJournal.mockRejectedValueOnce(new Error('Secure storage unavailable'));
    await expect(state.controller.decide(ref, summary, 'saved')).resolves.toBe(false);
    expect(state.controller.snapshot().state.decisions).toEqual([]);
    expect(state.controller.snapshot().error).toContain('Secure storage unavailable');
    expect(state.port.mutate).not.toHaveBeenCalled();
  });

  it('deduplicates rapid same-game saves while allowing an independent next save', async () => {
    const state = harness();
    await state.controller.start();
    expect(await Promise.all([state.controller.decide(ref, summary, 'saved'), state.controller.decide(ref, summary, 'saved')])).toEqual([true, false]);
    await settle();
    await state.controller.decide({ ...ref, gameId: 'game-two' }, summary, 'saved');
    await settle();
    expect(state.controller.snapshot().state.decisions).toHaveLength(2);
    expect(state.port.mutate).toHaveBeenCalledTimes(2);
  });

  it('retries a network failure with the original persisted mutation identity', async () => {
    const state = harness();
    await state.controller.start();
    state.port.mutate.mockRejectedValueOnce(new Error('Offline'));
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    const original = state.journal()?.pending[0];
    expect(original?.type).toBe('decide');
    expect(state.controller.snapshot()).toMatchObject({ pending: true, error: 'Offline' });
    await state.controller.retry();
    expect(state.port.mutate.mock.calls[0][1]).toEqual(original);
    expect(state.port.mutate.mock.calls[1][1]).toEqual(original);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
    expect(state.server().decisions).toHaveLength(1);
  });

  it('keeps an unacknowledged delayed failure durable until explicit retry with the same mutation', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');await settle();
    const original = state.journal()?.pending[0];
    expect(original).toMatchObject({ type: 'decide', ref, decision: 'saved' });
    response.reject(new Error('Delayed offline response'));await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: true, error: 'Delayed offline response' });
    expect(state.journal()?.pending).toEqual([original]);
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([original]);
    await state.controller.retry();
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([original, original]);
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: state.server(), pending: [] });
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '', state: state.server() });
  });

  it('does not retire an acknowledgement whose blocked journal write fails', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');await settle();
    const original = state.port.mutate.mock.calls[0][1];
    const acknowledged = applyMatchOperation(createMatchState(), original, now());
    const acknowledgementWrite = deferred<void>();
    state.port.saveJournal.mockImplementationOnce(() => acknowledgementWrite.promise);
    state.setServer(acknowledged);state.push(acknowledged);await settle();
    response.reject(new Error('Response unavailable'));await settle();
    expect(state.controller.snapshot().pending).toBe(true);
    expect(state.journal()?.pending).toEqual([original]);
    expect(state.journal()?.confirmed).toEqual(createMatchState());
    acknowledgementWrite.reject(new Error('Acknowledgement storage unavailable'));await settle();
    expect(state.controller.snapshot().pending).toBe(true);
    expect(state.controller.snapshot().error).not.toBe('');
    expect(state.journal()?.pending).toEqual([original]);
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([original]);
    await state.controller.retry();
    expect(state.controller.snapshot()).toMatchObject({ state: acknowledged, pending: false, error: '' });
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: acknowledged, pending: [] });
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([original]);
  });

  it('does not publish or write a delayed mutation failure after disposal', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');await settle();
    const journal = structuredClone(state.journal());
    state.controller.dispose();
    const changes = state.changes.length, writes = state.port.saveJournal.mock.calls.length;
    response.reject(new Error('Disposed response failed'));await settle();
    expect(state.changes).toHaveLength(changes);
    expect(state.port.saveJournal).toHaveBeenCalledTimes(writes);
    expect(state.journal()).toEqual(journal);
    expect(state.unsubscribe).toHaveBeenCalledOnce();
  });

  it('replays a durable offline operation after restart without losing another device save', async () => {
    const pending: MatchOperation = { mutationId: 'pending-mutation-0001', type: 'decide', ref, summary, decision: 'saved' };
    const remote = applyMatchOperation(createMatchState(), { ...pending, mutationId: 'remote-mutation-00001', ref: { ...ref, gameId: 'remote-game' } }, now());
    const state = harness(remote, { uid: 'uid-one', confirmed: createMatchState(), pending: [pending] });
    await state.controller.start();
    expect(state.port.mutate).toHaveBeenCalledExactlyOnceWith('uid-one', pending);
    expect(state.controller.snapshot().state.decisions.map((item) => item.ref.gameId).sort()).toEqual(['game-one', 'remote-game']);
  });

  it('keeps a newer listener acknowledgement when the delayed HTTP response arrives later', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    const operation = state.port.mutate.mock.calls[0][1];
    const acknowledgement = applyMatchOperation(createMatchState(), operation, now());
    const newer = applyMatchOperation(acknowledgement, { mutationId: 'other-device-mutation1', type: 'decide', ref: { ...ref, gameId: 'other-game' }, summary, decision: 'saved' }, now());
    state.push(newer);
    await settle();
    expect(state.controller.snapshot().pending).toBe(false);
    response.resolve(acknowledgement);
    await settle();
    expect(state.controller.snapshot().state).toEqual(newer);
    expect(state.journal()?.confirmed).toEqual(newer);
  });

  it.each([undefined, 400, 409, 413])('ignores a delayed HTTP failure with status %s after its mutation was durably acknowledged', async (status) => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');await settle();
    const operation = state.port.mutate.mock.calls[0][1];
    const acknowledged = applyMatchOperation(createMatchState(), operation, now());
    state.setServer(acknowledged);state.push(acknowledged);await settle();
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: acknowledged, pending: [] });
    response.reject(Object.assign(new Error('Obsolete delayed response'), { status }));await settle();
    expect(state.controller.snapshot()).toMatchObject({ state: acknowledged, pending: false, error: '' });
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: acknowledged, pending: [] });
    expect(state.port.fetchState).toHaveBeenCalledOnce();
    expect(state.port.mutate).toHaveBeenCalledExactlyOnceWith('uid-one', operation);
  });

  it('drains the next durable Save automatically when the acknowledged first Save response fails late', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');await settle();
    const first = state.port.mutate.mock.calls[0][1];
    const acknowledged = applyMatchOperation(createMatchState(), first, now());
    state.setServer(acknowledged);state.push(acknowledged);await settle();
    const secondRef = { ...ref, gameId: 'second-game' };
    await expect(state.controller.decide(secondRef, summary, 'saved')).resolves.toBe(true);await settle();
    const second = state.journal()?.pending[0];
    if (!second) throw new Error('Missing durable second Save');
    expect(second).toMatchObject({ type: 'decide', ref: secondRef, decision: 'saved' });
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first]);
    response.reject(new Error('Already acknowledged response timed out'));await settle();
    const expected = applyMatchOperation(acknowledged, second, now());
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first, second]);
    expect(state.server()).toEqual(expected);
    expect(state.controller.snapshot()).toMatchObject({ state: expected, pending: false, error: '' });
    expect(state.journal()).toEqual({ uid: 'uid-one', confirmed: expected, pending: [] });
    expect(state.port.fetchState).toHaveBeenCalledOnce();
  });

  it('reconciles a cross-device undo conflict instead of overwriting the other device', async () => {
    const state = harness();
    await state.controller.start();
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    const newer = applyMatchOperation(state.server(), { mutationId: 'other-device-mutation1', type: 'decide', ref, summary, decision: 'passed' }, now());
    state.setServer(newer);
    state.port.mutate.mockRejectedValueOnce(Object.assign(new Error('Undo changed on another device'), { status: 409 }));
    await state.controller.undo();
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: 'Undo changed on another device', state: newer });
    expect(state.journal()?.pending).toEqual([]);
  });

  it('retires delayed acknowledgements and listener results after dispose', async () => {
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    const acknowledged = applyMatchOperation(createMatchState(), state.port.mutate.mock.calls[0][1], now());
    state.controller.dispose();
    const writeCount = state.port.saveJournal.mock.calls.length;
    const changeCount = state.changes.length;
    state.push(acknowledged);
    response.resolve(acknowledged);
    await settle();
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    expect(state.port.saveJournal).toHaveBeenCalledTimes(writeCount);
    expect(state.changes).toHaveLength(changeCount);
  });

  it('keeps a newer listener state when a conflict refetch returns an older revision', async () => {
    const state = harness();
    await state.controller.start();
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    const stale = applyMatchOperation(state.server(), { mutationId: 'remote-conflict-000001', type: 'decide', ref, summary, decision: 'passed' }, now());
    const refetch = deferred<MatchState>();
    state.port.fetchState.mockImplementationOnce(() => refetch.promise);
    state.port.mutate.mockRejectedValueOnce(Object.assign(new Error('Swipe changed on another device'), { status: 409 }));
    await state.controller.undo();
    await settle();
    await state.controller.decide({ ...ref, gameId: 'second-game' }, summary, 'saved');
    await settle();
    const pendingSave = state.journal()?.pending.find((operation) => operation.type === 'decide');
    if (!pendingSave) throw new Error('Missing durable second save');
    const newer = applyMatchOperation(stale, pendingSave, now());
    state.push(newer);
    await settle();
    refetch.resolve(stale);
    await settle();
    expect(state.controller.snapshot().state).toEqual(newer);
    expect(state.controller.snapshot().pending).toBe(false);
    expect(state.journal()?.confirmed).toEqual(newer);
    expect(state.journal()?.pending).toEqual([]);
    expect(state.port.mutate).toHaveBeenCalledTimes(2);
  });

  it('does not let failed analytics prevent the next durable save', async () => {
    const state = harness();
    await state.controller.start();
    state.port.mutate.mockRejectedValueOnce(new Error('Analytics unavailable'));
    await state.controller.recordEvent({ kind: 'opened' });
    await settle();
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
    expect(state.server().decisions).toHaveLength(1);
    expect(state.port.mutate.mock.calls.map((call) => call[1].type)).toEqual(['event', 'decide']);
  });

  it('does not make a failed local telemetry write visible or prevent a later successful save', async () => {
    const state = harness();
    await state.controller.start();
    state.port.saveJournal.mockRejectedValueOnce(new Error('Telemetry journal write failed'));
    await expect(state.controller.recordEvent({ kind: 'opened' })).resolves.toBe(false);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
    expect(state.port.mutate).not.toHaveBeenCalled();
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    expect(state.server().decisions).toHaveLength(1);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
  });

  it('clears an obsolete network error after a durable server listener acknowledgement', async () => {
    const state = harness();
    await state.controller.start();
    state.port.mutate.mockRejectedValueOnce(new Error('Offline'));
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: true, error: 'Offline' });
    const acknowledged = applyMatchOperation(createMatchState(), state.port.mutate.mock.calls[0][1], now());
    state.push(acknowledged);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ state: acknowledged, pending: false, error: '' });
  });

  it('writes preferences without deleting saved games and supports an owned remove', async () => {
    const state = harness();
    await state.controller.start();
    await state.controller.decide(ref, summary, 'saved');
    await settle();
    await state.controller.preferences({ ...defaultMatchPreferences, maxDistanceMiles: 20 });
    await settle();
    expect(state.controller.snapshot().state.preferences.maxDistanceMiles).toBe(20);
    expect(state.controller.snapshot().state.decisions).toHaveLength(1);
    await state.controller.remove(state.controller.snapshot().state.decisions[0]);
    await settle();
    expect(state.controller.snapshot().state.decisions).toEqual([]);
  });

  it('rejects a single stale preference edit while retaining another device preferences', async () => {
    const original = createMatchState();
    const stale: MatchOperation = { mutationId: 'local-preferences-0001', type: 'preferences', basePreferencesRevision: 0,
      preferences: { ...defaultMatchPreferences, maxDistanceMiles: 20 } };
    const remote = applyMatchOperation(original, { mutationId: 'remote-preferences-01', type: 'preferences', basePreferencesRevision: 0,
      preferences: { ...defaultMatchPreferences, favoriteClubIds: ['remote-venue'] } }, now());
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: [stale] });
    await state.controller.start();
    expect(state.server()).toEqual(remote);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, state: remote, error: expect.stringContaining('changed on another device') });
    expect(state.journal()?.pending).toEqual([]);
    expect(state.port.mutate).toHaveBeenCalledExactlyOnceWith('uid-one', stale);
  });

  it('journals two offline preference edits with sequential bases and syncs them in order without a foreign edit', async () => {
    const state = harness();
    await state.controller.start();
    state.port.mutate.mockRejectedValue(new Error('Offline'));
    const first = { ...defaultMatchPreferences, maxDistanceMiles: 20 };
    const second = { ...first, maxWaitlist: 3 };
    await expect(state.controller.preferences(first)).resolves.toBe(true);
    await settle();
    await expect(state.controller.preferences(second)).resolves.toBe(true);
    await settle();
    const queued = structuredClone(state.journal()?.pending ?? []);
    expect(queued.map(operation => operation.type === 'preferences' ? operation.basePreferencesRevision : null)).toEqual([0, 1]);
    expect(state.controller.snapshot()).toMatchObject({ pending: true, state: { preferences: second, preferencesRevision: 2 } });
    state.port.mutate.mockImplementation(async (_uid, operation) => {
      const next = applyMatchOperation(state.server(), operation, now());
      state.setServer(next);
      return next;
    });
    state.port.mutate.mockClear();
    await state.controller.retry();
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual(queued);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '', state: { preferences: second, preferencesRevision: 2 } });
    expect(state.journal()?.pending).toEqual([]);
  });

  it('keeps independent save undo remove and event operations after a rejected preference edit', async () => {
    const existingSave: MatchOperation = { mutationId: 'existing-save-0000001', type: 'decide', ref, summary, decision: 'saved' };
    const original = applyMatchOperation(createMatchState(), existingSave, now());
    const remote = applyMatchOperation(original, { mutationId: 'remote-preferences-01', type: 'preferences', basePreferencesRevision: 0,
      preferences: { ...defaultMatchPreferences, favoriteClubIds: ['remote-venue'] } }, now());
    const queued: MatchOperation[] = [
      { mutationId: 'local-preferences-0001', type: 'preferences', basePreferencesRevision: 0, preferences: { ...defaultMatchPreferences, maxDistanceMiles: 20 } },
      { mutationId: 'independent-save-001', type: 'decide', ref: { ...ref, gameId: 'other-game' }, summary, decision: 'saved' },
      { mutationId: 'independent-undo-001', type: 'undo', targetMutationId: 'independent-save-001' },
      { mutationId: 'independent-remove-1', type: 'remove', ref, expectedDecisionMutationId: existingSave.mutationId },
      { mutationId: 'independent-event-01', type: 'event', event: { kind: 'opened' } }
    ];
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: queued });
    await state.controller.start();
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual(queued);
    expect(state.server().preferences).toEqual(remote.preferences);
    expect(state.server().preferencesRevision).toBe(1);
    expect(state.server().decisions).toEqual([]);
    expect(state.server().recentMutationIds).toEqual([...remote.recentMutationIds, ...queued.slice(1).map(operation => operation.mutationId)]);
    expect(state.server().events.slice(-3).map(event => event.kind)).toEqual(['saved', 'undo', 'opened']);
    expect(state.controller.snapshot().pending).toBe(false);
    expect(state.journal()?.pending).toEqual([]);
  });

  it('does not replay a dependent preference snapshot over a foreign revision with the same number', async () => {
    const { original, first, second, remote } = conflictingPreferenceChain();
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: [first, second] });
    await state.controller.start();
    expect(state.server()).toEqual(remote);
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first]);
    expect(state.journal()?.pending).toEqual([]);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, state: remote, error: expect.stringContaining('changed on another device') });
  });

  it('refuses a new preference snapshot after a foreign listener invalidates an unresolved local chain', async () => {
    const { first, second, remote } = conflictingPreferenceChain();
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.preferences(first.preferences);
    await settle();
    await state.controller.preferences(second.preferences);
    await settle();
    state.setServer(remote);state.push(remote);
    await settle();
    expect(state.controller.snapshot().state.preferences).toEqual(remote.preferences);
    expect(state.controller.snapshot().state.preferencesRevision).toBe(1);
    const before = structuredClone(state.journal()?.pending);
    try {
      await expect(state.controller.preferences({ ...second.preferences, requireSeatsNow: true })).resolves.toBe(false);
      expect(state.journal()?.pending).toEqual(before);
      expect(state.controller.snapshot().error).toContain('changed on another device');
    } finally { state.controller.dispose();response.resolve(remote);await settle(); }
  });

  it('keeps preference conflict feedback after independent saves events and listener acknowledgements', async () => {
    const { original, first, remote } = conflictingPreferenceChain();
    const save: MatchOperation = { mutationId: 'independent-save-001', type: 'decide', ref, summary, decision: 'saved' };
    const event: MatchOperation = { mutationId: 'independent-event-01', type: 'event', event: { kind: 'opened' } };
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: [first, save, event] });
    await state.controller.start();
    expect(state.server().preferences).toEqual(remote.preferences);
    expect(state.server().decisions).toHaveLength(1);
    expect(state.server().events.at(-1)?.kind).toBe('opened');
    expect(state.controller.snapshot().error).toContain('changed on another device');
    state.push(state.server());await settle();
    expect(state.controller.snapshot().error).toContain('changed on another device');
    const durableSave = state.port.saveJournal.getMockImplementation();
    if (!durableSave) throw new Error('Missing journal writer');
    state.port.saveJournal.mockRejectedValueOnce(new Error('Secure storage unavailable'));
    await expect(state.controller.preferences({ ...remote.preferences, maxDistanceMiles: 30 })).resolves.toBe(false);
    expect(state.controller.snapshot().error).toContain('Secure storage unavailable');
    state.push(state.server());await settle();
    expect(state.controller.snapshot().error).toContain('changed on another device');
    state.port.saveJournal.mockImplementation(durableSave);
    await expect(state.controller.preferences({ ...remote.preferences, maxDistanceMiles: 30 })).resolves.toBe(true);
    await settle();
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
  });

  it('keeps an unresolved preference chain durable when conflict retirement fails and retries without overwriting remote preferences', async () => {
    const { original, first, second, remote } = conflictingPreferenceChain();
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: [first, second] });
    const durableSave = state.port.saveJournal.getMockImplementation();
    if (!durableSave) throw new Error('Missing journal writer');
    let rejectRetirement = true;
    state.port.saveJournal.mockImplementation(async (uid, journal) => {
      if (rejectRetirement && !journal.pending.some(operation => operation.mutationId === first.mutationId)) throw new Error('Retirement journal write failed');
      await durableSave(uid, journal);
    });
    await state.controller.start();
    expect(state.journal()?.pending).toEqual([first, second]);
    expect(state.controller.snapshot()).toMatchObject({ pending: true, error: expect.stringContaining('Retirement journal write failed') });
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first]);
    rejectRetirement = false;
    await state.controller.retry();
    expect(state.server()).toEqual(remote);
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first, first]);
    expect(state.journal()?.pending).toEqual([]);
    expect(state.controller.snapshot().error).toContain('changed on another device');
  });

  it('retires uncertain preference descendants without regressing a newer listener or resending acknowledged independent siblings', async () => {
    const { original, first, second, remote } = conflictingPreferenceChain();
    const save: MatchOperation = { mutationId: 'independent-save-001', type: 'decide', ref, summary, decision: 'saved' };
    const event: MatchOperation = { mutationId: 'independent-event-01', type: 'event', event: { kind: 'opened' } };
    const state = harness(remote, { uid: 'uid-one', confirmed: original, pending: [first, save, second, event] });
    const refetch = deferred<MatchState>();
    state.port.fetchState.mockResolvedValueOnce(remote).mockImplementationOnce(() => refetch.promise);
    const starting = state.controller.start();
    await settle();
    const newer = applyMatchOperation(applyMatchOperation(remote, save, now()), event, now());
    state.setServer(newer);state.push(newer);
    await settle();refetch.resolve(remote);
    await starting;
    expect(state.server()).toEqual(newer);
    expect(state.controller.snapshot().state).toEqual(newer);
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([first]);
    expect(state.journal()?.pending).toEqual([]);
    expect(state.journal()?.confirmed).toEqual(newer);
    expect(state.controller.snapshot().error).toContain('changed on another device');
  });

  it('does not retire a fresh preference edit after the rejected in-flight parent was already acknowledged by a listener', async () => {
    const { first, second } = conflictingPreferenceChain();
    const state = harness();
    await state.controller.start();
    const response = deferred<MatchState>();
    state.port.mutate.mockImplementationOnce(() => response.promise);
    await state.controller.preferences(first.preferences);await settle();
    await state.controller.preferences(second.preferences);await settle();
    const queued = state.journal()?.pending ?? [];
    const acknowledged = queued.reduce((value, operation) => applyMatchOperation(value, operation, now()), createMatchState());
    state.setServer(acknowledged);state.push(acknowledged);await settle();
    await expect(state.controller.preferences({ ...second.preferences, requireSeatsNow: true })).resolves.toBe(true);
    await settle();
    const fresh = state.journal()?.pending[0];
    expect(fresh).toMatchObject({ type: 'preferences', basePreferencesRevision: 2 });
    response.reject(Object.assign(new Error('Delayed preference conflict'), { status: 409 }));
    await settle();
    expect(state.server().preferences).toMatchObject({ ...second.preferences, requireSeatsNow: true });
    expect(state.port.mutate.mock.calls.map(call => call[1])).toEqual([queued[0], fresh]);
    expect(state.journal()?.pending).toEqual([]);
    expect(state.controller.snapshot()).toMatchObject({ pending: false, error: '' });
    expect(state.port.fetchState).toHaveBeenCalledOnce();
  });

  it('refuses a foreign or malformed journal before fetching or mutating remote data', async () => {
    const state = harness(createMatchState(), { uid: 'uid-other', confirmed: createMatchState(), pending: [] });
    await state.controller.start();
    expect(state.controller.snapshot()).toMatchObject({ ready: false, error: 'Saved Match data is invalid. Retry secure storage.' });
    expect(state.port.fetchState).not.toHaveBeenCalled();
    expect(state.port.mutate).not.toHaveBeenCalled();
  });
});
