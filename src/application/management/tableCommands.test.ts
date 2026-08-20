import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, Interest, PlayerProfile, PlayerSession } from '../../domain/types';
import {
  applyDefaultTableCap,
  createBalancedTable,
  createDemandFormingTable,
  createFormingTable,
  createPhysicalTable,
  createPlannedTable,
  startTableWithPlayers,
  switchRunningTableGame
} from './tableCommands';

const now = '2026-08-08T23:00:00.000Z';
const game = {
  id: 'game-table',
  name: 'Table Holdem',
  maxSeats: 4,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 4
};
const otherGame = { ...game, id: 'game-other', name: 'Other Omaha', maxSeats: 6 };
const runningTable: GameSession = {
  id: 'table-running',
  gameId: otherGame.id,
  label: 'Running Alternate',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: otherGame.maxSeats,
  collectionMode: 'Time',
  timeFeeBased: true,
  plannedPlayerIds: ['interest-keep', 'interest-move'],
  tags: [],
  startedAt: '2026-08-08T20:00:00.000Z',
  manualEdits: { label: '2026-08-08T20:05:00.000Z' }
};
const profile = (id: string, name: string): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: {},
  mostPlayedGameId: game.id,
  preferredStakes: game.name,
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: true,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: ''
});
const interest = (id: string, name: string, status: Interest['status'] = 'Arrived'): Interest => ({
  id,
  profileId: `profile-${id}`,
  playerName: name,
  gameId: game.id,
  status,
  timestamp: '2026-08-08T22:00:00.000Z',
  interestedAt: '2026-08-08T21:30:00.000Z',
  notes: ''
});
const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [game, otherGame],
  profiles: [],
  interests: [],
  sessions: [],
  playerSessions: [],
  tableEvents: [],
  correctionLog: [],
  settings: {
    ...structuredClone(seedState.settings),
    defaultCollectionMode: 'Drop',
    collectionProfiles: [{ gameId: game.id, collectionMode: 'Drop', hourlyFee: 0, estimatedDropPerSeatHour: 5 }]
  },
  ...overrides
});
const dependencies = () => {
  let nextId = 0;
  return { createId: () => `created-${++nextId}`, nowIso: () => now };
};

describe('management table-planning commands', () => {
  it('adds a normalized permanent table without mutating state or duplicating its identity', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const created = createPhysicalTable(source, '  Table 1  ', 8, dependencies());

    expect(created?.physicalTable).toEqual({
      id: 'created-1',
      label: 'Table 1',
      maxSeats: 8,
      createdAt: now
    });
    expect(created?.state.physicalTables).toEqual([created?.physicalTable]);
    expect(createPhysicalTable(created!.state, 'table 1', 10, dependencies())).toBeNull();
    expect(createPhysicalTable(source, ' ', 10, dependencies())).toBeNull();
    expect(source).toEqual(snapshot);
  });

  it('creates normal and demand forming tables with exact IDs, defaults, draft candidates, and clock sharing', () => {
    const open = [
      interest('one', 'One'),
      interest('two', 'Two', 'Confirmed Coming'),
      interest('closed', 'Closed', 'Declined')
    ];
    const source = state({ interests: open });
    const snapshot = structuredClone(source);

    const normal = createFormingTable(source, game.id, dependencies());
    const demand = createDemandFormingTable(source, game.id, 'Demand prompt', dependencies());

    expect(normal).not.toBeNull();
    expect(demand).not.toBeNull();
    if (!normal || !demand) return;
    expect(normal.sessionId).toBe('created-1');
    expect(normal.defaultStartPlayerIds).toEqual(['one', 'two']);
    expect(normal.state.sessions[0]).toMatchObject({
      id: 'created-1',
      label: 'Main Table',
      status: 'Forming',
      collectionMode: 'Drop',
      startedAt: now
    });
    expect(normal.state.tableEvents[0]).toMatchObject({ id: 'created-2', type: 'Created', timestamp: now, note: 'Table forming' });
    expect(demand.state.sessions[0]).toMatchObject({ id: 'created-1', startedAt: now });
    expect(demand.state.tableEvents[0]).toMatchObject({ id: 'created-2', timestamp: now, note: 'Demand prompt' });
    expect(createFormingTable(source, 'missing-game', dependencies())).toBeNull();
    expect(source).toEqual(snapshot);
  });

  it('binds a new game session to an available permanent physical table without reusing the session identity', () => {
    const physicalTable = {
      id: 'physical-table-1',
      label: 'Table 1',
      maxSeats: 6 as const,
      createdAt: '2026-08-01T12:00:00.000Z'
    };
    const source = state({ physicalTables: [physicalTable] });
    const sharedDependencies = dependencies();

    const created = createFormingTable(source, game.id, sharedDependencies, physicalTable.id);

    expect(created?.state.sessions[0]).toMatchObject({
      id: 'created-1',
      physicalTableId: physicalTable.id,
      label: physicalTable.label,
      gameId: game.id,
      status: 'Forming'
    });
    expect(created?.state.physicalTables).toEqual([physicalTable]);
    expect(created?.sessionId).not.toBe(physicalTable.id);

    const occupiedState = state({
      physicalTables: [physicalTable],
      sessions: [{
        ...runningTable,
        physicalTableId: physicalTable.id
      }]
    });
    expect(createFormingTable(occupiedState, game.id, dependencies(), physicalTable.id)).toBeNull();
    expect(createFormingTable(occupiedState, game.id, dependencies())).toBeNull();
    expect(createDemandFormingTable(occupiedState, game.id, 'Demand prompt', dependencies())).toBeNull();
    expect(createDemandFormingTable(source, game.id, 'Demand prompt', dependencies(), 'missing-table')).toBeNull();

    const closedState = {
      ...created!.state,
      sessions: created!.state.sessions.map((session) => ({ ...session, status: 'Closed' as const, endedAt: now }))
    };
    const nextRun = createFormingTable(closedState, game.id, sharedDependencies, physicalTable.id);
    expect(nextRun?.sessionId).not.toBe(created?.sessionId);
    expect(nextRun?.state.sessions.at(-1)).toMatchObject({
      physicalTableId: physicalTable.id,
      label: 'Table 1',
      status: 'Forming'
    });
  });

  it('automatically uses the first unoccupied permanent table for normal and demand creation', () => {
    const occupiedPhysicalTable = {
      id: 'physical-table-1',
      label: 'Table 1',
      maxSeats: 6 as const,
      createdAt: '2026-08-01T12:00:00.000Z'
    };
    const availablePhysicalTable = {
      id: 'physical-table-2',
      label: 'Table 2',
      maxSeats: 8 as const,
      createdAt: '2026-08-01T12:01:00.000Z'
    };
    const source = state({
      physicalTables: [occupiedPhysicalTable, availablePhysicalTable],
      sessions: [{ ...runningTable, physicalTableId: occupiedPhysicalTable.id }]
    });

    const normal = createFormingTable(source, game.id, dependencies());
    const demand = createDemandFormingTable(source, game.id, 'Demand prompt', dependencies());

    expect(normal?.state.sessions.at(-1)).toMatchObject({
      id: 'created-1',
      physicalTableId: availablePhysicalTable.id,
      label: availablePhysicalTable.label
    });
    expect(demand?.state.sessions.at(-1)).toMatchObject({
      id: 'created-1',
      physicalTableId: availablePhysicalTable.id,
      label: availablePhysicalTable.label
    });
    expect(normal?.sessionId).not.toBe(availablePhysicalTable.id);
  });

  it('switches the first alternate running table and propagates collection to only its open players', () => {
    const openPlayer: PlayerSession = {
      id: 'session-open',
      playerName: 'Open Player',
      gameId: otherGame.id,
      tableId: runningTable.id,
      seatNumber: 1,
      seatedAt: '2026-08-08T21:00:00.000Z',
      timeFeeEnabled: true
    };
    const closedPlayer = { ...openPlayer, id: 'session-closed', leftAt: '2026-08-08T22:00:00.000Z' };
    const source = state({ sessions: [runningTable], playerSessions: [openPlayer, closedPlayer] });
    const snapshot = structuredClone(source);

    const result = switchRunningTableGame(source, game.id, dependencies());

    expect(result.switchedTableId).toBe(runningTable.id);
    expect(result.state.sessions[0]).toEqual({
      ...runningTable,
      gameId: game.id,
      maxSeats: game.maxSeats,
      collectionMode: 'Drop',
      timeFeeBased: false,
      manualEdits: { label: '2026-08-08T20:05:00.000Z', gameId: now }
    });
    expect(result.state.playerSessions[0]).toEqual({
      ...openPlayer,
      gameId: game.id,
      timeFeeEnabled: false,
      manualEdits: { gameId: now }
    });
    expect(result.state.playerSessions[1]).toBe(source.playerSessions[1]);
    expect(result.state.tableEvents[0]).toMatchObject({
      id: 'created-1',
      type: 'Merged',
      gameId: game.id,
      reason: 'game switched'
    });
    expect(source).toEqual(snapshot);
  });

  it('keeps a switched game and global table-cap updates within the bound physical-table capacity', () => {
    const physicalTable = {
      id: 'physical-table-1',
      label: 'Table 1',
      maxSeats: 6 as const,
      createdAt: '2026-08-01T12:00:00.000Z'
    };
    const wideGame = { ...game, id: 'game-wide', name: 'Wide Game', maxSeats: 10 };
    const boundTable = { ...runningTable, physicalTableId: physicalTable.id };
    const unboundTable = { ...runningTable, id: 'table-unbound', label: 'Unbound Table' };
    const source = state({
      physicalTables: [physicalTable],
      games: [otherGame, wideGame],
      sessions: [boundTable, unboundTable]
    });

    const switched = switchRunningTableGame(source, wideGame.id, dependencies());
    expect(switched.state.sessions[0]).toMatchObject({
      gameId: wideGame.id,
      maxSeats: physicalTable.maxSeats
    });

    const capped = applyDefaultTableCap(source, 10);
    expect(capped.games.every((candidate) => candidate.maxSeats === 10)).toBe(true);
    expect(capped.sessions[0].maxSeats).toBe(physicalTable.maxSeats);
    expect(capped.sessions[1].maxSeats).toBe(10);
    expect(capped.settings.defaultTableCap).toBe(10);
  });

  it('creates planned interests and balanced tables in canonical participant order', () => {
    const existingInterest = interest('existing', 'Existing');
    const newProfile = profile('profile-new', 'New Player');
    const sourceTable = { ...runningTable, gameId: game.id, maxSeats: game.maxSeats, seatsFilled: 4 };
    const source = state({ interests: [existingInterest], sessions: [sourceTable] });
    const planned = createPlannedTable(source, game.id, [
      { playerName: existingInterest.playerName, interest: existingInterest },
      { playerName: newProfile.name, profile: newProfile }
    ], dependencies());

    expect(planned).not.toBeNull();
    if (!planned) return;
    expect(planned.state.interests.map((item) => item.id)).toEqual(['created-1', existingInterest.id]);
    expect(planned.state.interests[0]).toMatchObject({
      profileId: newProfile.id,
      playerName: newProfile.name,
      status: 'Interested',
      timestamp: now,
      interestedAt: now
    });
    expect(planned.state.sessions[1]).toMatchObject({
      id: 'created-2',
      label: 'Coordinated Table 2',
      plannedPlayerIds: [existingInterest.id, 'created-1']
    });
    expect(planned.state.tableEvents[0]).toMatchObject({ id: 'created-3', playerCount: 2, note: 'Staff-created planned table' });

    const mover = interest('interest-move', 'Mover');
    const balanced = createBalancedTable(source, {
      game,
      fromTable: sourceTable,
      moveCandidates: [{ playerName: mover.playerName, interest: mover }],
      tableASeatsAfterMove: 3,
      tableBProjectedSeats: 2
    }, dependencies());
    expect(balanced).not.toBeNull();
    if (!balanced) return;
    expect(balanced.sessions[0]).toMatchObject({ seatsFilled: 3, plannedPlayerIds: ['interest-keep'] });
    expect(balanced.sessions[1]).toMatchObject({
      id: 'created-1',
      label: 'Balanced Table 2',
      plannedPlayerIds: [mover.id],
      collectionMode: 'Time'
    });
    expect(balanced.tableEvents[0]).toMatchObject({ id: 'created-2', note: 'Table B created from Table A balance option: Mover' });
  });

  it('binds planned and balanced creation to capacity-appropriate permanent tables and no-ops when none are available', () => {
    const smallPhysicalTable = {
      id: 'physical-small',
      label: 'Table 1',
      maxSeats: 6 as const,
      createdAt: '2026-08-01T12:00:00.000Z'
    };
    const largePhysicalTable = {
      id: 'physical-large',
      label: 'Table 2',
      maxSeats: 10 as const,
      createdAt: '2026-08-01T12:01:00.000Z'
    };
    const sourceTable = {
      ...runningTable,
      gameId: game.id,
      physicalTableId: smallPhysicalTable.id,
      maxSeats: smallPhysicalTable.maxSeats,
      seatsFilled: 4
    };
    const mover = interest('interest-move', 'Mover');
    const source = state({
      physicalTables: [smallPhysicalTable, largePhysicalTable],
      interests: [mover],
      sessions: [sourceTable]
    });

    const planned = createPlannedTable(
      source,
      game.id,
      [{ playerName: mover.playerName, interest: mover }],
      dependencies()
    );
    expect(planned?.state.sessions.at(-1)).toMatchObject({
      id: 'created-1',
      physicalTableId: largePhysicalTable.id,
      label: largePhysicalTable.label,
      maxSeats: game.maxSeats
    });
    expect(planned?.state.sessions.at(-1)?.id).not.toBe(largePhysicalTable.id);

    const balanced = createBalancedTable(source, {
      game,
      fromTable: sourceTable,
      moveCandidates: [{ playerName: mover.playerName, interest: mover }],
      tableASeatsAfterMove: 3,
      tableBProjectedSeats: 2
    }, dependencies());
    expect(balanced?.sessions.at(-1)).toMatchObject({
      id: 'created-1',
      physicalTableId: largePhysicalTable.id,
      label: largePhysicalTable.label,
      maxSeats: game.maxSeats
    });
    expect(balanced?.sessions.at(-1)?.id).not.toBe(largePhysicalTable.id);

    const allOccupied = state({
      physicalTables: [smallPhysicalTable],
      sessions: [sourceTable]
    });
    expect(createPlannedTable(allOccupied, game.id, [], dependencies())).toBeNull();
    expect(createBalancedTable(allOccupied, {
      game,
      fromTable: sourceTable,
      moveCandidates: [{ playerName: mover.playerName, interest: mover }],
      tableASeatsAfterMove: 3,
      tableBProjectedSeats: 2
    }, dependencies())).toBeNull();
  });

  it('starts selected players in source order and returns telemetry/error orchestration data', () => {
    const selectedA = interest('selected-a', 'Selected A');
    const selectedB = interest('selected-b', 'Selected B');
    const formingTable = { ...runningTable, gameId: game.id, maxSeats: game.maxSeats, status: 'Forming' as const, seatsFilled: 0 };
    const source = state({ interests: [selectedA, selectedB], sessions: [formingTable] });
    const snapshot = structuredClone(source);

    const result = startTableWithPlayers(
      source,
      formingTable,
      [selectedB.id, selectedA.id],
      'Direct Club',
      dependencies()
    );

    expect(result.state.playerSessions.map((session) => session.playerName)).toEqual(['Selected A', 'Selected B']);
    expect(result.state.sessions[0]).toMatchObject({ status: 'Running', seatsFilled: 2, startedAt: now });
    expect(result.state.tableEvents[0]).toMatchObject({
      id: 'created-5',
      type: 'Started',
      playerCount: 2,
      note: 'Started with Selected A, Selected B - messaging trigger: Direct Club'
    });
    expect(result).toMatchObject({ playerCount: 2, selectedPlayerCount: 2, alreadySeatedCount: 0, skippedErrors: [] });
    expect(source).toEqual(snapshot);
  });
});
