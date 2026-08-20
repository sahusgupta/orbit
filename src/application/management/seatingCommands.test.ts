import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, PlayerProfile, PlayerSession } from '../../domain/types';
import {
  getActivePlayerSessionsForTable,
  getAvailableSeatNumber,
  movePlayerToTable,
  seatPlayerInState,
  syncSessionSeatCount
} from './seatingCommands';

const now = '2026-08-08T22:00:00.000Z';
const game = {
  id: 'game-seating',
  name: 'Seating Holdem',
  maxSeats: 3,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 3
};
const sourceTable: GameSession = {
  id: 'table-source',
  gameId: game.id,
  label: 'Source',
  status: 'Forming',
  seatsFilled: 1,
  maxSeats: 3,
  collectionMode: 'Time',
  timeFeeBased: true,
  tags: [],
  startedAt: '2026-08-08T20:00:00.000Z'
};
const targetTable: GameSession = {
  ...sourceTable,
  id: 'table-target',
  label: 'Target',
  status: 'Running',
  seatsFilled: 1
};
const profile: PlayerProfile = {
  id: 'profile-target',
  name: 'Target Player',
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
};
const occupant: PlayerSession = {
  id: 'session-occupant',
  playerName: 'Occupant',
  profileId: 'profile-occupant',
  gameId: game.id,
  tableId: sourceTable.id,
  seatNumber: 1,
  seatedAt: '2026-08-08T20:30:00.000Z'
};

const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [game],
  profiles: [profile],
  interests: [],
  sessions: [sourceTable, targetTable],
  playerSessions: [occupant],
  buyIns: [],
  playerLedger: [],
  tableEvents: [],
  ...overrides
});

const dependencies = () => {
  let nextId = 0;
  return {
    createId: () => `created-${++nextId}`,
    nowIso: () => now
  };
};

describe('management seating commands', () => {
  it('projects active sessions, available seats, and synchronized counts without mutating input', () => {
    const closed = { ...occupant, id: 'session-closed', seatNumber: 2, leftAt: now };
    const source = state({ playerSessions: [occupant, closed] });
    const snapshot = structuredClone(source);

    expect(getActivePlayerSessionsForTable(source, sourceTable.id)).toEqual([occupant]);
    expect(getAvailableSeatNumber(source, sourceTable)).toBe(2);
    expect(getAvailableSeatNumber(source, sourceTable, 1)).toBeUndefined();
    expect(getAvailableSeatNumber(source, sourceTable, 3)).toBe(3);
    expect(syncSessionSeatCount(source, sourceTable.id).sessions[0].seatsFilled).toBe(1);
    expect(source).toEqual(snapshot);
  });

  it('seats a player with deterministic identity, accounting order, and profile frequency', () => {
    const interest = {
      id: 'interest-target',
      profileId: profile.id,
      playerName: profile.name,
      gameId: game.id,
      status: 'Arrived' as const,
      timestamp: '2026-08-08T21:30:00.000Z',
      interestedAt: '2026-08-08T21:00:00.000Z',
      arrivedAt: '2026-08-08T21:30:00.000Z',
      notes: ''
    };
    const source = state({
      interests: [interest],
      settings: { ...structuredClone(seedState.settings), defaultHourlyFee: 12 }
    });
    const snapshot = structuredClone(source);

    const result = seatPlayerInState(source, sourceTable.id, {
      playerName: profile.name,
      profileId: profile.id,
      interestId: interest.id,
      requestedSeatNumber: 2,
      initialTimeMinutes: 45,
      initialBuyIn: 150,
      note: 'Direct command'
    }, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.playerSessions[1]).toMatchObject({
      id: 'created-1',
      profileId: profile.id,
      tableId: sourceTable.id,
      seatNumber: 2,
      seatedAt: now,
      timePurchasedMinutes: 45,
      timeRemainingMinutes: 45,
      timeFeeEnabled: true
    });
    expect(result.state.buyIns[0]).toMatchObject({ id: 'created-2', amount: 150, timestamp: now });
    expect(result.state.playerLedger.map((entry) => [entry.id, entry.type])).toEqual([
      ['created-3', 'Buy-In'],
      ['created-4', 'Check-In']
    ]);
    expect(result.state.timeFeeLogs).toEqual([{
      id: 'created-5',
      playerSessionId: 'created-1',
      tableId: sourceTable.id,
      gameId: game.id,
      playerName: profile.name,
      minutes: 45,
      amount: 9,
      timestamp: now
    }]);
    expect(result.state.interests[0]).toMatchObject({ status: 'Seated', seatedAt: now, timestamp: now });
    expect(result.state.sessions[0]).toMatchObject({ status: 'Running', seatsFilled: 2 });
    expect(result.state.profiles[0]).toMatchObject({ gamePlayCounts: { [game.id]: 1 }, preferredGameIds: [game.id] });
    expect(source).toEqual(snapshot);
  });

  it.each([
    ['missing table', 'missing-table', { playerName: profile.name }, 'This table is no longer open.'],
    ['missing player', sourceTable.id, {}, 'Choose a player or enter a player name.'],
    ['duplicate player', sourceTable.id, { playerName: occupant.playerName, profileId: occupant.profileId }, 'Occupant is already seated.'],
    ['occupied seat', sourceTable.id, { playerName: profile.name, profileId: profile.id, requestedSeatNumber: 1 }, 'Table full. No open seats remain.']
  ] as const)('rejects %s without changing state', (_label, tableId, payload, error) => {
    const source = state();
    const snapshot = structuredClone(source);

    expect(seatPlayerInState(source, tableId, payload, dependencies())).toEqual({ ok: false, error });
    expect(source).toEqual(snapshot);
  });

  it('moves a player, records both manual edits and event order, and resynchronizes both tables', () => {
    const moving = { ...occupant, manualEdits: { seatedAt: '2026-08-08T20:31:00.000Z' } };
    const targetOccupant = { ...occupant, id: 'session-target', tableId: targetTable.id, seatNumber: 1 };
    const source = state({ playerSessions: [moving, targetOccupant] });
    const snapshot = structuredClone(source);

    const result = movePlayerToTable(source, moving, targetTable.id, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.playerSessions[0]).toEqual({
      ...moving,
      tableId: targetTable.id,
      seatNumber: 2,
      manualEdits: { seatedAt: '2026-08-08T20:31:00.000Z', tableId: now, seatNumber: now }
    });
    expect(result.state.sessions.map((session) => session.seatsFilled)).toEqual([0, 2]);
    expect(result.state.tableEvents).toEqual([{
      id: 'created-1',
      type: 'Merged',
      gameId: game.id,
      tableId: targetTable.id,
      timestamp: now,
      playerCount: 2,
      reason: 'player moved',
      note: 'Occupant moved from Source to Target'
    }]);
    expect(source).toEqual(snapshot);
  });
});
