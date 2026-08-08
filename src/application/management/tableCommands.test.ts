import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, Interest, PlayerProfile, PlayerSession } from '../../domain/types';
import {
  createBalancedTable,
  createDemandFormingTable,
  createFormingTable,
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
    expect(balanced.sessions[0]).toMatchObject({ seatsFilled: 3, plannedPlayerIds: ['interest-keep'] });
    expect(balanced.sessions[1]).toMatchObject({
      id: 'created-1',
      label: 'Balanced Table 2',
      plannedPlayerIds: [mover.id],
      collectionMode: 'Time'
    });
    expect(balanced.tableEvents[0]).toMatchObject({ id: 'created-2', note: 'Table B created from Table A balance option: Mover' });
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
