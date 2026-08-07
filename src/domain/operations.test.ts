/**
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from './state';
import type { AppState, GameConfig, GameSession, Interest, PlayerProfile, PlayerSession } from './types';

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

type OperationsModule = Pick<
  typeof import('../main'),
  | 'buildAnalyticalReportPayload'
  | 'getAnalytics'
  | 'getAverageStackForTable'
  | 'getClosestGameLabel'
  | 'getDemand'
  | 'getLikelyParticipants'
  | 'getOpenSessions'
  | 'getOperationalOpportunities'
  | 'getOverflowOpportunities'
  | 'getParticipantPool'
  | 'getPlayerLoggedHours'
  | 'getRunningSessions'
  | 'getSessionBuyIns'
  | 'getSessionSeatHours'
  | 'getStaffScripts'
  | 'getTableHealth'
  | 'getUsageAnalytics'
  | 'getViabilityState'
  | 'hasParticipantInterest'
  | 'lacksParticipantInterest'
  | 'renderScriptTemplate'
>;

let operations: OperationsModule;

const game: GameConfig = {
  id: 'game-fixture',
  name: 'Fixture Holdem',
  maxSeats: 8,
  minInRoomForLikely: 2,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};

const profile = (overrides: Partial<PlayerProfile> & Pick<PlayerProfile, 'id' | 'name'>): PlayerProfile => {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    phone: '',
    birthday: '',
    membershipStartDate: '2026-01-01',
    membershipExpirationDate: '2027-01-01',
    totalTimePlayedHours: 0,
    lastSessionTimePlayedHours: 0,
    commonlyPlaysWithProfileIds: [],
    preferredGameId: '',
    preferredGameIds: [],
    gamePlayCounts: {},
    mostPlayedGameId: '',
    preferredStakes: '',
    typicalBuyInMin: 0,
    typicalBuyInMax: 0,
    willingnessToMove: true,
    typicalAvailability: '',
    usualCompanions: [],
    preferredTags: [],
    notes: '',
    ...rest
  };
};

const interest = (overrides: Partial<Interest> & Pick<Interest, 'id' | 'playerName' | 'status'>): Interest => {
  const { id, playerName, status, ...rest } = overrides;
  return {
    id,
    playerName,
    gameId: game.id,
    status,
    timestamp: '2026-08-07T19:00:00.000Z',
    interestedAt: '2026-08-07T19:00:00.000Z',
    notes: '',
    ...rest
  };
};

const runningTable: GameSession = {
  id: 'table-running',
  gameId: game.id,
  label: 'Main Table',
  status: 'Running',
  seatsFilled: 8,
  maxSeats: 8,
  collectionMode: 'Time',
  tags: ['Social'],
  startedAt: '2026-08-07T20:00:00.000Z'
};

const demandInterests: Interest[] = [
  interest({ id: 'interest-arrived', profileId: 'profile-active', playerName: 'Arrived Player', status: 'Arrived', arrivedAt: '2026-08-07T20:00:00.000Z' }),
  interest({ id: 'interest-seated', playerName: 'Seated Player', status: 'Seated', arrivedAt: '2026-08-07T20:00:00.000Z', seatedAt: '2026-08-07T20:30:00.000Z' }),
  interest({ id: 'interest-confirmed', profileId: 'profile-target', playerName: 'Target Player', status: 'Confirmed Coming', confirmedAt: '2026-08-07T19:30:00.000Z' }),
  interest({ id: 'interest-interested', profileId: 'profile-low', playerName: 'Low Player', status: 'Interested' }),
  interest({ id: 'interest-removed', playerName: 'Removed Player', status: 'Removed' })
];

const buildDemandState = (): AppState => ({
  ...structuredClone(seedState),
  games: [game],
  interests: structuredClone(demandInterests),
  profiles: [
    profile({ id: 'profile-active', name: 'Arrived Player', preferredGameId: game.id, preferredGameIds: [game.id], typicalBuyInMin: 200, typicalBuyInMax: 200 }),
    profile({
      id: 'profile-target',
      name: 'Target Player',
      preferredGameId: game.id,
      preferredGameIds: [game.id],
      typicalBuyInMin: 200,
      typicalBuyInMax: 400,
      usualCompanions: ['Arrived Player'],
      preferredTags: ['Social']
    }),
    profile({ id: 'profile-low', name: 'Low Player', typicalBuyInMin: 100, typicalBuyInMax: 100 })
  ],
  sessions: [runningTable],
  playerSessions: [],
  buyIns: [],
  dropLogs: [],
  tableEvents: [],
  history: [],
  usageEvents: [],
  feedback: [],
  settings: {
    ...structuredClone(seedState.settings),
    collectionProfiles: [{ gameId: game.id, collectionMode: 'Time', hourlyFee: 12, estimatedDropPerSeatHour: 5 }]
  }
});

const buildAnalyticsState = (): AppState => {
  const closedTable: GameSession = {
    id: 'table-closed',
    gameId: game.id,
    label: 'Side Table',
    status: 'Closed',
    seatsFilled: 2,
    maxSeats: 8,
    collectionMode: 'Drop',
    tags: [],
    startedAt: '2026-08-07T18:00:00.000Z',
    endedAt: '2026-08-07T20:00:00.000Z'
  };
  const state = buildDemandState();
  return {
    ...state,
    interests: [
      interest({
        id: 'interest-confirmed',
        playerName: 'Confirmed Player',
        status: 'Confirmed Coming',
        confirmedAt: '2026-08-07T19:15:00.000Z',
        arrivedAt: '2026-08-07T20:00:00.000Z',
        seatedAt: '2026-08-07T20:30:00.000Z'
      }),
      interest({ id: 'interest-no-show', playerName: 'No Show', status: 'No-Show' }),
      interest({ id: 'interest-declined', playerName: 'Declined', status: 'Declined' }),
      interest({ id: 'interest-left', playerName: 'Left', status: 'Left Before Seated', arrivedAt: '2026-08-07T20:00:00.000Z' }),
      interest({ id: 'interest-removed', playerName: 'Removed', status: 'Removed' })
    ],
    sessions: [{ ...runningTable, seatsFilled: 4 }, closedTable],
    playerSessions: [
      {
        id: 'player-current',
        profileId: 'profile-current',
        playerName: 'Current Player',
        gameId: game.id,
        tableId: runningTable.id,
        seatedAt: '2026-08-07T20:00:00.000Z',
        timePurchasedMinutes: 60,
        timeRemainingMinutes: 0,
        lastTimeTickAt: '2026-08-07T20:00:00.000Z',
        timeFeeEnabled: true
      },
      {
        id: 'player-closed',
        playerName: 'Closed Player',
        gameId: game.id,
        tableId: closedTable.id,
        seatedAt: '2026-08-07T18:30:00.000Z',
        leftAt: '2026-08-07T19:30:00.000Z'
      }
    ],
    dropLogs: [{ id: 'drop-one', tableId: closedTable.id, gameId: game.id, amount: 40, timestamp: '2026-08-07T20:00:00.000Z' }],
    tableEvents: [
      { id: 'event-failed', type: 'Failed to Start', gameId: game.id, timestamp: '2026-08-07T17:00:00.000Z', playerCount: 3, note: '' },
      { id: 'event-broke', type: 'Broke', gameId: game.id, tableId: closedTable.id, timestamp: '2026-08-07T20:00:00.000Z', playerCount: 2, note: '' },
      { id: 'event-closed', type: 'Closed', gameId: game.id, tableId: closedTable.id, timestamp: '2026-08-07T20:01:00.000Z', playerCount: 2, note: '' }
    ],
    history: [{
      id: 'night-history',
      date: '2026-08-06',
      occupiedSeatHours: 10,
      gamesStarted: 2,
      averageSessionDurationHours: 2,
      averageActiveTables: 3,
      waitlistConversionRate: 0.5,
      hadTwoPlusTables: true
    }],
    usageEvents: [
      { id: 'usage-new', feature: 'Floor', action: 'Opened', route: 'floor', timestamp: '2026-08-07T21:00:00.000Z', staffId: 'staff-one', staffName: 'Alice', staffRole: 'Floor', accountKey: 'fixture' },
      { id: 'usage-mid', feature: 'Floor', action: 'Opened', route: 'floor', timestamp: '2026-08-05T22:00:00.000Z', staffId: 'staff-one', staffName: 'Alice', staffRole: 'Floor', accountKey: 'fixture' },
      { id: 'usage-old', feature: 'Reports', action: 'Exported', route: 'kpis', timestamp: '2026-07-30T21:00:00.000Z', accountKey: 'fixture' }
    ],
    feedback: [{ id: 'feedback-one', role: 'Staff', text: 'Fixture feedback', createdAt: '2026-08-07T21:30:00.000Z' }],
    settings: {
      ...state.settings,
      clubAccount: { clubName: 'Fixture Club', accountName: 'Fixture Account', contactName: 'Casey', email: 'casey@example.test', phone: '', address: '' },
      pilotAccess: {
        authorized: true,
        authorizationCode: 'AUTHORIZATION-CODE',
        expiresAt: '2099-12-31',
        activatedAt: '2026-08-07T12:00:00.000Z',
        licenseId: 'LICENSE-FIXTURE'
      }
    }
  };
};

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>';
  operations = await import('../main');
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('management operational domain projections', () => {
  it('preserves demand, table viability, overflow, scripts, and session-ledger calculations', () => {
    const state = buildDemandState();
    const demand = operations.getDemand(game, state.interests);

    expect(demand).toEqual({
      inRoom: 2,
      confirmed: 1,
      interested: 1,
      waiting: 1,
      flexibleDemand: 3,
      totalDemand: 5,
      likely: true,
      needs: 1,
      status: 'Likely to Start'
    });
    expect(operations.getRunningSessions(state, game.id).map((session) => session.id)).toEqual([runningTable.id]);
    expect(operations.getOpenSessions(state, game.id).map((session) => session.id)).toEqual([runningTable.id]);
    expect(operations.getViabilityState(state, game)).toEqual({ state: 'Likely to Start', nextStep: 'Second table likely' });
    expect(operations.getTableHealth(state, runningTable)).toBe('Healthy');
    expect(operations.getTableHealth(state, { ...runningTable, status: 'Forming' })).toBe('Building');
    expect(operations.getTableHealth({ ...state, interests: [] }, { ...runningTable, seatsFilled: 3 })).toBe('Fragile');
    expect(operations.getOverflowOpportunities(state)).toEqual([{ game, demand, fullTables: [runningTable], label: 'Fixture Holdem full - 3 waiting/interested - second table possible' }]);
    expect(operations.getClosestGameLabel(state)).toBe('Fixture Holdem likely');
    expect(operations.renderScriptTemplate('{game}:{inRoom}:{coming}:{waiting}:{needs}', game, demand)).toBe('Fixture Holdem:2:1:2:1');
    expect(operations.getStaffScripts(state)).toEqual([
      { label: 'Fixture Holdem: current demand', text: 'Current Fixture Holdem has 2 in the room, 1 coming, and 2 waiting or interested.' },
      { label: 'Fixture Holdem: overflow', text: 'Current Fixture Holdem is full, but overflow is building with 2 waiting or interested.' },
      { label: 'Fixture Holdem: needs more', text: "We're building Fixture Holdem, but need 1 more player(s) before it is realistic." }
    ]);

    const currentPlayer: PlayerSession = {
      id: 'player-current',
      profileId: 'profile-current',
      playerName: 'Current Player',
      gameId: game.id,
      tableId: runningTable.id,
      seatedAt: '2026-08-07T20:00:00.000Z'
    };
    const otherPlayer: PlayerSession = {
      id: 'player-other',
      profileId: 'profile-other',
      playerName: 'Other Player',
      gameId: game.id,
      tableId: runningTable.id,
      seatedAt: '2026-08-07T21:00:00.000Z'
    };
    const helperState: AppState = {
      ...state,
      playerSessions: [
        currentPlayer,
        otherPlayer,
        { ...currentPlayer, id: 'player-prior', tableId: 'table-prior', seatedAt: '2026-08-06T20:00:00.000Z', leftAt: '2026-08-06T21:00:00.000Z' }
      ],
      buyIns: [
        { id: 'buy-current', profileId: currentPlayer.profileId, playerName: currentPlayer.playerName, tableId: runningTable.id, gameId: game.id, amount: 200, timestamp: '2026-08-07T20:00:00.000Z' },
        { id: 'buy-other', profileId: otherPlayer.profileId, playerName: otherPlayer.playerName, tableId: runningTable.id, gameId: game.id, amount: 100, timestamp: '2026-08-07T21:00:00.000Z' },
        { id: 'buy-wrong-profile', profileId: 'profile-wrong', playerName: currentPlayer.playerName, tableId: runningTable.id, gameId: game.id, amount: 999, timestamp: '2026-08-07T21:00:00.000Z' }
      ]
    };
    expect(operations.getPlayerLoggedHours(helperState, currentPlayer)).toEqual({ tonight: 2, total: 3 });
    expect(operations.getSessionBuyIns(helperState, currentPlayer).map((entry) => entry.id)).toEqual(['buy-current']);
    expect(operations.getAverageStackForTable(helperState, runningTable.id)).toBe(150);
    expect(operations.getSessionSeatHours(helperState, runningTable)).toBe(3);
  });

  it('preserves participant scoring, ordering, identity, reasons, and immutability', () => {
    const state = buildDemandState();
    const before = structuredClone(state);
    const pool = operations.getParticipantPool(state, game.id, 3);

    expect(pool.map((candidate) => ({ id: candidate.id, confidence: candidate.confidence, reasons: candidate.reasons }))).toEqual([
      { id: 'interest-arrived', confidence: 130, reasons: ['Arrived', 'game/stakes fit', '$200 typical buy-in'] },
      { id: 'interest-confirmed', confidence: 122, reasons: ['Confirmed Coming', 'game/stakes fit', 'fits Social', 'connected to Arrived Player', '$300 typical buy-in'] },
      { id: 'interest-interested', confidence: 87, reasons: ['Interested', 'game/stakes fit', '$100 typical buy-in'] }
    ]);
    expect(pool.every(operations.hasParticipantInterest)).toBe(true);
    expect(pool.some(operations.lacksParticipantInterest)).toBe(false);

    const likely = operations.getLikelyParticipants(state);
    expect(likely[0]).toEqual({
      id: `profile-target-${game.id}`,
      profile: state.profiles[1],
      game,
      confidence: 119,
      reason: ['prefers Fixture Holdem', 'fits Social', '5 already interested', 'connected to Arrived Player', 'needs 1'],
      message: 'Target Player, Fixture Holdem is close to forming. 5 players are already in or interested. Would you want a seat if it starts?'
    });
    expect(likely.map((candidate) => candidate.profile.id)).not.toContain('profile-active');
    expect(state).toEqual(before);
  });

  it('preserves operational analytics, usage aggregation, report payloads, and opportunity ordering', () => {
    const state = buildAnalyticsState();
    const before = structuredClone(state);
    const analytics = operations.getAnalytics(state);

    expect(analytics).toMatchObject({
      currentNight: {
        id: 'current',
        date: '2026-08-07',
        occupiedSeatHours: 12,
        gamesStarted: 1,
        averageSessionDurationHours: 2,
        averageActiveTables: 1,
        waitlistConversionRate: 0.25,
        hadTwoPlusTables: false
      },
      activeTables: 1,
      averageSeatsOccupied: 4,
      averageSeatHoursPerPlayer: 1.5,
      averageWaitMinutes: 30,
      medianWaitMinutes: 30,
      averageInterestToArrivalMinutes: 60,
      conversionRate: 0.25,
      noShowRate: 0.25,
      declineRate: 0.25,
      leftBeforeSeatedRate: 0.25,
      noShows: 1,
      declined: 1,
      leftBeforeSeated: 1,
      confirmedArrivalRate: 1,
      waitlistAbandonmentCount: 2,
      lostSeatHourEstimate: 3.5,
      failedStarts: 1,
      tableBreaks: 2,
      secondTablesStarted: 1,
      totalArrivals: 2,
      peakWaitlistPressure: 0,
      estimatedTimeFeeRevenue: 12,
      expiredTimeFeeSeats: 1,
      recordedDropTotal: 40,
      estimatedDropRevenue: 5,
      peakActiveTables: 3,
      peakInterestedByGame: { game: 'Fixture Holdem', count: 1 }
    });
    expect(analytics.seatHoursByGame).toEqual([{ game: 'Fixture Holdem', hours: 3 }]);
    expect(analytics.seatHoursByTable).toEqual([
      { table: 'Main Table', game: 'Fixture Holdem', hours: 2 },
      { table: 'Side Table', game: 'Fixture Holdem', hours: 1 }
    ]);
    expect(analytics.collectionValueByGame).toEqual([{ game: 'Fixture Holdem', timeRevenue: 12, recordedDrop: 40, estimatedDrop: 5 }]);
    expect(analytics.waitByGame).toEqual([{ game: 'Fixture Holdem', averageMinutes: 30, count: 1 }]);
    expect(operations.getOperationalOpportunities(state, analytics)).toEqual([
      'High wait with low conversion: reduce uncertainty for incoming players.',
      'Table breaks above normal: review late-night sustainability.'
    ]);

    const usage = operations.getUsageAnalytics(state);
    expect(usage.totalEvents).toBe(3);
    expect(usage.eventsLast24Hours).toBe(1);
    expect(usage.eventsLast7Days).toBe(2);
    expect(usage.eventsByFeature).toEqual([
      { feature: 'Floor', count: 2, lastUsedAt: '2026-08-07T21:00:00.000Z' },
      { feature: 'Reports', count: 1, lastUsedAt: '2026-07-30T21:00:00.000Z' }
    ]);
    expect(usage.eventsByAction.map((entry) => ({ key: entry.key, count: entry.count }))).toEqual([
      { key: 'Floor:Opened', count: 2 },
      { key: 'Reports:Exported', count: 1 }
    ]);
    expect(usage.eventsByStaff.map((entry) => ({ key: entry.key, count: entry.count }))).toEqual([
      { key: 'staff-one', count: 2 },
      { key: 'unassigned', count: 1 }
    ]);
    expect(usage.recentEvents.map((event) => event.id)).toEqual(['usage-new', 'usage-mid', 'usage-old']);

    const report = operations.buildAnalyticalReportPayload(state, analytics, usage);
    expect(report.generatedAt).toBe('2026-08-07T22:00:00.000Z');
    expect(report.account).toEqual({
      accountKey: 'license-fixture',
      clubName: 'Fixture Club',
      accountName: 'Fixture Account',
      contactName: 'Casey',
      email: 'casey@example.test',
      license: 'LICENSE-FIXTURE'
    });
    expect(report.operational).toEqual({
      occupiedSeatHours: 12,
      averageWaitMinutes: 30,
      waitlistConversionRate: 25,
      gamesStarted: 1,
      tableBreaks: 2,
      failedStarts: 1,
      medianWaitMinutes: 30,
      noShows: 1,
      declined: 1,
      leftBeforeSeated: 1,
      confirmedArrivalRate: 100,
      lostSeatHourEstimate: 3.5,
      secondTablesStarted: 1,
      totalArrivals: 2,
      activeTables: 1,
      estimatedTimeFeeRevenue: 12,
      expiredTimeFeeSeats: 1,
      recordedDropTotal: 40,
      estimatedDropRevenue: 5
    });
    expect(report.collectionByGame).toEqual(analytics.collectionValueByGame);
    expect(report.usage.totalEvents).toBe(3);
    expect(report.feedback).toEqual(state.feedback);
    expect(state).toEqual(before);
  });
});
