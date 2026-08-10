/**
 * @vitest-environment jsdom
 */
import type { DependencyList } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type CapturedBlob = {
  parts: BlobPart[];
  type: string;
};

type IdentifiedTableEvent = Record<string, unknown> & {
  id: string;
  gameId: string;
  timestamp: string;
  playerCount: number;
  note: string;
};

type ReportState = Record<string, unknown> & {
  tableEvents: IdentifiedTableEvent[];
};

const eventIds = [
  'failed-present',
  'broke-missing',
  'started-excluded',
  'failed-empty',
  'broke-present',
  'failed-quotes',
  'broke-missing-with-note',
  'failed-present-without-note',
  'broke-final'
];

const harness = vi.hoisted(() => ({
  blobs: [] as CapturedBlob[],
  memoResults: [] as unknown[],
  root: undefined as { unmount: () => void } | undefined
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo<T>(factory: () => T, dependencies: DependencyList) {
      const result = actual.useMemo(factory, dependencies);
      harness.memoResults.push(result);
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

vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const timestampToday = (minute: number) => {
  const value = new Date();
  value.setHours(12, minute, 0, 0);
  return value.toISOString();
};

const sourceEvents = [
  {
    id: 'failed-present',
    type: 'Failed to Start',
    gameId: 'game-1',
    tableId: 'table-1',
    timestamp: timestampToday(1),
    playerCount: 4,
    reason: 'Insufficient demand',
    note: 'Two players cancelled'
  },
  {
    id: 'broke-missing',
    type: 'Broke',
    gameId: 'game-1',
    timestamp: timestampToday(2),
    playerCount: 3,
    note: ''
  },
  {
    id: 'started-excluded',
    type: 'Started',
    gameId: 'game-1',
    timestamp: timestampToday(3),
    playerCount: 7,
    reason: 'Excluded despite reason',
    note: 'Excluded despite note'
  },
  {
    id: 'failed-empty',
    type: 'Failed to Start',
    gameId: 'game-2',
    timestamp: timestampToday(4),
    playerCount: 2,
    reason: '',
    note: 'Weather delay'
  },
  {
    id: 'broke-present',
    type: 'Broke',
    gameId: 'game-2',
    timestamp: timestampToday(5),
    playerCount: 5,
    reason: 'Game switched',
    note: ''
  },
  {
    id: 'failed-quotes',
    type: 'Failed to Start',
    gameId: 'game-3',
    timestamp: timestampToday(6),
    playerCount: 1,
    reason: 'Host said "pause"',
    note: 'Review "call"'
  },
  {
    id: 'broke-missing-with-note',
    type: 'Broke',
    gameId: 'game-3',
    timestamp: timestampToday(7),
    playerCount: 4,
    note: 'Late departure'
  },
  {
    id: 'failed-present-without-note',
    type: 'Failed to Start',
    gameId: 'game-4',
    timestamp: timestampToday(8),
    playerCount: 3,
    reason: 'Dealer unavailable',
    note: ''
  },
  {
    id: 'broke-final',
    type: 'Broke',
    gameId: 'game-4',
    timestamp: timestampToday(9),
    playerCount: 2,
    reason: 'Room closed',
    note: 'End of night'
  }
];

const isReportState = (value: unknown): value is ReportState => {
  if (typeof value !== 'object' || value === null || !('tableEvents' in value)) return false;
  const tableEvents = value.tableEvents;
  return Array.isArray(tableEvents) &&
    tableEvents.length === eventIds.length &&
    tableEvents.every((event, index) =>
      typeof event === 'object' && event !== null && 'id' in event && event.id === eventIds[index]
    );
};

const findEventReasonContainer = () => {
  const heading = Array.from(document.querySelectorAll('h3')).find((element) => element.textContent === 'Event Reasons');
  if (!heading?.parentElement) throw new Error('Event Reasons summary was not rendered.');
  return heading.parentElement;
};

describe('table event report projection', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    const accountKey = 'type-007i-test';
    const stateKey = `table-manager-state-v1:${accountKey}`;

    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '/summary';
    localStorage.clear();
    localStorage.setItem('table-manager-state-v1:last-account', stateKey);
    localStorage.setItem(
      `table-manager-state-v1:auth:${accountKey}`,
      JSON.stringify({ expiresAt, savedAt: '2026-08-07T12:00:00.000Z' })
    );
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        games: [],
        profiles: [],
        tournaments: [],
        interests: [],
        sessions: [],
        playerSessions: [],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [],
        handCountLogs: [],
        timeFeeLogs: [],
        revenueTransactions: [],
        playerLedger: [],
        tableEvents: sourceEvents,
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
            authorizationCode: 'TYPE-007I-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007I-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007i@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007i@example.test',
            passwordSalt: 'local-test-salt',
            passwordHash: 'local-test-hash',
            createdAt: '2026-08-07T12:00:00.000Z'
          }
        }
      })
    );

    class TestBlob {
      readonly parts: BlobPart[];
      readonly type: string;

      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        this.parts = parts;
        this.type = options?.type ?? '';
        harness.blobs.push(this);
      }
    }

    vi.stubGlobal('Blob', TestBlob);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:type-007i');
      static revokeObjectURL = vi.fn();
    }

    vi.stubGlobal('URL', TestUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await act(async () => {
      await Promise.all([
        import('../components/KpisView'),
        import('../components/SummaryView')
      ]);
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders the Summary navigation, period controls, profit metrics, and export actions', () => {
    expect(document.querySelector('h1')?.textContent).toBe('Reports');
    expect(document.querySelector('.page-subtitle')?.textContent).toContain('performance and closeout');
    expect(Array.from(document.querySelectorAll('.topbar-actions button'), (button) => button.textContent?.trim())).toEqual([
      'CSV',
      'Screenshot / Print',
      'Close',
      'Low Light'
    ]);

    const reportModes = document.querySelector('.report-mode-switch');
    expect(reportModes?.getAttribute('aria-label')).toBe('Report view');
    expect(Array.from(reportModes?.querySelectorAll('button') ?? [], (button) => button.textContent)).toEqual([
      'KPIs & statistics',
      "Tonight's report",
      'Night close'
    ]);
    expect(reportModes?.querySelector('button.active')?.textContent).toBe('KPIs & statistics');

    const periodTabs = document.querySelector('.report-period-tabs');
    expect(periodTabs?.getAttribute('aria-label')).toBe('Group reports by');
    expect(Array.from(periodTabs?.querySelectorAll('button') ?? [], (button) => button.textContent)).toEqual([
      'Tonight',
      'Week',
      'Month',
      'Year',
      'All time'
    ]);
    expect(periodTabs?.querySelector('button.active')?.textContent).toBe('Tonight');

    expect(Array.from(document.querySelectorAll('.report-profit-breakdown article span'), (label) => label.textContent)).toEqual([
      'Recorded drop',
      'Time fees',
      'Memberships',
      'Tournaments'
    ]);
    expect(Array.from(document.querySelectorAll('.report-numerical-grid article > span'), (label) => label.textContent)).toEqual([
      'Collection / table-hour',
      'Drop / occupied seat-hour',
      'Hands logged',
      'Hands / table-hour',
      'Table-hours',
      'Best earning hour'
    ]);
    expect(Array.from(document.querySelectorAll('.metric-category-menu button'), (button) => button.textContent)).toEqual([
      'Operations',
      'Waitlist',
      'Tables',
      'Collections'
    ]);
    expect(document.querySelector('.metric-category-menu button.active')?.textContent).toBe('Operations');
  });

  it('renders only the last six matching events in their existing order with stable fallback text', () => {
    const labels = Array.from(findEventReasonContainer().querySelectorAll('span')).map((element) => element.textContent);

    expect(labels).toEqual([
      'Failed to Start: Unspecified - Weather delay',
      'Broke: Game switched',
      'Failed to Start: Host said "pause" - Review "call"',
      'Broke: Unspecified - Late departure',
      'Failed to Start: Dealer unavailable',
      'Broke: Room closed - End of night'
    ]);
  });

  it('exports all matching events in source order with exact CSV escaping and does not mutate source events', () => {
    const reportState = harness.memoResults.find(isReportState);
    expect(reportState).toBeDefined();
    const eventReferences = [...reportState!.tableEvents];
    const eventValues = structuredClone(reportState!.tableEvents);

    const csvButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'CSV');
    expect(csvButton).toBeDefined();
    act(() => csvButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const blob = harness.blobs.at(-1);
    expect(blob?.type).toBe('text/csv');
    const csv = String(blob?.parts[0]);
    expect(csv.split('\n').slice(-8)).toEqual([
      '"Failed to Start reason","Insufficient demand - Two players cancelled"',
      '"Broke reason","Unspecified"',
      '"Failed to Start reason","Unspecified - Weather delay"',
      '"Broke reason","Game switched"',
      '"Failed to Start reason","Host said ""pause"" - Review ""call"""',
      '"Broke reason","Unspecified - Late departure"',
      '"Failed to Start reason","Dealer unavailable"',
      '"Broke reason","Room closed - End of night"'
    ]);
    expect(csv).not.toContain('Excluded despite reason');

    expect(reportState!.tableEvents).toEqual(eventValues);
    reportState!.tableEvents.forEach((event, index) => expect(event).toBe(eventReferences[index]));
    expect(reportState!.tableEvents.every((event) =>
      typeof event.id === 'string' &&
      typeof event.gameId === 'string' &&
      typeof event.timestamp === 'string' &&
      typeof event.playerCount === 'number' &&
      typeof event.note === 'string'
    )).toBe(true);
  });

  it('renders the KPI route heading, actions, and metric order', async () => {
    await act(async () => {
      window.location.hash = '#kpis';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(document.querySelector('.eyebrow')?.textContent).toBe('Operating metrics');
    expect(document.querySelector('h1')?.textContent).toBe('KPIs');
    expect(Array.from(document.querySelectorAll('.topbar-actions button'), (button) => button.textContent?.trim())).toEqual([
      'CSV',
      'Close'
    ]);
    expect(Array.from(document.querySelectorAll('.owner-summary-grid .owner-metric > span'), (label) => label.textContent)).toEqual([
      'Seat-Hours',
      'Active Tables',
      'Average Wait',
      'Conversion',
      'Failed Starts',
      'Table Breaks',
      'Time Fees Est.',
      'Recorded Drop',
      'Drop Est.',
      'Expired Time'
    ]);
  });
});
