import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAppState } from '../../app/playerPlatform';
import type { PlayerClubSnapshot, PlayerTournament } from '../../domain/playerSync';
import type { fetchPublicPlayerDiscovery, fetchRemotePlayerDiscovery } from '../api/playerHttpApi';
import type { FirebasePlayerIdentity } from '../firebase/playerAuth';
import { bindPlayerPollingLifecycle } from '../../application/playerSubscriptionLifecycle';
import { subscribeToAllClubSnapshots, type ClubSnapshotSubscriptionResult } from './clubSnapshotSubscription';
import { subscribeToPlayerTournaments, type fetchPlayerTournaments } from '../firebase/playerTournamentRepository';

type Page = Awaited<ReturnType<typeof fetchPublicPlayerDiscovery>>;
type TournamentResult = Awaited<ReturnType<typeof fetchPlayerTournaments>>;
type SubscriptionKind = 'clubs' | 'tournaments';
const kinds = ['clubs', 'tournaments'] as const;
const transport = vi.hoisted(() => {
  let identity: FirebasePlayerIdentity | null = null;
  return {
    publicDiscovery: vi.fn<typeof fetchPublicPlayerDiscovery>(),
    privateDiscovery: vi.fn<typeof fetchRemotePlayerDiscovery>(),
    auth: { get currentUser() { return identity; } },
    identity: vi.fn(() => identity),
    setIdentity(value: FirebasePlayerIdentity | null) { identity = value; }
  };
});
vi.mock('../api/playerHttpApi', () => ({
  fetchPublicPlayerDiscovery: transport.publicDiscovery,
  fetchRemotePlayerDiscovery: transport.privateDiscovery,
  submitRemoteTournamentMutation: vi.fn(),
  submitRemoteTournamentRegistration: vi.fn()
}));
vi.mock('../firebase/firebaseClient', () => ({ auth: transport.auth, db: {} }));
vi.mock('../firebase/playerAuth', () => ({ getCurrentFirebasePlayer: transport.identity, ensureSignedInIdentity: vi.fn() }));
vi.mock('../api/localPlayerApi', () => ({ fetchLocalClubSnapshot: vi.fn(() => { throw new Error('Unexpected local API fallback.'); }) }));

function page(label: string): Page {
  const club: PlayerClubSnapshot = {
    club: { id: 'synthetic-club', name: label }, games: [], memberships: [], waitlists: [], notifications: [],
    social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 }, generatedAt: '2026-10-29T00:00:00.000Z'
  };
  const tournament: PlayerTournament = {
    id: 'synthetic-event', clubId: club.club.id, name: label, startsAt: '2030-01-01T00:00:00.000Z',
    interestOpensAt: '2026-01-01T00:00:00.000Z', interestClosesAt: '2029-12-31T23:00:00.000Z',
    interestStatus: 'open', buyIn: 0, rebuysAllowed: false, addOnsAllowed: false, rules: [], withdrawalAllowed: true
  };
  return { ok: true, clubs: [club], tournaments: [tournament], interests: [], page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: undefined } };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred fixture was not initialized.'); };
  let reject: (error: unknown) => void = () => { throw new Error('Deferred fixture was not initialized.'); };
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

function platform(initial: PlayerAppState | null = 'active') {
  let listener: ((state: PlayerAppState) => void) | undefined;
  return {
    getCurrentAppState: () => initial,
    subscribeToAppState(value: (state: PlayerAppState) => void) { listener = value; return () => { listener = undefined; }; },
    emit(state: PlayerAppState) { listener?.(state); }
  };
}

const retire: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T00:00:00.000Z'));
  vi.resetAllMocks();
  transport.setIdentity(null);
  transport.publicDiscovery.mockRejectedValue(new Error('Unexpected synthetic public request.'));
  transport.privateDiscovery.mockRejectedValue(new Error('Unexpected synthetic private request.'));
});
afterEach(() => {
  retire.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(kind: SubscriptionKind, options: { initial?: PlayerAppState; playerId?: string } = {}) {
  const deliver = vi.fn<(result: ClubSnapshotSubscriptionResult | TournamentResult) => void>();
  const fail = vi.fn<(error: Error) => void>();
  const subscription = kind === 'clubs'
    ? subscribeToAllClubSnapshots({ id: options.playerId ?? 'synthetic-player', name: 'Synthetic Player' }, deliver)
    : subscribeToPlayerTournaments(options.playerId, deliver, fail);
  const refreshSpy = vi.spyOn(subscription, 'refresh');
  const lifecycle = platform(options.initial);
  const cleanup = bindPlayerPollingLifecycle(lifecycle, subscription);
  const initialRefresh = refreshSpy.mock.results[0];
  if (initialRefresh?.type !== 'return') throw new Error('The lifecycle did not start its initial refresh.');
  retire.push(cleanup);
  return { subscription, lifecycle, deliver, fail, cleanup, initialTask: initialRefresh.value };
}

function publishedLabels(current: ReturnType<typeof harness>) {
  return current.deliver.mock.calls.flatMap(([result]) => {
    if ('tournaments' in result) return result.tournaments.map((event) => event.name);
    return result.ok ? result.clubs.map((club) => club.club.name) : [];
  });
}

describe('actual Player repository and polling lifecycle characterization', () => {
  it.each(kinds)('settles a handled %s read failure and recovers on the next explicit refresh', async (kind) => {
    transport.publicDiscovery.mockRejectedValueOnce(new Error('Synthetic read failure')).mockResolvedValueOnce(page('recovered'));
    const current = harness(kind);
    await expect(current.initialTask).resolves.toBeUndefined();
    if (kind === 'clubs') {
      expect(current.deliver).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'Synthetic read failure' });
      expect(current.fail).not.toHaveBeenCalled();
    } else {
      expect(current.deliver).not.toHaveBeenCalled();
      expect(current.fail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Synthetic read failure' }));
    }
    await expect(current.subscription.refresh()).resolves.toBeUndefined();
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(current.deliver).toHaveBeenCalled();
  });

  it.each(kinds)('returns one immediately-started %s task for overlapping explicit callers', async (kind) => {
    const pending = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(pending.promise);
    const current = harness(kind);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    const tasks = Array.from({ length: 1_000 }, () => current.subscription.refresh());
    expect(new Set(tasks)).toEqual(new Set([current.initialTask]));
    current.subscription.stopPolling();
    pending.resolve(page('published'));
    await current.initialTask;
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(current.deliver).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(kinds)('routes a throwing %s success callback through its existing error callback path', async (kind) => {
    transport.publicDiscovery.mockResolvedValueOnce(page('published'));
    const current = harness(kind);
    const failure = new Error('Synthetic success callback failed');
    current.deliver.mockImplementationOnce(() => { throw failure; });
    await expect(current.initialTask).resolves.toBeUndefined();
    if (kind === 'clubs') {
      expect(current.deliver).toHaveBeenCalledTimes(2);
      expect(current.deliver.mock.calls[1][0]).toMatchObject({ ok: false, error: failure.message, stale: true });
      expect(current.fail).not.toHaveBeenCalled();
    } else {
      expect(current.deliver).toHaveBeenCalledOnce();
      expect(current.fail).toHaveBeenCalledExactlyOnceWith(failure);
    }
  });

  it.each(kinds)('rejects a throwing %s error callback, releases ownership, and permits recovery', async (kind) => {
    transport.publicDiscovery.mockRejectedValueOnce(new Error('Synthetic read failure')).mockResolvedValueOnce(page('recovered'));
    const current = harness(kind);
    const failure = new Error('Synthetic error callback failed');
    (kind === 'clubs' ? current.deliver : current.fail).mockImplementation(() => { throw failure; });
    await expect(current.initialTask).rejects.toBe(failure);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    current.deliver.mockReset();
    current.fail.mockReset();
    await expect(current.subscription.refresh()).resolves.toBeUndefined();
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(current.deliver).toHaveBeenCalledOnce();
  });

  it.each(kinds)('coalesces %s interval ticks and retires late results, callbacks and timers', async (kind) => {
    const pending = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(pending.promise);
    const current = harness(kind);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    current.cleanup();
    pending.resolve(page('retired'));
    await current.initialTask;
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(current.subscription.refresh()).resolves.toBeUndefined();
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(current.deliver).not.toHaveBeenCalled();
    expect(current.fail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(kinds)('still starts one eager %s read in the background while leaving polling stopped', async (kind) => {
    transport.publicDiscovery.mockResolvedValueOnce(page('background'));
    const current = harness(kind, { initial: 'background' });
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    await current.initialTask;
    expect(current.deliver).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('explicit Player refresh invalidations', () => {
  it.each(kinds)('refreshes %s after a foreground return during an older read and waits for the trailing result', async (kind) => {
    const first = deferred<Page>(), second = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const current = harness(kind);
    let completed = false;
    void current.initialTask.then(() => { completed = true; });
    current.lifecycle.emit('background');
    await vi.advanceTimersByTimeAsync(30_000);
    current.lifecycle.emit('active');
    first.resolve(page('old'));
    await vi.advanceTimersByTimeAsync(0);

    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(publishedLabels(current)).toEqual(['old']);
    expect(completed).toBe(false);
    second.resolve(page('fresh'));
    await current.initialTask;
    expect(publishedLabels(current)).toEqual(['old', 'fresh']);
    expect(completed).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
  });

  it.each(kinds)('coalesces 1000 explicit %s invalidations into one trailing read with one active request', async (kind) => {
    const pending = [deferred<Page>(), deferred<Page>()];
    const reads = [...pending];
    let active = 0, maximumActive = 0;
    transport.publicDiscovery.mockImplementation(() => {
      const next = reads.shift();
      if (!next) throw new Error('Unexpected extra synthetic request.');
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return next.promise.finally(() => { active -= 1; });
    });
    const current = harness(kind);
    const tasks = Array.from({ length: 1_000 }, () => current.subscription.refresh());
    expect(new Set(tasks)).toEqual(new Set([current.initialTask]));
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    pending[0].resolve(page('old'));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(publishedLabels(current)).toEqual(['old']);
    pending[1].resolve(page('fresh'));
    await current.initialTask;
    expect(publishedLabels(current)).toEqual(['old', 'fresh']);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
  });

  it.each(kinds)('remembers another %s invalidation during the trailing read without overlapping it', async (kind) => {
    const pending = [deferred<Page>(), deferred<Page>(), deferred<Page>()];
    pending.forEach((read) => transport.publicDiscovery.mockReturnValueOnce(read.promise));
    const current = harness(kind);
    void current.subscription.refresh();
    pending[0].resolve(page('one'));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(current.subscription.refresh()).toBe(current.initialTask);
    pending[1].resolve(page('two'));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(3);
    expect(publishedLabels(current)).toEqual(['one', 'two']);
    pending[2].resolve(page('three'));
    await current.initialTask;
    expect(publishedLabels(current)).toEqual(['one', 'two', 'three']);
  });

  it.each(kinds)('does not turn overlapping %s timer ticks into a trailing read', async (kind) => {
    const pending = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(pending.promise);
    const current = harness(kind);
    await vi.advanceTimersByTimeAsync(180_000);
    pending.resolve(page('published'));
    await current.initialTask;
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(publishedLabels(current)).toEqual(['published']);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(kinds)('clears pending %s foreground work when the app returns to the background', async (kind) => {
    const pending = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(pending.promise);
    const current = harness(kind);
    current.lifecycle.emit('background');
    current.lifecycle.emit('active');
    current.lifecycle.emit('background');
    pending.resolve(page('published'));
    await current.initialTask;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(publishedLabels(current)).toEqual(['published']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(kinds)('preserves %s account replacement while retiring the old pending refresh', async (kind) => {
    const first = deferred<Page>();
    const identity = (uid: string): FirebasePlayerIdentity => ({ uid, email: 'fixture@example.invalid', name: 'Synthetic Player', provider: 'email', verified: true });
    transport.setIdentity(identity('owner-a'));
    transport.privateDiscovery.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page('owner-b'));
    const previous = harness(kind, { playerId: 'owner-a' });
    void previous.subscription.refresh();
    previous.cleanup();
    transport.setIdentity(identity('owner-b'));
    const current = harness(kind, { playerId: 'owner-b' });
    await current.initialTask;
    first.resolve(page('owner-a'));
    await previous.initialTask;
    await vi.advanceTimersByTimeAsync(0);

    expect(transport.privateDiscovery.mock.calls.map((call) => call[2])).toEqual(['owner-a', 'owner-b']);
    expect(transport.publicDiscovery).not.toHaveBeenCalled();
    expect(previous.deliver).not.toHaveBeenCalled();
    expect(previous.fail).not.toHaveBeenCalled();
    expect(publishedLabels(current)).toEqual(['owner-b']);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(kinds)('keeps a %s notification queued from the final response callback', async (kind) => {
    transport.publicDiscovery.mockResolvedValueOnce(page('one')).mockResolvedValueOnce(page('two'));
    const current = harness(kind);
    current.deliver.mockImplementationOnce(() => {
      queueMicrotask(() => { void current.subscription.refresh(); });
    });
    await current.initialTask;
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(publishedLabels(current)).toEqual(['one', 'two']);
  });

  it.each(kinds)('delivers intermediate %s results under continuous explicit invalidations', async (kind) => {
    ['one', 'two', 'three', 'four'].forEach((label) => transport.publicDiscovery.mockResolvedValueOnce(page(label)));
    const current = harness(kind);
    current.deliver.mockImplementation(() => {
      if (current.deliver.mock.calls.length < 4) void current.subscription.refresh();
    });
    await current.initialTask;
    expect(publishedLabels(current)).toEqual(['one', 'two', 'three', 'four']);
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(4);
  });

  it.each(kinds)('drains pending %s work after a handled read failure', async (kind) => {
    const first = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page('recovered'));
    const current = harness(kind);
    void current.subscription.refresh();
    first.reject(new Error('Synthetic failed initial read'));
    await expect(current.initialTask).resolves.toBeUndefined();
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(publishedLabels(current)).toEqual(['recovered']);
  });

  it.each(kinds)('rejects a throwing %s error callback without replaying pending work and can recover later', async (kind) => {
    const first = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(first.promise).mockResolvedValueOnce(page('recovered'));
    const current = harness(kind);
    const failure = new Error('Synthetic error callback failed');
    (kind === 'clubs' ? current.deliver : current.fail).mockImplementation(() => { throw failure; });
    void current.subscription.refresh();
    const outcome = current.initialTask.catch((error: unknown) => error);
    first.reject(new Error('Synthetic failed initial read'));
    expect(await outcome).toBe(failure);
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    current.deliver.mockReset();
    current.fail.mockReset();
    await current.subscription.refresh();
    expect(transport.publicDiscovery).toHaveBeenCalledTimes(2);
    expect(publishedLabels(current)).toEqual(['recovered']);
  });

  it.each(kinds)('does not restart a retired %s polling timer through a stale subscription handle', async (kind) => {
    const pending = deferred<Page>();
    transport.publicDiscovery.mockReturnValueOnce(pending.promise);
    const current = harness(kind);
    void current.subscription.refresh();
    current.cleanup();
    current.subscription.startPolling();
    pending.resolve(page('retired'));
    await current.initialTask;
    await current.subscription.refresh();
    expect(transport.publicDiscovery).toHaveBeenCalledOnce();
    expect(current.deliver).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
