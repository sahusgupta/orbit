/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  initialGameReferences: [] as unknown[],
  initialGameSnapshot: '',
  initialInterestReferences: [] as unknown[],
  initialInterestSnapshot: '',
  latestGameReferences: [] as unknown[],
  latestGameSnapshot: '',
  latestInterestReferences: [] as unknown[],
  latestInterestSnapshot: '',
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];

      if (
        typeof value === 'object' &&
        value !== null &&
        'games' in value &&
        Array.isArray(value.games) &&
        value.games.some(
          (game: unknown) =>
            typeof game === 'object' && game !== null && 'id' in game && game.id === 'game-a'
        ) &&
        'interests' in value &&
        Array.isArray(value.interests)
      ) {
        if (harness.stateSetter === undefined) {
          harness.initialGameReferences = [...value.games];
          harness.initialGameSnapshot = JSON.stringify(value.games);
          harness.initialInterestReferences = [...value.interests];
          harness.initialInterestSnapshot = JSON.stringify(value.interests);
          harness.stateSetter = result[1];
        }

        harness.latestGameReferences = [...value.games];
        harness.latestGameSnapshot = JSON.stringify(value.games);
        harness.latestInterestReferences = [...value.interests];
        harness.latestInterestSnapshot = JSON.stringify(value.interests);
      }

      return result;
    }
  };
});

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment, options?: RootOptions) {
      const root = actual.createRoot(container, options);
      harness.root = root;
      return root;
    }
  };
});

vi.mock('../lib/firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('../lib/firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const now = '2026-08-07T18:00:00.000Z';
const games = [
  {
    id: 'game-a',
    name: 'Threshold Holdem',
    maxSeats: 6,
    minInRoomForLikely: 1,
    minFlexibleForLikely: 2,
    minTotalForViable: 4
  },
  {
    id: 'game-b',
    name: 'Threshold PLO',
    maxSeats: 8,
    minInRoomForLikely: 1,
    minFlexibleForLikely: 1,
    minTotalForViable: 10
  },
  {
    id: 'game-c',
    name: 'Overflow Stud',
    maxSeats: 8,
    minInRoomForLikely: 2,
    minFlexibleForLikely: 4,
    minTotalForViable: 8
  }
];
const interests = [
  {
    id: 'interest-alice',
    playerName: 'Alice Arrived',
    gameId: 'game-a',
    status: 'Arrived',
    timestamp: '2026-08-07T16:00:00.000Z',
    interestedAt: '2026-08-07T16:00:00.000Z',
    arrivedAt: '2026-08-07T17:30:00.000Z',
    notes: '',
    manualEdits: {
      interestedAt: '2026-08-07T16:05:00.000Z',
      arrivedAt: '2026-08-07T17:35:00.000Z'
    }
  },
  {
    id: 'interest-inactive',
    playerName: 'Inactive Removed',
    gameId: 'game-a',
    status: 'Removed',
    timestamp: '2026-08-07T17:10:00.000Z',
    interestedAt: '2026-08-07T17:10:00.000Z',
    closedAt: '2026-08-07T17:10:00.000Z',
    notes: ''
  },
  {
    id: 'interest-bob',
    playerName: 'Bob Interested',
    gameId: 'game-a',
    status: 'Interested',
    timestamp: '2026-08-07T17:15:00.000Z',
    interestedAt: '2026-08-07T17:15:00.000Z',
    notes: ''
  },
  {
    id: 'interest-cara',
    playerName: 'Cara Confirmed',
    gameId: 'game-a',
    status: 'Confirmed Coming',
    timestamp: '2026-08-07T17:20:00.000Z',
    interestedAt: '2026-08-07T17:20:00.000Z',
    confirmedAt: '2026-08-07T17:20:00.000Z',
    notes: ''
  },
  {
    id: 'interest-dan',
    playerName: 'Dan Overflow',
    gameId: 'game-c',
    status: 'Interested',
    timestamp: '2026-08-07T17:25:00.000Z',
    interestedAt: '2026-08-07T17:25:00.000Z',
    notes: ''
  },
  {
    id: 'interest-eve',
    playerName: 'Eve Arrived',
    gameId: 'game-b',
    status: 'Arrived',
    timestamp: '2026-08-07T17:30:00.000Z',
    interestedAt: '2026-08-07T17:30:00.000Z',
    arrivedAt: '2026-08-07T17:50:00.000Z',
    notes: ''
  },
  {
    id: 'interest-frank',
    playerName: 'Frank Confirmed',
    gameId: 'game-c',
    status: 'Confirmed Coming',
    timestamp: '2026-08-07T17:35:00.000Z',
    interestedAt: '2026-08-07T17:35:00.000Z',
    confirmedAt: '2026-08-07T17:35:00.000Z',
    notes: ''
  },
  {
    id: 'interest-grace',
    playerName: 'Grace Interested',
    gameId: 'game-c',
    status: 'Interested',
    timestamp: '2026-08-07T17:40:00.000Z',
    interestedAt: '2026-08-07T17:40:00.000Z',
    notes: ''
  },
  {
    id: 'interest-heidi',
    playerName: 'Heidi Interested',
    gameId: 'game-c',
    status: 'Interested',
    timestamp: '2026-08-07T17:45:00.000Z',
    interestedAt: '2026-08-07T17:45:00.000Z',
    notes: ''
  },
  {
    id: 'interest-ivan',
    playerName: 'Ivan Capped',
    gameId: 'game-c',
    status: 'Interested',
    timestamp: '2026-08-07T17:50:00.000Z',
    interestedAt: '2026-08-07T17:50:00.000Z',
    notes: ''
  },
  {
    id: 'interest-judy',
    playerName: 'Judy Capped',
    gameId: 'game-c',
    status: 'Interested',
    timestamp: '2026-08-07T17:55:00.000Z',
    interestedAt: '2026-08-07T17:55:00.000Z',
    notes: ''
  }
];

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const getButtonLabels = (container: Element) =>
  Array.from(container.querySelectorAll('button')).map((button) => button.textContent?.trim());

describe('floor collection projections', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    const accountKey = 'type-007j-test';
    const stateKey = `table-manager-state-v1:${accountKey}`;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '/floor';
    localStorage.clear();
    localStorage.setItem('table-manager-state-v1:last-account', stateKey);
    localStorage.setItem(
      `table-manager-state-v1:auth:${accountKey}`,
      JSON.stringify({ expiresAt, savedAt: '2026-08-07T12:00:00.000Z' })
    );
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        games,
        profiles: [],
        tournaments: [],
        interests,
        sessions: [
          {
            id: 'forming-game-a',
            gameId: 'game-a',
            label: 'Main Table',
            status: 'Forming',
            seatsFilled: 0,
            maxSeats: 6,
            timeFeeBased: false,
            collectionMode: 'Drop',
            tags: [],
            startedAt: '2026-08-07T17:00:00.000Z'
          }
        ],
        playerSessions: [],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [],
        handCountLogs: [],
        timeFeeLogs: [],
        revenueTransactions: [],
        playerLedger: [],
        tableEvents: [],
        inAppNotifications: [],
        history: [],
        nightCloses: [],
        feedback: [],
        scriptTemplates: [],
        correctionLog: [],
        usageEvents: [],
        settings: {
          lowLight: false,
          defaultCollectionMode: 'Drop',
          defaultTableCap: 10,
          defaultHourlyFee: 0,
          defaultEstimatedDropPerSeatHour: 0,
          collectionProfiles: [],
          membershipPlans: [],
          showPlayerGrid: true,
          showDashboardKpis: false,
          showRecentPlayers: true,
          pilotAccess: {
            authorized: true,
            authorizationCode: 'TYPE-007J-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007J-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007j@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007j@example.test',
            passwordSalt: 'local-test-salt',
            passwordHash: 'local-test-hash',
            createdAt: '2026-08-07T12:00:00.000Z'
          }
        }
      })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders complete game demand and waitlist values in canonical order without mutating state', () => {
    const menu = document.querySelector<HTMLSelectElement>('.forming-game-menu select');
    expect(menu).not.toBeNull();
    expect(Array.from(menu?.options ?? []).map((option) => [option.value, option.textContent])).toEqual([
      ['game-a', 'Threshold Holdem, forming, 1 in room'],
      ['game-b', 'Threshold PLO, 1 in room'],
      ['game-c', 'Overflow Stud']
    ]);

    const initialCard = document.querySelector('.forming-card');
    expect(initialCard?.querySelector('strong')?.textContent).toBe('Threshold Holdem');
    expect(initialCard?.querySelector('.status-pill')?.textContent).toBe('Ready to Start');
    expect(initialCard?.querySelector('p')?.textContent).toBe('1 in / 1 coming / 2 waiting');
    expect(initialCard?.querySelector('small')?.textContent).toBe('Enough in-room demand to start');
    expect(getButtonLabels(initialCard!)).toEqual(['Select + Start', 'Failed']);

    const waitlistCards = Array.from(document.querySelectorAll('.waitlist-card'));
    expect(waitlistCards.map((card) => card.querySelector('strong')?.textContent)).toEqual([
      'Alice Arrived',
      'Bob Interested',
      'Cara Confirmed',
      'Dan Overflow',
      'Eve Arrived',
      'Frank Confirmed',
      'Grace Interested',
      'Heidi Interested'
    ]);
    expect(waitlistCards.map((card) => card.querySelector('span')?.textContent)).toEqual([
      'Threshold Holdem - Arrived',
      'Threshold Holdem - Interested',
      'Threshold Holdem - Confirmed Coming',
      'Overflow Stud - Interested',
      'Threshold PLO - Arrived',
      'Overflow Stud - Confirmed Coming',
      'Overflow Stud - Interested',
      'Overflow Stud - Interested'
    ]);
    expect(document.body.textContent).not.toContain('Inactive Removed');
    expect(document.body.textContent).not.toContain('Ivan Capped');
    expect(document.body.textContent).not.toContain('Judy Capped');

    const aliceRows = Array.from(waitlistCards[0].querySelectorAll('small')).map((row) =>
      row.textContent?.replaceAll('edited', '').trim()
    );
    expect(aliceRows).toEqual([
      `Logged ${formatClock('2026-08-07T16:00:00.000Z')} (120m)`,
      `Arrived ${formatClock('2026-08-07T17:30:00.000Z')} (30m)`
    ]);
    expect(waitlistCards[0].querySelectorAll('.edited-marker')).toHaveLength(2);
    expect(Array.from(waitlistCards[1].querySelectorAll('small')).map((row) => row.textContent?.trim())).toEqual([
      `Logged ${formatClock('2026-08-07T17:15:00.000Z')} (45m)`
    ]);
    expect(waitlistCards[1].querySelectorAll('.edited-marker')).toHaveLength(0);

    act(() => {
      if (!menu) throw new Error('Expected the forming-game menu');
      menu.value = 'game-b';
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const alternateCard = document.querySelector('.forming-card');
    expect(alternateCard?.querySelector('strong')?.textContent).toBe('Threshold PLO');
    expect(alternateCard?.querySelector('.status-pill')?.textContent).toBe('Likely to Start');
    expect(alternateCard?.querySelector('p')?.textContent).toBe('1 in / 0 coming / 1 waiting');
    expect(alternateCard?.querySelector('small')?.textContent).toBe('Coordinate arrivals');
    expect(getButtonLabels(alternateCard!)).toEqual(['Build Game']);
    expect(document.querySelectorAll('.forming-card')).toHaveLength(1);

    expect(harness.initialGameSnapshot).toBe(JSON.stringify(games));
    expect(harness.initialInterestSnapshot).toBe(
      JSON.stringify(interests.map((interest) => ({ ...interest, manualEdits: interest.manualEdits ?? {} })))
    );
    expect(harness.latestGameSnapshot).toBe(harness.initialGameSnapshot);
    expect(harness.latestInterestSnapshot).toBe(harness.initialInterestSnapshot);
    expect(harness.latestGameReferences).toHaveLength(harness.initialGameReferences.length);
    expect(harness.latestInterestReferences).toHaveLength(harness.initialInterestReferences.length);
    harness.latestGameReferences.forEach((game, index) => {
      expect(game).toBe(harness.initialGameReferences[index]);
    });
    harness.latestInterestReferences.forEach((interest, index) => {
      expect(interest).toBe(harness.initialInterestReferences[index]);
    });

    const stateSetter = harness.stateSetter;
    if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
    act(() => {
      stateSetter((current: unknown) => {
        if (
          typeof current !== 'object' ||
          current === null ||
          !('interests' in current) ||
          !Array.isArray(current.interests)
        ) {
          throw new Error('Expected application state with interests');
        }
        return {
          ...current,
          interests: current.interests.map((interest: unknown) =>
            typeof interest === 'object' &&
            interest !== null &&
            'id' in interest &&
            interest.id === 'interest-bob'
              ? { ...interest, gameId: 'missing-game' }
              : interest
          )
        };
      });
    });
    const bobCard = Array.from(document.querySelectorAll('.waitlist-card')).find(
      (card) => card.querySelector('strong')?.textContent === 'Bob Interested'
    );
    expect(bobCard?.querySelector('span')?.textContent).toBe('Unknown - Interested');

    act(() => {
      stateSetter((current: unknown) => {
        if (typeof current !== 'object' || current === null) throw new Error('Expected application state');
        return { ...current, interests: [] };
      });
    });
    expect(document.querySelector('.waitlist-list')?.textContent).toContain('No one is on the waitlist.');
    expect(document.querySelectorAll('.waitlist-card')).toHaveLength(0);
  });
});
