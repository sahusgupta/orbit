/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppState, PlayerProfile, Tournament } from '../domain/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  latestState: undefined as unknown,
  props: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isAppState = (value: unknown): value is AppState =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'tournaments'));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isAppState(result[0])) {
        harness.latestState = result[0];
        harness.stateSetter = result[1];
      }
      return result;
    }
  };
});

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment) {
      const root = actual.createRoot(container);
      harness.root = root;
      return root;
    }
  };
});

vi.mock('../components/TournamentsView', () => ({
  default: (props: unknown) => {
    harness.props = props;
    return null;
  }
}));
vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const now = '2026-08-08T22:00:00.000Z';

const getState = () => {
  if (!isAppState(harness.latestState)) throw new Error('Expected application state');
  return harness.latestState;
};

const getProp = (name: string) => {
  if (typeof harness.props !== 'object' || harness.props === null) throw new Error('Expected tournament props');
  return Reflect.get(harness.props, name) as unknown;
};

const invoke = async (name: string, ...args: unknown[]) => {
  const callback = getProp(name);
  if (typeof callback !== 'function') throw new Error(`Expected ${name} callback`);
  await act(async () => {
    Reflect.apply(callback, undefined, args);
    await Promise.resolve();
  });
};

const resetState = async (tournaments: Tournament[], profiles: PlayerProfile[] = []) => {
  const setter = harness.stateSetter;
  if (typeof setter !== 'function') throw new Error('Expected state setter');
  await act(async () => {
    setter((current: unknown) => {
      if (!isAppState(current)) throw new Error('Expected current state');
      return { ...current, tournaments, profiles, revenueTransactions: [], usageEvents: [] };
    });
  });
};

const tournamentFixture = (): Tournament => ({
  id: 'tournament-main',
  name: 'Lifecycle Event',
  status: 'Draft',
  createdAt: '2026-08-08T18:00:00.000Z',
  currentLevelIndex: 0,
  buyIn: 100,
  startingStack: 20_000,
  rebuyPrizePercent: 50,
  tableSize: 2,
  levels: [
    { id: 'level-1', level: 1, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 10, breakAfter: false, breakMinutes: 0 },
    { id: 'level-2', level: 2, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: 15, breakAfter: false, breakMinutes: 0 }
  ],
  players: [
    { id: 'player-one', name: 'One', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000, status: 'Registered', registeredAt: '2026-08-08T19:00:00.000Z' },
    { id: 'player-two', name: 'Two', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000, status: 'Registered', registeredAt: '2026-08-08T19:01:00.000Z' }
  ],
  payouts: [{ place: 1, percent: 100 }]
});

describe('tournament mutation orchestration', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#tournaments';
    localStorage.setItem('table-manager-state-v1', JSON.stringify({
      settings: {
        pilotAccess: {
          activatedAt: '2026-08-08T12:00:00.000Z',
          authorizationCode: 'REF-017-AUTH',
          authorized: true,
          expiresAt: '2099-12-31T23:59:59.000Z',
          licenseId: 'REF-017-LICENSE'
        },
        accountLogin: { username: 'ref-017@example.test' }
      }
    }));
    localStorage.setItem('table-manager-state-v1:auth:ref-017-license', JSON.stringify({ expiresAt: '2099-12-31T23:59:59.000Z' }));
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('creates, normalizes, edits, and reruns tournament structures with reset lifecycle fields', async () => {
    await resetState([]);
    await invoke('setTournamentDraft', {
      name: '  Test Tournament  ',
      buyIn: '-10',
      startingStack: '500',
      levelMinutes: '2',
      rebuyPrizePercent: '120',
      tableSize: '99'
    });
    await invoke('createTournament', { preventDefault: vi.fn() });

    const created = getState().tournaments[0];
    expect(created).toMatchObject({
      id: expect.any(String),
      name: 'Test Tournament',
      status: 'Draft',
      createdAt: now,
      currentLevelIndex: 0,
      buyIn: 0,
      startingStack: 1000,
      rebuyPrizePercent: 100,
      tableSize: 10,
      players: []
    });
    expect(created.levels.length).toBeGreaterThan(1);
    expect(created.levels.every((level) => level.durationMinutes === 5)).toBe(true);
    expect(created.payouts).toEqual(expect.arrayContaining([{ place: 1, percent: expect.any(Number) }]));

    await invoke('setTournamentDraft', {
      name: '  Edited Tournament  ',
      buyIn: '125',
      startingStack: '25000',
      levelMinutes: '30',
      rebuyPrizePercent: '60',
      tableSize: '8'
    });
    await invoke('saveTournamentSettings', { preventDefault: vi.fn() });
    expect(getState().tournaments[0]).toMatchObject({
      name: 'Edited Tournament',
      buyIn: 125,
      startingStack: 25_000,
      rebuyPrizePercent: 60,
      tableSize: 8
    });
    expect(getState().tournaments[0].levels.every((level) => level.durationMinutes === 30)).toBe(true);

    const edited = getState().tournaments[0];
    const completed = { ...edited, status: 'Finished' as const, startedAt: now, completedAt: now, currentLevelIndex: 2, players: tournamentFixture().players };
    await resetState([completed]);
    await invoke('runTournamentAgain', completed);
    expect(getState().tournaments[0]).toMatchObject({
      id: expect.not.stringMatching(completed.id),
      name: completed.name,
      status: 'Draft',
      createdAt: now,
      startedAt: undefined,
      completedAt: undefined,
      currentLevelIndex: 0,
      players: []
    });
  });

  it('preserves registration identity, clock math, entries, payouts, and elimination finish mapping', async () => {
    const source = tournamentFixture();
    const registeredProfile: PlayerProfile = {
      id: 'profile-three', name: 'Profile Three', phone: '555-0303', birthday: '', membershipStartDate: '', membershipExpirationDate: '',
      totalTimePlayedHours: 0, lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'game', preferredGameIds: ['game'],
      gamePlayCounts: {}, mostPlayedGameId: 'game', preferredStakes: '', typicalBuyInMin: 100, typicalBuyInMax: 300,
      willingnessToMove: true, typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: ''
    };
    await resetState([source], [registeredProfile]);
    await invoke('setTournamentPlayerDraft', { name: 'Ignored', profileId: registeredProfile.id, phone: '', email: ' profile@example.test ' });
    await invoke('registerTournamentPlayer', { preventDefault: vi.fn() });
    expect(getState().tournaments[0].players[2]).toMatchObject({
      id: expect.any(String),
      profileId: registeredProfile.id,
      name: registeredProfile.name,
      phone: registeredProfile.phone,
      email: 'profile@example.test',
      buyIn: source.buyIn,
      rebuys: 0,
      addOns: 0,
      startingStack: source.startingStack,
      status: 'Registered',
      registeredAt: now
    });

    let current = getState().tournaments[0];
    await invoke('checkInTournamentPlayer', current, 'player-one');
    expect(getState().tournaments[0].players[0].status).toBe('Checked In');
    current = getState().tournaments[0];
    await invoke('startTournament', current);
    expect(getState().tournaments[0]).toMatchObject({ status: 'Running', startedAt: now, levelStartedAt: now, pausedRemainingSeconds: undefined });
    expect(getState().tournaments[0].players.map((player) => player.status)).toEqual(['Active', 'Active', 'Active']);

    current = getState().tournaments[0];
    await invoke('pauseTournament', current);
    expect(getState().tournaments[0]).toMatchObject({ status: 'Paused', pausedAt: now, pausedRemainingSeconds: 600 });
    current = getState().tournaments[0];
    await invoke('resumeTournament', current);
    expect(getState().tournaments[0]).toMatchObject({ status: 'Running', levelStartedAt: now });
    current = getState().tournaments[0];
    await invoke('advanceTournamentLevel', current, 1);
    expect(getState().tournaments[0]).toMatchObject({ currentLevelIndex: 1, levelStartedAt: now, pausedRemainingSeconds: undefined });

    current = getState().tournaments[0];
    await invoke('addTournamentEntry', current, 'player-one', 'rebuys');
    current = getState().tournaments[0];
    await invoke('addTournamentEntry', current, 'player-one', 'addOns');
    expect(getState().tournaments[0].players[0]).toMatchObject({ rebuys: 1, addOns: 1 });
    current = getState().tournaments[0];
    await invoke('updateTournamentPayout', current, 2, -5);
    expect(getState().tournaments[0].payouts).toEqual([{ place: 1, percent: 100 }, { place: 2, percent: 0 }]);

    current = getState().tournaments[0];
    await invoke('eliminateTournamentPlayer', current, 'player-one');
    expect(getState().tournaments[0].players[0]).toMatchObject({ status: 'Eliminated', eliminatedAt: now, finishPlace: 3 });
    current = getState().tournaments[0];
    await invoke('eliminateTournamentPlayer', current, 'player-two');
    expect(getState().tournaments[0]).toMatchObject({ status: 'Finished', completedAt: now });
    expect(getState().tournaments[0].players[1]).toMatchObject({ status: 'Eliminated', finishPlace: 2 });
  });
});
