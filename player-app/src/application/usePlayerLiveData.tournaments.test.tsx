/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAppState, PlayerPlatform } from '../app/playerPlatform';
import type { fetchPlayerTournaments, subscribeToAllClubSnapshots, subscribeToPlayerTournaments } from '../data/orbitSyncApi';
import type { PlayerAccount, PlayerClubSnapshot, PlayerTournament, PlayerTournamentInterest } from '../domain/playerSync';
import { usePlayerLiveData } from './usePlayerLiveData';

type TournamentResult = Awaited<ReturnType<typeof fetchPlayerTournaments>>;
type PollingSubscription = ReturnType<typeof subscribeToPlayerTournaments>;
type TournamentStream = PollingSubscription & {
  playerId: string | undefined;
  deliver: Parameters<typeof subscribeToPlayerTournaments>[1];
  fail: NonNullable<Parameters<typeof subscribeToPlayerTournaments>[2]>;
};
type ClubStream = PollingSubscription & { deliver: Parameters<typeof subscribeToAllClubSnapshots>[1] };

const ports = vi.hoisted(() => {
  const tournaments: TournamentStream[] = [];
  const clubs: ClubStream[] = [];
  const subscription = () => ({ refresh: vi.fn<PollingSubscription['refresh']>().mockResolvedValue(undefined),
    startPolling: vi.fn<PollingSubscription['startPolling']>(), stopPolling: vi.fn<PollingSubscription['stopPolling']>(),
    unsubscribe: vi.fn<PollingSubscription['unsubscribe']>() });
  return {
    tournaments, clubs, session: { uid: 'owner-a' },
    subscribeTournaments: vi.fn<typeof subscribeToPlayerTournaments>((playerId, deliver, fail = () => undefined) => {
      const stream = { ...subscription(), playerId, deliver, fail }; tournaments.push(stream); return stream;
    }),
    subscribeClubs: vi.fn<typeof subscribeToAllClubSnapshots>((_player, deliver) => {
      const stream = { ...subscription(), deliver }; clubs.push(stream); return stream;
    }),
    fetchProfile: vi.fn(), createProfile: vi.fn(), completeDeclaration: vi.fn(), saveProfile: vi.fn(),
    loadPending: vi.fn(), savePending: vi.fn(), clearPending: vi.fn()
  };
});

vi.mock('../data/orbitSyncApi', () => ({
  completePlayerAdultDeclarationIfMissing: ports.completeDeclaration,
  createPlayerProfileIfMissing: ports.createProfile,
  fetchPlayerProfile: ports.fetchProfile,
  getCurrentFirebasePlayer: () => ports.session,
  isSyncConfigured: () => true,
  savePlayerProfile: ports.saveProfile,
  subscribeToAllClubSnapshots: ports.subscribeClubs,
  subscribeToPlayerTournaments: ports.subscribeTournaments
}));
vi.mock('../data/storage/playerStorage', () => ({ playerStorage: {
  loadPendingPlayerProfile: ports.loadPending, savePendingPlayerProfile: ports.savePending, clearPendingPlayerProfile: ports.clearPending
} }));
vi.mock('../security/secureIdentifier', () => ({ createSecureUuid: () => 'local-test-mutation' }));

const player: PlayerAccount = { id: 'owner-a', name: 'Fictional Owner A', email: 'owner-a@example.test', preferredGameIds: [] };
const club: PlayerClubSnapshot = { club: { id: 'fixture-club', name: 'Fictional Venue' }, games: [], memberships: [], waitlists: [],
  notifications: [], generatedAt: '2026-10-14T00:00:00.000Z' };
const tournament: PlayerTournament = { id: 'fixture-event', clubId: club.club.id, name: 'Fictional NLH Event',
  startsAt: '2030-01-01T18:00:00.000Z', interestOpensAt: '2026-01-01T00:00:00.000Z', interestClosesAt: '2030-01-01T17:00:00.000Z',
  interestStatus: 'open', buyIn: 50, rebuysAllowed: false, addOnsAllowed: false, rules: [], withdrawalAllowed: true };
const interest: PlayerTournamentInterest = { id: 'fixture-interest', clubId: club.club.id, tournamentId: tournament.id,
  playerId: player.id, status: 'interested', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' };
const result = (hasMore = false): TournamentResult => ({ tournaments: [tournament], interests: [interest],
  page: { count: 1, hasMore, nextCursor: hasMore ? 'fixture-next' : null, databaseQueries: undefined } });
type Options = Parameters<typeof usePlayerLiveData>[0];
type Inputs = Pick<Options, 'accountLoaded' | 'hasAccount' | 'firebaseIdentity' | 'player' | 'profileSyncPaused'>;

describe('tournament catalogue loading in the existing live-data hook', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let snapshot: ReturnType<typeof usePlayerLiveData> | undefined;
  let platform: PlayerPlatform;
  let appState: PlayerAppState;
  let unsubscribeCount: number;
  const listeners = new Set<(state: PlayerAppState) => void>();
  const setters = { setDraftPlayer: vi.fn<Options['setDraftPlayer']>(), setPlayer: vi.fn<Options['setPlayer']>(),
    setScreen: vi.fn<Options['setScreen']>(), setSyncStatus: vi.fn<Options['setSyncStatus']>() };
  const current = () => { if (!snapshot) throw new Error('Hook is not mounted.'); return snapshot; };
  const latestTournament = () => { const stream = ports.tournaments.at(-1); if (!stream) throw new Error('Tournament stream is absent.'); return stream; };
  const latestClub = () => { const stream = ports.clubs.at(-1); if (!stream) throw new Error('Club stream is absent.'); return stream; };
  function Harness({ options }: { options: Inputs }) {
    snapshot = usePlayerLiveData({ ...options, platform, ...setters });
    return <span>{snapshot.tournaments.length}:{snapshot.tournamentLoadError}</span>;
  }
  const render = (overrides: Partial<Inputs> = {}) => {
    act(() => root.render(<Harness options={{ accountLoaded: true, hasAccount: true, firebaseIdentity: null,
      player, profileSyncPaused: true, ...overrides }} />));
    mounted = true;
  };
  const makeCashReady = () => act(() => latestClub().deliver({ ok: true, clubs: [club] }));
  const changeState = (state: PlayerAppState) => act(() => { appState = state; for (const listener of [...listeners]) listener(state); });
  const unmount = () => { if (mounted) act(() => root.unmount()); mounted = false; };

  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers(); vi.setSystemTime('2026-10-14T00:00:00.000Z'); vi.clearAllMocks();
    ports.tournaments.length = 0; ports.clubs.length = 0; ports.session.uid = player.id;
    listeners.clear(); appState = 'active'; unsubscribeCount = 0; snapshot = undefined; mounted = false;
    platform = { os: 'ios', getCurrentAppState: () => appState,
      subscribeToAppState: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); unsubscribeCount += 1; }; },
      openDirections: async () => ({ ok: true }), openAppSettings: async () => undefined,
      confirmAccountDeletion: () => undefined, confirmLocalProfileDeletion: () => undefined,
      showLocalProfileDeletionResult: () => undefined, showAccountDeletionResult: () => undefined };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { unmount(); container.remove(); vi.useRealTimers(); });

  it('waits for account restoration and an existing account before installing either catalogue subscription', () => {
    render({ accountLoaded: false });
    expect(ports.subscribeTournaments).not.toHaveBeenCalled(); expect(ports.subscribeClubs).not.toHaveBeenCalled();
    render({ hasAccount: false });
    expect(ports.subscribeTournaments).not.toHaveBeenCalled();
    render();
    expect(ports.subscribeTournaments).toHaveBeenCalledTimes(1); expect(ports.subscribeTournaments.mock.calls[0][0]).toBeUndefined();
    expect(latestTournament().refresh).toHaveBeenCalledTimes(1); expect(latestTournament().startPolling).toHaveBeenCalledTimes(1);
    expect(latestClub().refresh).toHaveBeenCalledTimes(1); expect(latestClub().startPolling).toHaveBeenCalledTimes(1);
    expect(ports.fetchProfile).not.toHaveBeenCalled(); expect(ports.saveProfile).not.toHaveBeenCalled(); expect(ports.loadPending).not.toHaveBeenCalled();
  });

  it('retains the last tournament and interest arrays on refresh failure while cash readiness stays independent', () => {
    render(); makeCashReady();
    act(() => latestTournament().deliver(result()));
    const retainedTournaments = current().tournaments, retainedInterests = current().tournamentInterests;
    act(() => latestTournament().fail(new Error('Fictional tournament refresh failed')));
    expect(current().tournaments).toBe(retainedTournaments); expect(current().tournamentInterests).toBe(retainedInterests);
    expect(current().tournamentLoadError).toBe('Fictional tournament refresh failed');
    expect(current().liveDataStatus).toBe('ready'); expect(current().liveDataPartial).toBe(false); expect(current().clubs).toEqual([club]);
    act(() => latestTournament().deliver({ tournaments: [], interests: [], page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: undefined } }));
    expect(current().tournaments).toEqual([]); expect(current().tournamentInterests).toEqual([]); expect(current().tournamentLoadError).toBe('');
  });

  it('keeps the subscription usable after an initial error and supplies a safe error fallback', () => {
    render(); act(() => latestTournament().fail(new Error('')));
    expect(current().tournamentLoadError).toBe('Unable to load tournaments.'); expect(current().tournaments).toEqual([]);
    expect(latestTournament().unsubscribe).not.toHaveBeenCalled();
    act(() => latestTournament().deliver(result()));
    expect(current().tournamentLoadError).toBe(''); expect(current().tournaments).toEqual([tournament]);
  });

  it('retires old callbacks and lifecycle bindings on retry without clearing retained tournament data', () => {
    render(); act(() => latestTournament().deliver(result()));
    const old = latestTournament(), oldClub = latestClub();
    act(() => current().retryLiveData());
    expect(old.unsubscribe).toHaveBeenCalledTimes(1); expect(oldClub.unsubscribe).toHaveBeenCalledTimes(1); expect(unsubscribeCount).toBe(2);
    expect(latestTournament()).not.toBe(old); expect(latestTournament().refresh).toHaveBeenCalledTimes(1);
    expect(current().tournaments).toEqual([tournament]);
    act(() => { old.deliver({ ...result(), tournaments: [] }); old.fail(new Error('Retired error')); });
    expect(current().tournaments).toEqual([tournament]); expect(current().tournamentLoadError).toBe('');
  });

  it('binds signed-in results to the current identity even before an owner rerender', () => {
    render({ firebaseIdentity: { uid: player.id, email: player.email, name: player.name, provider: 'email', verified: true } });
    expect(latestTournament().playerId).toBe(player.id);
    ports.session.uid = 'owner-b';
    act(() => { latestTournament().deliver(result()); latestTournament().fail(new Error('Wrong owner')); });
    expect(current().tournaments).toEqual([]); expect(current().tournamentInterests).toEqual([]); expect(current().tournamentLoadError).toBe('');
  });

  it('clears old owner arrays and errors before accepting another owner catalogue', () => {
    const identity: NonNullable<Options['firebaseIdentity']> = { uid: player.id, email: player.email, name: player.name, provider: 'email', verified: true };
    render({ firebaseIdentity: identity }); act(() => { latestTournament().deliver(result()); latestTournament().fail(new Error('Old owner error')); });
    const old = latestTournament(); ports.session.uid = 'owner-b';
    render({ player: { ...player, id: 'owner-b' }, firebaseIdentity: { ...identity, uid: 'owner-b' } });
    expect(old.unsubscribe).toHaveBeenCalledTimes(1); expect(latestTournament().playerId).toBe('owner-b');
    expect(current().tournaments).toEqual([]); expect(current().tournamentInterests).toEqual([]); expect(current().tournamentLoadError).toBe('');
    act(() => { old.deliver(result()); old.fail(new Error('Late old owner error')); });
    expect(current().tournaments).toEqual([]); expect(current().tournamentLoadError).toBe('');
    expect(ports.fetchProfile).not.toHaveBeenCalled(); expect(ports.saveProfile).not.toHaveBeenCalled();
  });

  it('clears tournament state on account loss and ignores a retired response', () => {
    render(); act(() => { latestTournament().deliver(result()); latestTournament().fail(new Error('Previous error')); });
    const old = latestTournament(); render({ hasAccount: false });
    expect(old.unsubscribe).toHaveBeenCalledTimes(1); expect(current().tournaments).toEqual([]);
    expect(current().tournamentInterests).toEqual([]); expect(current().tournamentLoadError).toBe('');
    act(() => { old.deliver(result()); old.fail(new Error('Late account error')); });
    expect(current().tournaments).toEqual([]); expect(current().tournamentLoadError).toBe('');
  });

  it('uses the existing background/foreground polling lifecycle independently for both subscriptions', () => {
    render(); const stream = latestTournament(), cash = latestClub();
    changeState('background'); expect(stream.stopPolling).toHaveBeenCalledTimes(1); expect(cash.stopPolling).toHaveBeenCalledTimes(1);
    changeState('active'); expect(stream.refresh).toHaveBeenCalledTimes(2); expect(stream.startPolling).toHaveBeenCalledTimes(2);
    expect(cash.refresh).toHaveBeenCalledTimes(2); expect(cash.startPolling).toHaveBeenCalledTimes(2);
    changeState('active'); expect(stream.refresh).toHaveBeenCalledTimes(2);
  });

  it('does not start background polling until foreground and disposes listeners and the clock timer', () => {
    appState = 'background'; render(); const stream = latestTournament(), cash = latestClub();
    expect(stream.refresh).toHaveBeenCalledTimes(1); expect(stream.startPolling).not.toHaveBeenCalled();
    changeState('active'); expect(stream.refresh).toHaveBeenCalledTimes(2); expect(stream.startPolling).toHaveBeenCalledTimes(1);
    unmount(); expect(stream.unsubscribe).toHaveBeenCalledTimes(1); expect(cash.unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0); expect(unsubscribeCount).toBe(2); expect(vi.getTimerCount()).toBe(0);
    const previous = current(); act(() => { stream.deliver(result()); stream.fail(new Error('After unmount')); });
    expect(current()).toBe(previous);
  });

  it('exposes idle tournament readiness until account restoration, then loading independently of ready cash data', () => {
    render({ accountLoaded: false });
    expect(current()).toMatchObject({ tournamentDataStatus: 'idle', tournamentDataPartial: false });
    render(); makeCashReady();
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false,
      liveDataStatus: 'ready', liveDataPartial: false, tournaments: [] });
  });

  it('propagates tournament page completeness and clears a partial page only after a complete successful refresh', () => {
    render(); makeCashReady(); act(() => latestTournament().deliver(result(true)));
    expect(current()).toMatchObject({ tournamentDataStatus: 'ready', tournamentDataPartial: true,
      liveDataStatus: 'ready', liveDataPartial: false, tournaments: [tournament], tournamentInterests: [interest] });
    act(() => latestTournament().deliver(result(false)));
    expect(current()).toMatchObject({ tournamentDataStatus: 'ready', tournamentDataPartial: false, liveDataStatus: 'ready' });
  });

  it('labels a failed refresh as error while retaining prior events and interests without downgrading ready cash data', () => {
    render(); makeCashReady(); act(() => latestTournament().deliver(result(true)));
    const retainedTournaments = current().tournaments, retainedInterests = current().tournamentInterests;
    act(() => latestTournament().fail(new Error('Fictional tournament offline')));
    expect(current().tournaments).toBe(retainedTournaments); expect(current().tournamentInterests).toBe(retainedInterests);
    expect(current()).toMatchObject({ tournamentDataStatus: 'error', tournamentDataPartial: false,
      tournamentLoadError: 'Fictional tournament offline', liveDataStatus: 'ready', liveDataPartial: false, clubs: [club] });
  });

  it('reenters loading on explicit retry while retaining events and rejecting the failed subscription callbacks', () => {
    render(); act(() => latestTournament().deliver(result(true)));
    act(() => latestTournament().fail(new Error('Previous attempt failed')));
    const old = latestTournament(); act(() => current().retryLiveData());
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false,
      tournamentLoadError: '', tournaments: [tournament], tournamentInterests: [interest] });
    act(() => { old.deliver(result(true)); old.fail(new Error('Late previous attempt')); });
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false, tournamentLoadError: '' });
    act(() => latestTournament().deliver(result(false)));
    expect(current()).toMatchObject({ tournamentDataStatus: 'ready', tournamentDataPartial: false });
  });

  it('clears completeness and old-owner data while a different authenticated owner catalogue loads', () => {
    const identity: NonNullable<Options['firebaseIdentity']> = { uid: player.id, email: player.email, name: player.name, provider: 'email', verified: true };
    render({ firebaseIdentity: identity }); act(() => latestTournament().deliver(result(true)));
    const old = latestTournament(); ports.session.uid = 'owner-b';
    render({ player: { ...player, id: 'owner-b' }, firebaseIdentity: { ...identity, uid: 'owner-b' } });
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false,
      tournaments: [], tournamentInterests: [], tournamentLoadError: '' });
    act(() => { old.deliver(result(true)); old.fail(new Error('Late owner A result')); });
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false, tournaments: [], tournamentLoadError: '' });
  });

  it('returns tournament readiness to idle on account loss and rejects late partial success or failure', () => {
    render(); act(() => latestTournament().deliver(result(true)));
    const old = latestTournament(); render({ hasAccount: false });
    expect(current()).toMatchObject({ tournamentDataStatus: 'idle', tournamentDataPartial: false,
      tournaments: [], tournamentInterests: [], tournamentLoadError: '' });
    act(() => { old.deliver(result(true)); old.fail(new Error('Late lost-account result')); });
    expect(current()).toMatchObject({ tournamentDataStatus: 'idle', tournamentDataPartial: false, tournaments: [], tournamentLoadError: '' });
  });

  it('exposes an initial tournament error and recovers ready status on a later successful callback', () => {
    render(); makeCashReady(); act(() => latestTournament().fail(new Error('')));
    expect(current()).toMatchObject({ tournamentDataStatus: 'error', tournamentDataPartial: false,
      tournamentLoadError: 'Unable to load tournaments.', tournaments: [], liveDataStatus: 'ready' });
    act(() => latestTournament().deliver(result()));
    expect(current()).toMatchObject({ tournamentDataStatus: 'ready', tournamentDataPartial: false, tournamentLoadError: '' });
  });

  it('never marks a catalogue ready from callbacks after the authenticated identity has changed', () => {
    render({ firebaseIdentity: { uid: player.id, email: player.email, name: player.name, provider: 'email', verified: true } });
    ports.session.uid = 'owner-b';
    act(() => { latestTournament().deliver(result(true)); latestTournament().fail(new Error('Retired identity')); });
    expect(current()).toMatchObject({ tournamentDataStatus: 'loading', tournamentDataPartial: false,
      tournaments: [], tournamentInterests: [], tournamentLoadError: '' });
  });
});
