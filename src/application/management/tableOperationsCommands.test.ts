import { describe, expect, it } from 'vitest';
import { getTableFinancialOverview } from '../../domain/reporting';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, PhysicalTable, PlayerSession } from '../../domain/types';
import { markPlayerSessionLeft } from './playerSessionCommands';
import {
  clearTableInState,
  deleteTableInState,
  mergeTableInState
} from './tableOperationsCommands';

const timestamp = '2026-08-22T20:00:00.000Z';
let nextId = 0;
const dependencies = {
  createId: () => `operation-${++nextId}`,
  nowIso: () => timestamp
};

const gameId = 'game-holdem';
const profile = {
  id: 'profile-1',
  name: 'First Player',
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: gameId,
  preferredGameIds: [gameId],
  gamePlayCounts: {},
  mostPlayedGameId: gameId,
  preferredStakes: '',
  typicalBuyInMin: 0,
  typicalBuyInMax: 0,
  willingnessToMove: true,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: ''
};
const sourceTable: GameSession = {
  id: 'source-table',
  physicalTableId: 'physical-source',
  gameId,
  label: 'Table 1',
  status: 'Running',
  seatsFilled: 2,
  maxSeats: 6,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-22T18:00:00.000Z'
};
const targetTable: GameSession = {
  ...sourceTable,
  id: 'target-table',
  physicalTableId: 'physical-target',
  label: 'Table 2',
  seatsFilled: 1
};
const physicalTables: PhysicalTable[] = [
  { id: 'physical-source', label: 'Table 1', maxSeats: 6, createdAt: timestamp },
  { id: 'physical-target', label: 'Table 2', maxSeats: 6, createdAt: timestamp }
];
const sourcePlayers: PlayerSession[] = [
  {
    id: 'source-player-1',
    profileId: profile.id,
    playerName: profile.name,
    gameId,
    tableId: sourceTable.id,
    seatNumber: 1,
    seatedAt: '2026-08-22T19:00:00.000Z'
  },
  {
    id: 'source-player-2',
    playerName: 'Second Player',
    gameId,
    tableId: sourceTable.id,
    seatNumber: 4,
    seatedAt: '2026-08-22T19:15:00.000Z'
  }
];
const targetPlayer: PlayerSession = {
  id: 'target-player',
  playerName: 'Target Player',
  gameId,
  tableId: targetTable.id,
  seatNumber: 1,
  seatedAt: '2026-08-22T19:30:00.000Z'
};

const buildState = (): AppState => ({
  ...seedState,
  games: [{
    id: gameId,
    name: '$1/$2 Holdem',
    maxSeats: 6,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  }],
  profiles: [profile],
  physicalTables,
  sessions: [sourceTable, targetTable],
  playerSessions: [...sourcePlayers, targetPlayer],
  dealerAssignments: [{
    id: 'dealer-source',
    tableId: sourceTable.id,
    gameId,
    dealerName: 'Morgan',
    startedAt: '2026-08-22T19:00:00.000Z'
  }],
  interests: [{
    id: 'interest-source',
    profileId: profile.id,
    playerName: profile.name,
    gameId,
    status: 'Seated',
    timestamp,
    interestedAt: timestamp,
    notes: ''
  }],
  playerLedger: [],
  tableEvents: []
});

describe('table operation commands', () => {
  it('clears every player and active dealer while archiving the session and retaining the physical table', () => {
    const state = buildState();
    const result = clearTableInState(state, sourceTable.id, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.sessions.find((session) => session.id === sourceTable.id)).toMatchObject({
      status: 'Closed',
      seatsFilled: 0,
      endedAt: timestamp
    });
    expect(result.state.playerSessions.filter((session) => session.tableId === sourceTable.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'source-player-1', leftAt: timestamp }),
        expect.objectContaining({ id: 'source-player-2', leftAt: timestamp })
      ])
    );
    expect(result.state.playerLedger).toHaveLength(2);
    expect(result.state.playerLedger.every((entry) => entry.type === 'Cash-Out' && entry.amount === undefined)).toBe(true);
    expect(result.state.dealerAssignments[0].endedAt).toBe(timestamp);
    expect(result.state.interests[0]).toMatchObject({ status: 'Removed', closedAt: timestamp });
    expect(result.state.physicalTables).toEqual(physicalTables);
    expect(result.state.tableEvents.at(-1)).toMatchObject({
      type: 'Closed',
      tableId: sourceTable.id,
      playerCount: 2,
      reason: 'table cleared'
    });
    expect(state).toEqual(buildState());
  });

  it('deletes a permanent table from the room while archiving its live session and financial references', () => {
    const state = buildState();
    const result = deleteTableInState(state, { id: 'physical-source' }, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.physicalTables?.map((table) => table.id)).toEqual(['physical-target']);
    expect(result.state.sessions.find((session) => session.id === sourceTable.id)).toMatchObject({
      status: 'Closed',
      seatsFilled: 0,
      endedAt: timestamp
    });
    expect(result.state.playerSessions
      .filter((session) => session.tableId === sourceTable.id)
      .every((session: PlayerSession) => session.leftAt === timestamp)).toBe(true);
    expect(result.state.tableEvents.at(-1)).toMatchObject({
      type: 'Closed',
      tableId: sourceTable.id,
      playerCount: 2,
      reason: 'table deleted'
    });
  });

  it('merges all players atomically, keeps unique seats, closes the source, and leaves the physical table available', () => {
    const state = buildState();
    const result = mergeTableInState(state, sourceTable.id, targetTable.id, dependencies);

    expect(result).toMatchObject({ ok: true, movedPlayerCount: 2 });
    if (!result.ok) return;
    expect(result.state.sessions.find((session) => session.id === sourceTable.id)).toMatchObject({
      status: 'Closed',
      seatsFilled: 0,
      endedAt: timestamp
    });
    expect(result.state.sessions.find((session) => session.id === targetTable.id)?.seatsFilled).toBe(3);
    const mergedPlayers = result.state.playerSessions.filter((session) => !session.leftAt && session.tableId === targetTable.id);
    expect(mergedPlayers).toHaveLength(3);
    expect(new Set(mergedPlayers.map((session) => session.seatNumber)).size).toBe(3);
    expect(result.state.physicalTables).toEqual(physicalTables);
    expect(result.state.dealerAssignments[0].endedAt).toBe(timestamp);
    expect(result.state.tableEvents.at(-1)).toMatchObject({
      type: 'Merged',
      tableId: sourceTable.id,
      playerCount: 2,
      note: 'Table 1 merged into Table 2'
    });
    expect(state).toEqual(buildState());
  });

  it('consolidates only active players current-session money and time so target cash-out reconciliation stays complete', () => {
    const priorSourceSession: PlayerSession = {
      ...sourcePlayers[0],
      id: 'prior-source-player',
      seatNumber: 2,
      seatedAt: '2026-08-22T17:00:00.000Z',
      leftAt: '2026-08-22T17:45:00.000Z'
    };
    const departedSourceSession: PlayerSession = {
      id: 'departed-source-player',
      playerName: 'Departed Player',
      gameId,
      tableId: sourceTable.id,
      seatNumber: 3,
      seatedAt: '2026-08-22T18:00:00.000Z',
      leftAt: '2026-08-22T18:45:00.000Z'
    };
    const state = buildState();
    state.playerSessions = [...state.playerSessions, priorSourceSession, departedSourceSession];
    state.buyIns = [
      { id: 'buy-current-profile', profileId: profile.id, playerName: profile.name, tableId: sourceTable.id, gameId, amount: 200, timestamp: '2026-08-22T19:05:00.000Z' },
      { id: 'buy-current-guest', playerName: sourcePlayers[1].playerName, tableId: sourceTable.id, gameId, amount: 150, timestamp: '2026-08-22T19:20:00.000Z' },
      { id: 'buy-prior-same-profile', profileId: profile.id, playerName: profile.name, tableId: sourceTable.id, gameId, amount: 80, timestamp: '2026-08-22T17:05:00.000Z' },
      { id: 'buy-departed', playerName: departedSourceSession.playerName, tableId: sourceTable.id, gameId, amount: 100, timestamp: '2026-08-22T18:05:00.000Z' },
      { id: 'buy-target', playerName: targetPlayer.playerName, tableId: targetTable.id, gameId, amount: 300, timestamp: '2026-08-22T19:35:00.000Z' }
    ];
    state.playerLedger = [
      { id: 'ledger-current-profile', type: 'Buy-In', profileId: profile.id, playerName: profile.name, tableId: sourceTable.id, gameId, amount: 200, timestamp: '2026-08-22T19:05:00.000Z' },
      { id: 'ledger-current-guest', type: 'Buy-In', playerName: sourcePlayers[1].playerName, tableId: sourceTable.id, gameId, amount: 150, timestamp: '2026-08-22T19:20:00.000Z' },
      { id: 'ledger-prior-same-profile', type: 'Cash-Out', profileId: profile.id, playerName: profile.name, tableId: sourceTable.id, gameId, amount: 70, timestamp: '2026-08-22T17:45:00.000Z' },
      { id: 'ledger-departed', type: 'Cash-Out', playerName: departedSourceSession.playerName, tableId: sourceTable.id, gameId, amount: 90, timestamp: '2026-08-22T18:45:00.000Z' },
      { id: 'ledger-target', type: 'Buy-In', playerName: targetPlayer.playerName, tableId: targetTable.id, gameId, amount: 300, timestamp: '2026-08-22T19:35:00.000Z' }
    ];
    state.timeFeeLogs = [
      { id: 'time-current-profile', playerSessionId: sourcePlayers[0].id, tableId: sourceTable.id, gameId, playerName: profile.name, minutes: 60, amount: 12, timestamp: '2026-08-22T19:05:00.000Z' },
      { id: 'time-current-guest', playerSessionId: sourcePlayers[1].id, tableId: sourceTable.id, gameId, playerName: sourcePlayers[1].playerName, minutes: 30, amount: 6, timestamp: '2026-08-22T19:20:00.000Z' },
      { id: 'time-prior-same-profile', playerSessionId: priorSourceSession.id, tableId: sourceTable.id, gameId, playerName: profile.name, minutes: 45, amount: 9, timestamp: '2026-08-22T17:05:00.000Z' },
      { id: 'time-departed', playerSessionId: departedSourceSession.id, tableId: sourceTable.id, gameId, playerName: departedSourceSession.playerName, minutes: 45, amount: 9, timestamp: '2026-08-22T18:05:00.000Z' }
    ];
    const originalFinancialRecordIds = {
      buyIns: state.buyIns.map((entry) => entry.id).sort(),
      playerLedger: state.playerLedger.map((entry) => entry.id).sort(),
      timeFeeLogs: state.timeFeeLogs.map((entry) => entry.id).sort()
    };

    const result = mergeTableInState(state, sourceTable.id, targetTable.id, dependencies);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.buyIns.filter((entry) => entry.tableId === targetTable.id).map((entry) => entry.id).sort()).toEqual([
      'buy-current-guest',
      'buy-current-profile',
      'buy-target'
    ]);
    expect(result.state.buyIns.filter((entry) => entry.tableId === sourceTable.id).map((entry) => entry.id).sort()).toEqual([
      'buy-departed',
      'buy-prior-same-profile'
    ]);
    expect(result.state.playerLedger.filter((entry) => entry.tableId === targetTable.id).map((entry) => entry.id).sort()).toEqual([
      'ledger-current-guest',
      'ledger-current-profile',
      'ledger-target'
    ]);
    expect(result.state.playerLedger.filter((entry) => entry.tableId === sourceTable.id).map((entry) => entry.id).sort()).toEqual([
      'ledger-departed',
      'ledger-prior-same-profile'
    ]);
    expect(result.state.timeFeeLogs.filter((entry) => entry.tableId === targetTable.id).map((entry) => entry.id).sort()).toEqual([
      'time-current-guest',
      'time-current-profile'
    ]);
    expect(result.state.timeFeeLogs.filter((entry) => entry.tableId === sourceTable.id).map((entry) => entry.id).sort()).toEqual([
      'time-departed',
      'time-prior-same-profile'
    ]);
    expect({
      buyIns: result.state.buyIns.map((entry) => entry.id).sort(),
      playerLedger: result.state.playerLedger.map((entry) => entry.id).sort(),
      timeFeeLogs: result.state.timeFeeLogs.map((entry) => entry.id).sort()
    }).toEqual(originalFinancialRecordIds);

    const mergedProfileSession = result.state.playerSessions.find((entry) => entry.id === sourcePlayers[0].id);
    expect(mergedProfileSession).toBeDefined();
    if (!mergedProfileSession) return;
    const cashedOut = markPlayerSessionLeft(
      result.state,
      mergedProfileSession,
      220,
      '',
      { createId: () => 'cashout-after-merge', nowIso: () => '2026-08-22T21:00:00.000Z' }
    ).state;
    expect(cashedOut.playerLedger.find((entry) => entry.id === 'cashout-after-merge')).toMatchObject({
      tableId: targetTable.id,
      amount: 220
    });
    expect(getTableFinancialOverview(cashedOut, targetTable)).toMatchObject({
      totalBuyIns: 650,
      totalCashOuts: 220,
      totalTimeFees: 18,
      cashInPlay: 430
    });
    expect(getTableFinancialOverview(cashedOut, sourceTable)).toMatchObject({
      totalBuyIns: 180,
      totalCashOuts: 160,
      totalTimeFees: 18,
      cashInPlay: 20
    });
    expect(cashedOut.buyIns.reduce((sum, entry) => sum + entry.amount, 0)).toBe(830);
    expect(state.buyIns.reduce((sum, entry) => sum + entry.amount, 0)).toBe(830);
  });

  it('rejects a merge without enough target seats and returns the original state', () => {
    const state = buildState();
    state.sessions = state.sessions.map((session) =>
      session.id === targetTable.id ? { ...session, maxSeats: 2 } : session
    );

    const result = mergeTableInState(state, sourceTable.id, targetTable.id, dependencies);

    expect(result).toEqual({
      ok: false,
      state,
      error: 'Table 2 does not have enough open seats.'
    });
  });

  it('rejects a merge between different collection modes', () => {
    const state = buildState();
    state.sessions = state.sessions.map((session) =>
      session.id === targetTable.id
        ? { ...session, collectionMode: 'Drop', timeFeeBased: false }
        : session
    );

    const result = mergeTableInState(state, sourceTable.id, targetTable.id, dependencies);

    expect(result).toEqual({
      ok: false,
      state,
      error: 'Only tables using the same collection mode can be merged.'
    });
  });
});
