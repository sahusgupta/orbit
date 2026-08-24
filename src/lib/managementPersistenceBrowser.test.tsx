/**
 * @vitest-environment jsdom
 */
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedState } from '../domain/state';
import type { AppState, PlayerProfile } from '../domain/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  bridgeMode: 'missing' as 'missing' | 'remote' | 'empty' | 'offline' | 'same',
  bridgeRemoteState: undefined as unknown,
  fetchCalls: [] as Array<{ input: string; method: string; body?: string }>,
  floorProps: undefined as unknown,
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  shellProps: undefined as unknown,
  stateSetter: undefined as unknown,
  subscriptionCallback: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
  syncPlayerUpdates: vi.fn(async <T,>(state: T) => state)
}));

const isAppState = (value: unknown): value is AppState =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'profiles')) && Array.isArray(Reflect.get(value, 'interests'));

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

vi.mock('../components/AppShell', () => ({
  default: (props: { children?: ReactNode }) => {
    harness.shellProps = props;
    return props.children ?? null;
  }
}));
vi.mock('../components/FloorView', () => ({
  default: (props: unknown) => {
    harness.floorProps = props;
    return null;
  }
}));
vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn((_accountKey: string, callback: () => void) => {
    harness.subscriptionCallback = callback;
    return harness.unsubscribe;
  }),
  syncPlayerUpdatesToClubState: harness.syncPlayerUpdates
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const access = {
  authorized: true,
  authorizationCode: 'REF-018-BROWSER-AUTH',
  expiresAt: '2099-12-31T23:59:59.000Z',
  activatedAt: '2026-08-08T12:00:00.000Z',
  licenseId: 'REF-018-BROWSER'
};
const accountKey = 'ref-018-browser';
const accountStorageKey = `table-manager-state-v1:${accountKey}`;
const lastAccountKey = 'table-manager-state-v1:last-account';
const now = '2026-08-08T22:00:00.000Z';

const profile = (id: string, name: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id, name, phone: '', birthday: '', membershipStartDate: '', membershipExpirationDate: '', totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'game-browser', preferredGameIds: ['game-browser'],
  gamePlayCounts: {}, mostPlayedGameId: 'game-browser', preferredStakes: '', typicalBuyInMin: 100, typicalBuyInMax: 300,
  willingnessToMove: true, typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: '', ...overrides
});

const buildState = (marker: string): AppState => ({
  ...structuredClone(seedState),
  games: [{ id: 'game-browser', name: marker, maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }],
  profiles: [profile('profile-local', 'Local Player', { notes: marker })],
  interests: [{ id: 'interest-local', profileId: 'profile-local', playerName: 'Local Player', gameId: 'game-browser', status: 'Arrived', timestamp: now, interestedAt: now, arrivedAt: now, notes: marker }],
  tournaments: [],
  revenueTransactions: [],
  usageEvents: [],
  settings: { ...structuredClone(seedState.settings), pilotAccess: access, accountLogin: { username: 'browser@example.test', passwordSalt: 'salt', passwordHash: 'hash', createdAt: now } }
});

const getState = () => {
  if (!isAppState(harness.latestState)) throw new Error('Expected application state');
  return harness.latestState;
};

const invokeFloor = async (name: string, ...args: unknown[]) => {
  if (typeof harness.floorProps !== 'object' || harness.floorProps === null) throw new Error('Expected Floor props');
  const callback: unknown = Reflect.get(harness.floorProps, name);
  if (typeof callback !== 'function') throw new Error(`Expected ${name}`);
  await act(async () => {
    Reflect.apply(callback, undefined, args);
    await Promise.resolve();
    await Promise.resolve();
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await flush();
};

describe('management browser persistence orchestration', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const baseState = buildState('base-fallback');
    const accountState = buildState('last-account-wins');
    localStorage.setItem('table-manager-state-v1', JSON.stringify(baseState));
    localStorage.setItem(accountStorageKey, JSON.stringify(accountState));
    localStorage.setItem(lastAccountKey, accountStorageKey);
    localStorage.setItem(`table-manager-state-v1:auth:${accountKey}`, JSON.stringify({ expiresAt: access.expiresAt }));
    window.location.hash = '#floor';
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      harness.fetchCalls.push({ input: url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (method === 'POST') return new Response(JSON.stringify({ ok: true }), { status: 200 });
      if (harness.bridgeMode === 'offline') throw new Error('isolated bridge offline');
      if (harness.bridgeMode === 'missing') return new Response(null, { status: 404 });
      if (harness.bridgeMode === 'empty') return new Response(JSON.stringify({}), { status: 200 });
      const state = harness.bridgeMode === 'same' ? getState() : harness.bridgeRemoteState;
      return new Response(JSON.stringify({ state }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    await act(async () => {
      await import('../main');
    });
    await flush();
  });

  afterAll(() => {
    if (harness.root) act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('pins last-account cache precedence, API save, bridge retry/merge, notifications, and cleanup', async () => {
    expect(getState().games[0].name).toBe('last-account-wins');
    expect(harness.fetchCalls.some((call) => call.method === 'GET' && call.input.endsWith(`/state/${accountKey}`))).toBe(true);
    expect(harness.fetchCalls.some((call) => call.method === 'POST' && call.input.endsWith('/state'))).toBe(true);

    harness.fetchCalls.length = 0;
    await invokeFloor('deleteInterest', 'interest-local');
    const saved = JSON.parse(localStorage.getItem(accountStorageKey) ?? '{}') as { interests?: unknown[] };
    expect(saved.interests).toEqual([]);
    expect(localStorage.getItem(lastAccountKey)).toBe(accountStorageKey);
    const mutationPost = harness.fetchCalls.find((call) => call.method === 'POST');
    expect(mutationPost).toBeTruthy();
    expect(JSON.parse(mutationPost?.body ?? '{}')).toMatchObject({ state: { interests: [] } });
    expect(Reflect.get(harness.shellProps as object, 'saveState')).toBe('saved');

    const latest = getState();
    harness.bridgeRemoteState = {
      ...latest,
      profiles: [
        { ...latest.profiles[0], name: 'Remote Replacement', notes: 'remote-wins-by-id' },
        profile('profile-request', 'Requested Player', { membershipStatus: 'Requested', membershipRequestedAt: '2026-08-08T21:30:00.000Z' })
      ],
      interests: [{ id: 'interest-remote', profileId: 'profile-request', playerName: 'Requested Player', gameId: 'game-browser', status: 'Interested', timestamp: '2026-08-08T21:31:00.000Z', interestedAt: '2026-08-08T21:31:00.000Z', notes: 'remote' }]
    } satisfies AppState;
    harness.bridgeMode = 'remote';
    await advance(1500);

    expect(getState().profiles.map((candidate) => [candidate.id, candidate.name])).toEqual([
      ['profile-local', 'Remote Replacement'],
      ['profile-request', 'Requested Player']
    ]);
    expect(getState().interests.map((interest) => interest.id)).toEqual(['interest-remote']);
    const notifications = JSON.parse(localStorage.getItem('table-manager-state-v1:staff-notifications') ?? '[]') as Array<Record<string, unknown>>;
    expect(notifications).toEqual([
      {
        id: 'membership-profile-request-2026-08-08T21:30:00.000Z',
        kind: 'membership',
        createdAt: '2026-08-08T22:00:01.500Z',
        read: false
      },
      {
        id: 'seat-interest-remote',
        kind: 'seat',
        createdAt: '2026-08-08T22:00:01.500Z',
        read: false
      }
    ]);
    expect(JSON.stringify(notifications)).not.toContain('Requested Player');
    expect(JSON.parse(localStorage.getItem(accountStorageKey) ?? '{}')).toMatchObject({
      profiles: [{ id: 'profile-local', name: 'Remote Replacement' }, { id: 'profile-request' }],
      interests: [{ id: 'interest-remote' }]
    });

    const mergedReference = getState();
    harness.bridgeMode = 'same';
    await advance(1500);
    expect(getState()).toBe(mergedReference);
    expect(JSON.parse(localStorage.getItem('table-manager-state-v1:staff-notifications') ?? '[]')).toHaveLength(2);

    harness.bridgeMode = 'empty';
    await advance(1500);
    expect(getState()).toBe(mergedReference);
    harness.bridgeMode = 'offline';
    const getCallsBeforeRetry = harness.fetchCalls.filter((call) => call.method === 'GET').length;
    await advance(1500);
    expect(harness.fetchCalls.filter((call) => call.method === 'GET')).toHaveLength(getCallsBeforeRetry + 1);
    expect(getState()).toBe(mergedReference);

    const callsBeforeCleanup = harness.fetchCalls.length;
    act(() => harness.root?.unmount());
    await advance(31_500);
    expect(harness.fetchCalls).toHaveLength(callsBeforeCleanup);
    expect(harness.unsubscribe).not.toHaveBeenCalled();
  });
});
