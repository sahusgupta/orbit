/**
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from './state';
import type { AppState, GameSession, PlayerSession } from './types';

vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render: vi.fn() })
}));
vi.mock('../lib/firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('../lib/firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

type ReportingModule = Pick<
  typeof import('../main'),
  | 'getDealerReport'
  | 'getReportFinancials'
  | 'getReportHourlyBreakdown'
  | 'getReportState'
  | 'getReportWindow'
  | 'getTableFinancialOverview'
  | 'getTablePlayerFinancialOverview'
  | 'shiftReportAnchor'
  | 'timestampInReportWindow'
>;

let reporting: ReportingModule;

const reportWindow = {
  startMs: Date.parse('2026-08-07T00:00:00.000Z'),
  endMs: Date.parse('2026-08-08T00:00:00.000Z'),
  label: 'fixture day'
};

const table: GameSession = {
  id: 'table-one',
  gameId: 'game-one',
  label: 'Table One',
  status: 'Closed',
  seatsFilled: 2,
  maxSeats: 8,
  collectionMode: 'Time',
  timeFeeBased: true,
  tags: [],
  startedAt: '2026-08-07T09:30:00.000Z',
  endedAt: '2026-08-07T13:00:00.000Z'
};

const exactPlayer: PlayerSession = {
  id: 'player-session-exact',
  profileId: 'profile-exact',
  playerName: 'Exact Player',
  gameId: 'game-one',
  tableId: table.id,
  seatNumber: 1,
  seatedAt: '2026-08-07T10:00:00.000Z',
  leftAt: '2026-08-07T12:00:00.000Z',
  timePurchasedMinutes: 60,
  lastTimeTickAt: '2026-08-07T10:15:00.000Z',
  timeFeeEnabled: true
};

const legacyPlayer: PlayerSession = {
  id: 'player-session-legacy',
  profileId: 'profile-legacy',
  playerName: 'Legacy Player',
  gameId: 'game-one',
  tableId: table.id,
  seatNumber: 2,
  seatedAt: '2026-08-07T11:00:00.000Z',
  leftAt: '2026-08-07T12:30:00.000Z',
  timePurchasedMinutes: 30,
  lastTimeTickAt: '2026-08-07T11:20:00.000Z',
  timeFeeEnabled: true
};

const buildState = (): AppState => ({
  ...structuredClone(seedState),
  games: [{
    id: 'game-one',
    name: 'Game One',
    maxSeats: 8,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  }],
  tournaments: [],
  sessions: [table],
  playerSessions: [exactPlayer, legacyPlayer],
  buyIns: [
    { id: 'buy-exact', profileId: exactPlayer.profileId, playerName: exactPlayer.playerName, tableId: table.id, gameId: table.gameId, amount: 200, timestamp: '2026-08-07T10:05:00.000Z' },
    { id: 'buy-legacy', profileId: legacyPlayer.profileId, playerName: legacyPlayer.playerName, tableId: table.id, gameId: table.gameId, amount: 100, timestamp: '2026-08-07T11:05:00.000Z' }
  ],
  playerLedger: [{
    id: 'cashout-exact',
    type: 'Cash-Out',
    profileId: exactPlayer.profileId,
    playerName: exactPlayer.playerName,
    tableId: table.id,
    gameId: table.gameId,
    amount: 180,
    timestamp: '2026-08-07T12:00:00.000Z'
  }],
  dropLogs: [
    { id: 'drop-current', tableId: table.id, gameId: table.gameId, amount: 50, timestamp: '2026-08-07T10:30:00.000Z' },
    { id: 'drop-outside', tableId: table.id, gameId: table.gameId, amount: 99, timestamp: '2026-08-08T00:00:00.000Z' }
  ],
  timeFeeLogs: [{
    id: 'time-exact',
    playerSessionId: exactPlayer.id,
    tableId: table.id,
    gameId: table.gameId,
    playerName: exactPlayer.playerName,
    minutes: 60,
    amount: 12,
    timestamp: '2026-08-07T10:15:00.000Z'
  }],
  revenueTransactions: [
    { id: 'membership', type: 'membership', amountCents: 4000, occurredAt: '2026-08-07T12:10:00.000Z', paymentStatus: 'paid', source: 'stripe' },
    { id: 'tournament', type: 'tournament_entry', amountCents: 10_000, occurredAt: '2026-08-07T12:20:00.000Z', paymentStatus: 'paid', source: 'stripe' },
    { id: 'time-package', type: 'time-package', amountCents: 2500, occurredAt: '2026-08-07T12:30:00.000Z', paymentStatus: 'paid', source: 'stripe' },
    { id: 'refund', type: 'refund', amountCents: 1000, occurredAt: '2026-08-07T12:40:00.000Z', paymentStatus: 'paid', source: 'stripe' },
    { id: 'pending', type: 'other', amountCents: 9000, occurredAt: '2026-08-07T12:50:00.000Z', paymentStatus: 'pending', source: 'manual' }
  ],
  dealerAssignments: [
    { id: 'dealer-a', tableId: table.id, gameId: table.gameId, dealerName: 'Dealer A', startedAt: '2026-08-07T10:00:00.000Z', endedAt: '2026-08-07T12:00:00.000Z' },
    { id: 'dealer-b', tableId: 'table-two', gameId: table.gameId, dealerName: 'Dealer B', startedAt: '2026-08-07T10:00:00.000Z', endedAt: '2026-08-07T11:00:00.000Z' }
  ],
  handCountLogs: [
    { id: 'hands-a', tableId: table.id, gameId: table.gameId, hands: 20, timestamp: '2026-08-07T10:30:00.000Z' },
    { id: 'hands-b', tableId: 'table-two', gameId: table.gameId, hands: 12, timestamp: '2026-08-07T10:45:00.000Z' }
  ],
  settings: {
    ...structuredClone(seedState.settings),
    collectionProfiles: [{ gameId: 'game-one', collectionMode: 'Time', hourlyFee: 12, estimatedDropPerSeatHour: 0 }]
  }
});

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  reporting = await import('../main');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T21:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('management reporting projections', () => {
  it('uses half-open report windows and shifts anchors without changing all-history anchors', () => {
    const day = reporting.getReportWindow('day', '2026-08-07');
    const week = reporting.getReportWindow('week', '2026-08-07');

    expect(new Date(day.startMs).getHours()).toBe(0);
    expect(day.endMs - day.startMs).toBe(24 * 60 * 60 * 1000);
    expect(new Date(week.startMs).getDay()).toBe(1);
    expect(week.endMs - week.startMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(reporting.timestampInReportWindow(new Date(day.startMs).toISOString(), day)).toBe(true);
    expect(reporting.timestampInReportWindow(new Date(day.endMs).toISOString(), day)).toBe(false);
    expect(reporting.timestampInReportWindow('not-a-date', day)).toBe(false);
    expect(reporting.shiftReportAnchor('2026-08-07', 'day', 1)).toBe('2026-08-08');
    expect(reporting.shiftReportAnchor('2026-08-07', 'week', -1)).toBe('2026-07-31');
    expect(reporting.shiftReportAnchor('2026-08-07', 'all', 1)).toBe('2026-08-07');
  });

  it('projects financial totals, legacy time fees, hourly buckets, and player/table ledgers without mutating state', () => {
    const state = buildState();
    const snapshot = structuredClone(state);
    const financials = reporting.getReportFinancials(state, reportWindow);

    expect(financials).toMatchObject({
      recordedDrop: 50,
      timeFees: 18,
      membershipRevenue: 40,
      tournamentRevenue: 100,
      otherRevenue: 15,
      totalProfit: 223,
      collectionByGame: [{ game: 'Game One', recordedDrop: 50, timeFees: 18 }]
    });
    expect(financials.timeFeeEntries).toEqual([
      { gameId: 'game-one', tableId: 'table-one', amount: 12, timestamp: '2026-08-07T10:15:00.000Z' },
      { gameId: 'game-one', tableId: 'table-one', amount: 6, timestamp: '2026-08-07T11:20:00.000Z' }
    ]);
    expect(financials.paidRevenue.map((entry) => entry.id)).toEqual(['membership', 'tournament', 'time-package', 'refund']);
    expect(reporting.getTableFinancialOverview(state, table)).toEqual({
      totalBuyIns: 300,
      totalCashOuts: 180,
      totalDrop: 149,
      totalTimeFees: 18,
      tableProfit: 167,
      cashInPlay: -29
    });
    expect(reporting.getTablePlayerFinancialOverview(state, table, exactPlayer)).toEqual({
      totalBuyIns: 200,
      totalCashOuts: 180,
      totalTimeFees: 12
    });
    expect(reporting.getTablePlayerFinancialOverview(state, table, legacyPlayer)).toEqual({
      totalBuyIns: 100,
      totalCashOuts: 0,
      totalTimeFees: 6
    });
    expect(reporting.getReportHourlyBreakdown(state, reportWindow, financials)).toEqual([
      { startMs: Date.parse('2026-08-07T10:00:00.000Z'), drop: 50, timeFees: 12, otherRevenue: 0, total: 62 },
      { startMs: Date.parse('2026-08-07T11:00:00.000Z'), drop: 0, timeFees: 6, otherRevenue: 0, total: 6 },
      { startMs: Date.parse('2026-08-07T12:00:00.000Z'), drop: 0, timeFees: 0, otherRevenue: 155, total: 155 }
    ]);
    expect(state).toEqual(snapshot);
  });

  it('clips overlapping activity, filters timestamped collections, and aggregates dealer performance in order', () => {
    const state = buildState();
    state.sessions = [
      { ...table, id: 'overlap', startedAt: '2026-08-06T23:00:00.000Z', endedAt: '2026-08-07T01:00:00.000Z' },
      { ...table, id: 'outside', startedAt: '2026-08-08T00:00:00.000Z', endedAt: '2026-08-08T01:00:00.000Z' }
    ];
    state.playerSessions = [
      { ...exactPlayer, id: 'overlap-player', tableId: 'overlap', seatedAt: '2026-08-06T23:30:00.000Z', leftAt: '2026-08-07T00:30:00.000Z' }
    ];
    state.interests = [{
      id: 'interest-current', playerName: 'Current', gameId: 'game-one', status: 'Interested', timestamp: '2026-08-07T09:00:00.000Z', interestedAt: '2026-08-07T09:00:00.000Z', notes: ''
    }, {
      id: 'interest-outside', playerName: 'Outside', gameId: 'game-one', status: 'Interested', timestamp: '2026-08-08T09:00:00.000Z', interestedAt: '2026-08-08T09:00:00.000Z', notes: ''
    }];
    const projected = reporting.getReportState(state, reportWindow);

    expect(projected.sessions).toEqual([expect.objectContaining({
      id: 'overlap',
      startedAt: '2026-08-07T00:00:00.000Z',
      endedAt: '2026-08-07T01:00:00.000Z',
      status: 'Closed'
    })]);
    expect(projected.playerSessions).toEqual([expect.objectContaining({
      id: 'overlap-player',
      seatedAt: '2026-08-07T00:00:00.000Z',
      leftAt: '2026-08-07T00:30:00.000Z'
    })]);
    expect(projected.interests.map((interest) => interest.id)).toEqual(['interest-current']);
    expect(projected.dropLogs.map((entry) => entry.id)).toEqual(['drop-current']);
    expect(reporting.getDealerReport(buildState(), reportWindow)).toEqual([
      { dealerName: 'Dealer A', hours: 2, tables: 1, hands: 20, handsPerHour: 10 },
      { dealerName: 'Dealer B', hours: 1, tables: 1, hands: 12, handsPerHour: 12 }
    ]);
  });
});
