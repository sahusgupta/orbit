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
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ ok: true, revision: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        : new Response(null, { status: 404 })
    ));
    vi.stubGlobal('confirm', vi.fn(() => true));

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

  it('renders the compact floor command bar, room map, retained workflows, and quick-add entry point', async () => {
    expect(document.querySelector('h1')?.textContent).toBe('Floor');
    expect(document.querySelector('.page-subtitle')).toBeNull();
    expect(document.querySelector('.waitlist-icon-trigger')?.getAttribute('aria-label')).toBe(
      'Open waitlist, 10 waiting'
    );
    expect(document.querySelector('.topbar-actions .primary-button')?.textContent?.trim()).toBe('Add player');

    expect(Array.from(document.querySelectorAll('.floor-header-metrics > span'), (item) => item.textContent?.trim())).toEqual([
      '0 running',
      '0 seated'
    ]);
    expect(document.querySelector<HTMLButtonElement>('.floor-utility-button[aria-label^="Timers"]')?.getAttribute('aria-label')).toBe(
      'Timers, no seated players'
    );
    expect(document.querySelector<HTMLButtonElement>('.floor-utility-button[aria-label^="Activity"]')?.getAttribute('aria-label')).toBe(
      'Activity, 0 recent events'
    );
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Graphic floor view"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Classic floor view"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.floor-room-map h2')?.textContent).toBe('Room map');
    expect(document.body.textContent).not.toContain('Select a table identity to open its live table view.');
    expect(document.querySelector('.floor-map-table-identity strong')?.textContent).toBe('Main Table');
    const roomWorkspace = document.querySelector('.floor-room-workspace');
    expect(roomWorkspace?.querySelector(':scope > .floor-room-map')).not.toBeNull();
    expect(roomWorkspace?.querySelector(':scope > .floor-workspace-dock')).not.toBeNull();
    expect(Array.from(document.querySelectorAll('.floor-workspace-dock button'), (button) => button.textContent?.trim())).toEqual([
      'Current tables',
      'Table overview',
      'Forming games'
    ]);
    expect(Array.from(document.querySelectorAll('.panel-title h2'), (heading) => heading.textContent)).toEqual([
      'Quick Add'
    ]);
    expect(document.querySelector('.active-game-card')).toBeNull();
    const dockButtons = document.querySelectorAll<HTMLButtonElement>('.floor-workspace-dock button');
    expect(Array.from(dockButtons, (button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false']);

    act(() => {
      dockButtons[0]?.click();
    });
    const currentTablesDialog = document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby]');
    expect(currentTablesDialog?.textContent).toContain('Current Tables');
    expect(currentTablesDialog?.closest('.floor-view-shell')).toBeNull();
    expect(currentTablesDialog?.contains(document.activeElement)).toBe(true);
    expect(document.querySelector('.active-game-card h3')?.textContent).toBe('Threshold Holdem');
    expect(document.querySelector('.active-game-card > div > span')?.textContent).toBe(
      'Main Table - Forming - Drop'
    );
    const tableControls = Array.from(document.querySelectorAll<HTMLButtonElement>('.active-game-card .seat-control > button'));
    expect(
      tableControls.slice(0, 5).map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(['+', 'Start Table', 'Open', 'Ledger', 'Close table']);
    expect(tableControls[4]?.getAttribute('aria-label')).toBe('Close Main Table and clear 0 seated players');
    expect(tableControls.slice(5).map((button) => button.getAttribute('title'))).toEqual([
      'Hide table',
      'Table actions'
    ]);
    await act(async () => {
      currentTablesDialog?.querySelector<HTMLButtonElement>('button[aria-label="Close Current Tables"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(20);
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(dockButtons[0]);
  });

  it('persists a two-way toggle between the graphic room map and classic table list', async () => {
    const graphicButton = document.querySelector<HTMLButtonElement>('button[aria-label="Graphic floor view"]');
    const classicButton = document.querySelector<HTMLButtonElement>('button[aria-label="Classic floor view"]');

    await act(async () => {
      classicButton?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('.floor-room-map')).toBeNull();
    expect(document.querySelector('.floor-classic-overview h2')?.textContent).toBe('Current tables');
    expect(document.querySelector('.floor-classic-table h3')?.textContent).toBe('Main Table');
    expect(classicButton?.getAttribute('aria-pressed')).toBe('true');
    const persistedStateKey = localStorage.getItem('table-manager-state-v1:last-account');
    const classicState = JSON.parse(localStorage.getItem(persistedStateKey ?? '') ?? '{}');
    expect(classicState.settings?.showPlayerGrid).toBe(false);

    await act(async () => {
      graphicButton?.click();
      await Promise.resolve();
    });
    expect(document.querySelector('.floor-room-map h2')?.textContent).toBe('Room map');
    expect(document.querySelector('.floor-classic-overview')).toBeNull();
    expect(graphicButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders canonical waitlist details without incidental mutations and removes the selected entry', async () => {
    act(() => {
      document.querySelectorAll<HTMLButtonElement>('.floor-workspace-dock button')[2]?.click();
    });
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

    const waitlistTrigger = document.querySelector<HTMLButtonElement>('.waitlist-icon-trigger');
    act(() => waitlistTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const waitlistRows = Array.from(document.querySelectorAll('.waitlist-popup-row'));
    expect(waitlistRows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'Alice Arrived',
      'Bob Interested',
      'Cara Confirmed',
      'Dan Overflow',
      'Eve Arrived',
      'Frank Confirmed',
      'Grace Interested',
      'Heidi Interested',
      'Ivan Capped',
      'Judy Capped'
    ]);
    expect(waitlistRows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'Threshold Holdem \u00b7 Here',
      'Threshold Holdem \u00b7 Interested',
      'Threshold Holdem \u00b7 Coming',
      'Overflow Stud \u00b7 Interested',
      'Threshold PLO \u00b7 Here',
      'Overflow Stud \u00b7 Coming',
      'Overflow Stud \u00b7 Interested',
      'Overflow Stud \u00b7 Interested',
      'Overflow Stud \u00b7 Interested',
      'Overflow Stud \u00b7 Interested'
    ]);
    expect(document.body.textContent).not.toContain('Inactive Removed');

    const aliceRows = Array.from(waitlistRows[0].querySelectorAll('.waitlist-popup-timing')).map((row) =>
      row.textContent?.replaceAll('edited', '').trim()
    );
    expect(aliceRows).toEqual([
      `Joined ${formatClock('2026-08-07T16:00:00.000Z')} (120m)`,
      `Arrived ${formatClock('2026-08-07T17:30:00.000Z')} (30m)`
    ]);
    expect(waitlistRows[0].querySelectorAll('.edited-marker')).toHaveLength(2);
    expect(Array.from(waitlistRows[1].querySelectorAll('.waitlist-popup-timing')).map((row) => row.textContent?.trim())).toEqual([
      `Joined ${formatClock('2026-08-07T17:15:00.000Z')} (45m)`
    ]);
    expect(waitlistRows[1].querySelectorAll('.edited-marker')).toHaveLength(0);

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
    const bobCard = Array.from(document.querySelectorAll('.waitlist-popup-row')).find(
      (card) => card.querySelector('strong')?.textContent === 'Bob Interested'
    );
    expect(bobCard?.querySelector('span')?.textContent).toBe('Unknown game \u00b7 Interested');

    await act(async () => {
      bobCard
        ?.querySelector<HTMLButtonElement>('button[aria-label="Actions for Bob Interested"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      await Promise.resolve();
    });
    const removeWaitlistItem = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.trim() === 'Remove from waitlist'
    );
    expect(removeWaitlistItem).toBeTruthy();
    await act(async () => {
      removeWaitlistItem?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.latestInterestReferences.some((interest) => (
      typeof interest === 'object' && interest !== null && 'id' in interest && interest.id === 'interest-bob'
    ))).toBe(false);
    expect(globalThis.confirm).toHaveBeenCalledWith('Remove this interest entry?');
    expect(document.body.textContent).not.toContain('Bob Interested');

    act(() => {
      stateSetter((current: unknown) => {
        if (typeof current !== 'object' || current === null) throw new Error('Expected application state');
        return { ...current, interests: [] };
      });
    });
    expect(document.querySelector('.waitlist-popup-list')?.textContent).toContain('No one is waiting');
    expect(document.querySelectorAll('.waitlist-popup-row')).toHaveLength(0);
  });

  it('accepts a blank cash-out and closes the remaining table players from the direct control', async () => {
    const stateSetter = harness.stateSetter;
    if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
    const cashOutPlayer = {
      id: 'player-session-cash-out',
      playerName: 'Alex Optional',
      gameId: 'game-a',
      tableId: 'forming-game-a',
      seatNumber: 1,
      seatedAt: '2026-08-07T17:00:00.000Z'
    };
    const remainingPlayer = {
      id: 'player-session-remaining',
      playerName: 'Casey Remaining',
      gameId: 'game-a',
      tableId: 'forming-game-a',
      seatNumber: 2,
      seatedAt: '2026-08-07T17:15:00.000Z'
    };

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close waitlist"]')?.click();
      stateSetter((current: unknown) => {
        if (
          typeof current !== 'object' ||
          current === null ||
          !('sessions' in current) ||
          !Array.isArray(current.sessions)
        ) {
          throw new Error('Expected application state with sessions');
        }
        return {
          ...current,
          sessions: current.sessions.map((session: unknown) =>
            typeof session === 'object' && session !== null && 'id' in session && session.id === 'forming-game-a'
              ? { ...session, status: 'Running', seatsFilled: 2 }
              : session
          ),
          playerSessions: [cashOutPlayer, remainingPlayer]
        };
      });
    });

    const currentTablesTrigger = Array.from(document.querySelectorAll<HTMLButtonElement>('.floor-workspace-dock button'))
      .find((button) => button.textContent?.trim() === 'Current tables');
    act(() => currentTablesTrigger?.click());

    const cashOutSeat = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Open details for Alex Optional at seat 1"]'
    );
    expect(cashOutSeat).not.toBeNull();
    act(() => cashOutSeat?.click());
    act(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === 'Cash out and leave table')
        ?.click();
    });

    const cashOutAmount = document.querySelector<HTMLInputElement>('.cash-out-modal input[type="number"]');
    expect(cashOutAmount?.required).toBe(false);
    expect(cashOutAmount?.closest('label')?.textContent).toContain('Cash-out amount (optional)');
    const transitionTime = new Date().toISOString();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.cash-out-modal button[type="submit"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.cash-out-modal')).toBeNull();

    const readPersistedRecords = () => {
      const stateKey = localStorage.getItem('table-manager-state-v1:last-account');
      const serialized = stateKey ? localStorage.getItem(stateKey) : null;
      if (!serialized) throw new Error('Expected persisted application state');
      const parsed: unknown = JSON.parse(serialized);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('Expected persisted state object');
      const requireRecords = (value: unknown, label: string) => {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'object' || item === null)) {
          throw new Error(`Expected ${label} records`);
        }
        return value as Record<string, unknown>[];
      };
      return {
        playerLedger: requireRecords(Reflect.get(parsed, 'playerLedger'), 'player ledger'),
        playerSessions: requireRecords(Reflect.get(parsed, 'playerSessions'), 'player session'),
        sessions: requireRecords(Reflect.get(parsed, 'sessions'), 'session')
      };
    };

    const afterCashOut = readPersistedRecords();
    const cashOutEntry = afterCashOut.playerLedger.find((entry) => entry.type === 'Cash-Out');
    expect(cashOutEntry).toMatchObject({
      playerName: cashOutPlayer.playerName,
      note: 'Player left table without a recorded cash-out amount'
    });
    expect(cashOutEntry).not.toHaveProperty('amount');
    expect(afterCashOut.playerSessions.find((session) => session.id === cashOutPlayer.id)).toMatchObject({ leftAt: transitionTime });
    expect(afterCashOut.playerSessions.find((session) => session.id === remainingPlayer.id)).not.toHaveProperty('leftAt');

    const closeTableButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Main Table and clear 1 seated player"]'
    );
    expect(closeTableButton?.textContent?.trim()).toBe('Close table');
    await act(async () => {
      closeTableButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterClose = readPersistedRecords();
    expect(afterClose.sessions.find((session) => session.id === 'forming-game-a')).toMatchObject({
      status: 'Closed',
      endedAt: transitionTime
    });
    expect(afterClose.playerSessions.find((session) => session.id === remainingPlayer.id)).toMatchObject({ leftAt: transitionTime });
    expect(document.querySelector('.active-game-card')).toBeNull();
  });
});
