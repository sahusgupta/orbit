import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, Interest, PlayerProfile, PlayerSession } from '../../domain/types';
import {
  addPlayerBuyIn,
  addPlayerTime,
  assignTableDealer,
  changePlayerSeat,
  correctPlayerSession,
  endTableDealerAssignment,
  markInterestPlayerLeft,
  markPlayerSessionLeft,
  recordTableDrop,
  recordTableHands,
  setTableCollectionMode
} from './playerSessionCommands';

const now = '2026-08-08T22:00:00.000Z';
const game = {
  id: 'game-session',
  name: 'Session Holdem',
  maxSeats: 3,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 3
};
const table: GameSession = {
  id: 'table-session',
  gameId: game.id,
  label: 'Session Table',
  status: 'Running',
  seatsFilled: 2,
  maxSeats: 3,
  collectionMode: 'Time',
  timeFeeBased: true,
  tags: [],
  startedAt: '2026-08-08T19:00:00.000Z'
};
const playerSession: PlayerSession = {
  id: 'session-target',
  playerName: 'Target Player',
  profileId: 'profile-target',
  gameId: game.id,
  tableId: table.id,
  seatNumber: 1,
  seatedAt: '2026-08-08T20:00:00.000Z',
  timePurchasedMinutes: 60,
  timeRemainingMinutes: 30,
  lastTimeTickAt: '2026-08-08T21:45:00.000Z',
  timeFeeEnabled: true
};
const peerSession: PlayerSession = {
  ...playerSession,
  id: 'session-peer',
  playerName: 'Peer Player',
  profileId: 'profile-peer',
  seatNumber: 2
};
const profile = (id: string, name: string): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 10,
  lastSessionTimePlayedHours: 1,
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
const interest: Interest = {
  id: 'interest-target',
  profileId: playerSession.profileId,
  playerName: playerSession.playerName,
  gameId: game.id,
  status: 'Seated',
  timestamp: playerSession.seatedAt,
  interestedAt: '2026-08-08T19:30:00.000Z',
  seatedAt: playerSession.seatedAt,
  notes: ''
};

const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [game],
  profiles: [profile('profile-target', playerSession.playerName), profile('profile-peer', peerSession.playerName)],
  interests: [interest],
  sessions: [table],
  playerSessions: [playerSession, peerSession],
  buyIns: [],
  dropLogs: [],
  dealerAssignments: [],
  handCountLogs: [],
  timeFeeLogs: [],
  playerLedger: [],
  tableEvents: [],
  correctionLog: [],
  settings: { ...structuredClone(seedState.settings), defaultHourlyFee: 12 },
  ...overrides
});

const dependencies = () => {
  let nextId = 0;
  return {
    createId: () => `created-${++nextId}`,
    nowIso: () => now,
    nowMs: () => new Date(now).getTime()
  };
};

describe('management player-session commands', () => {
  it('corrects one session, preserves ordering, and audits both existing and missing targets', () => {
    const source = state({ correctionLog: Array.from({ length: 50 }, (_, index) => ({
      id: `correction-${index}`,
      entity: 'old',
      field: 'old',
      note: 'old',
      timestamp: now
    })) });
    const snapshot = structuredClone(source);

    const corrected = correctPlayerSession(source, playerSession.id, { seatNumber: 3 }, 'seatNumber', dependencies());
    const missing = correctPlayerSession(source, 'missing-session', { seatNumber: 3 }, 'seatNumber', dependencies());

    expect(corrected.playerSessions[0]).toEqual({ ...playerSession, seatNumber: 3, manualEdits: { seatNumber: now } });
    expect(corrected.playerSessions[1]).toBe(source.playerSessions[1]);
    expect(corrected.correctionLog).toHaveLength(50);
    expect(corrected.correctionLog[0]).toMatchObject({ id: 'created-1', entity: playerSession.id, field: 'seatNumber' });
    expect(missing.playerSessions[0]).toBe(source.playerSessions[0]);
    expect(missing.correctionLog[0]).toMatchObject({ entity: 'missing-session', field: 'seatNumber' });
    expect(source).toEqual(snapshot);
  });

  it('validates seat corrections before applying the canonical audited patch', () => {
    const source = state();

    expect(changePlayerSeat(source, playerSession, 4, dependencies())).toEqual({
      ok: false,
      error: 'Choose a valid seat number.'
    });
    expect(changePlayerSeat(source, playerSession, 2, dependencies())).toEqual({
      ok: false,
      error: 'Seat 2 is already occupied.'
    });
    const changed = changePlayerSeat(source, playerSession, 3, dependencies());
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.state.playerSessions[0]).toMatchObject({ seatNumber: 3, manualEdits: { seatNumber: now } });
    expect(changed.state.correctionLog[0]).toMatchObject({ entity: playerSession.id, field: 'seatNumber' });
  });

  it('propagates collection mode and records elapsed-time-aware player time', () => {
    const withoutTick = { ...peerSession, lastTimeTickAt: undefined };
    const source = state({
      playerSessions: [playerSession, withoutTick],
      settings: {
        ...structuredClone(seedState.settings),
        defaultHourlyFee: 12,
        collectionProfiles: [{
          gameId: game.id,
          collectionMode: 'Time',
          hourlyFee: 99,
          estimatedDropPerSeatHour: 5
        }]
      }
    });
    const collectionChanged = setTableCollectionMode(source, table.id, 'Drop', dependencies());
    const timeAdded = addPlayerTime(source, playerSession, 30, dependencies());

    expect(collectionChanged.sessions[0]).toMatchObject({ collectionMode: 'Drop', timeFeeBased: false });
    expect(collectionChanged.playerSessions[0]).toMatchObject({ timeFeeEnabled: false, lastTimeTickAt: playerSession.lastTimeTickAt });
    expect(collectionChanged.playerSessions[1]).toMatchObject({ timeFeeEnabled: false, lastTimeTickAt: now });
    expect(timeAdded.ok).toBe(true);
    if (!timeAdded.ok) return;
    expect(timeAdded.state.playerSessions[0]).toMatchObject({
      timePurchasedMinutes: 90,
      timeRemainingMinutes: 45,
      lastTimeTickAt: now,
      timeFeeEnabled: true
    });
    expect(timeAdded.state.timeFeeLogs[0]).toMatchObject({ id: 'created-1', minutes: 30, amount: 6, timestamp: now });
    expect(timeAdded.state.tableEvents[0]).toMatchObject({ id: 'created-2', reason: 'time added', playerCount: 2 });
    expect(addPlayerTime(source, playerSession, 0, dependencies())).toEqual({ ok: false });
  });

  it('records buy-in, drop, dealer, and hand financial-operational shapes in their established order', () => {
    const source = state({
      dealerAssignments: [{
        id: 'dealer-open',
        tableId: table.id,
        gameId: game.id,
        dealerName: 'First Dealer',
        startedAt: '2026-08-08T21:00:00.000Z'
      }]
    });
    const buyIn = addPlayerBuyIn(source, playerSession, 125, 'Reload', dependencies());
    const drop = recordTableDrop(source, table, 42.5, '  Counted drop  ', dependencies());
    const dealer = assignTableDealer(source, table, '  Next Dealer  ', dependencies());
    const hands = recordTableHands(source, table, 17, dependencies());

    expect(buyIn.ok).toBe(true);
    expect(drop.ok).toBe(true);
    expect(dealer.ok).toBe(true);
    expect(hands.ok).toBe(true);
    if (!buyIn.ok || !drop.ok || !dealer.ok || !hands.ok) return;
    expect(buyIn.state.buyIns[0]).toMatchObject({ id: 'created-1', amount: 125, timestamp: now, note: 'Reload' });
    expect(buyIn.state.playerLedger[0]).toMatchObject({ id: 'created-2', type: 'Buy-In', timestamp: now });
    expect(drop.state.dropLogs[0]).toMatchObject({ id: 'created-1', amount: 42.5, note: 'Counted drop' });
    expect(dealer.state.dealerAssignments).toEqual([
      expect.objectContaining({ id: 'dealer-open', endedAt: now }),
      expect.objectContaining({ id: 'created-1', dealerName: 'Next Dealer', startedAt: now })
    ]);
    expect(endTableDealerAssignment(dealer.state, table, dependencies()).dealerAssignments[1]).toMatchObject({ endedAt: now });
    expect(hands.state.handCountLogs[0]).toMatchObject({ id: 'created-1', hands: 17, timestamp: now });
    expect(addPlayerBuyIn(source, playerSession, 0, '', dependencies())).toEqual({ ok: false, error: 'Enter a buy-in amount.' });
    expect(recordTableDrop(source, table, 0, '', dependencies())).toEqual({ ok: false, error: 'Enter the amount removed from the table.' });
    expect(assignTableDealer(source, table, ' ', dependencies())).toEqual({ ok: false, error: 'Enter or select a dealer name.' });
    expect(recordTableHands(source, table, 1.5, dependencies())).toEqual({ ok: false, error: 'Enter the number of hands dealt since the last count.' });
  });

  it('marks the exact open interest session left and returns notification orchestration data', () => {
    const source = state();
    const snapshot = structuredClone(source);

    const result = markInterestPlayerLeft(source, interest, dependencies());

    expect(result.state.interests[0]).toMatchObject({ status: 'Removed', closedAt: now, timestamp: now });
    expect(result.state.playerSessions[0]).toMatchObject({ leftAt: now });
    expect(result.state.playerSessions[1]).toBe(source.playerSessions[1]);
    expect(result.state.sessions[0].seatsFilled).toBe(1);
    expect(result.notification).toEqual({ gameId: game.id, reason: 'seat-opened' });
    expect(source).toEqual(snapshot);
  });

  it('closes a player session with authoritative profile accounting and cash-out order', () => {
    const source = state();
    const snapshot = structuredClone(source);

    const result = markPlayerSessionLeft(source, playerSession, 75, '  Test cash out  ', dependencies());

    expect(result.state.interests[0]).toMatchObject({ status: 'Removed', closedAt: now, timestamp: now });
    expect(result.state.playerSessions[0]).toEqual({ ...playerSession, leftAt: now, manualEdits: { leftAt: now } });
    expect(result.state.playerLedger[0]).toMatchObject({
      id: 'created-1',
      type: 'Cash-Out',
      amount: 75,
      timestamp: now,
      note: 'Test cash out'
    });
    expect(result.state.profiles[0]).toMatchObject({ totalTimePlayedHours: 12, lastSessionTimePlayedHours: 2 });
    expect(result.state.profiles[1]).toBe(source.profiles[1]);
    expect(result.state.sessions[0].seatsFilled).toBe(1);
    expect(result.notification).toEqual({ gameId: game.id, reason: 'seat-opened' });
    expect(source).toEqual(snapshot);
  });

  it('distinguishes an omitted cash-out amount from an explicitly recorded zero', () => {
    const omitted = markPlayerSessionLeft(state(), playerSession, undefined, '', dependencies());
    const zero = markPlayerSessionLeft(state(), playerSession, 0, '', dependencies());

    expect(omitted.state.playerLedger[0]).not.toHaveProperty('amount');
    expect(omitted.state.playerLedger[0]).toMatchObject({
      type: 'Cash-Out',
      note: 'Player left table without a recorded cash-out amount'
    });
    expect(zero.state.playerLedger[0]).toMatchObject({
      type: 'Cash-Out',
      amount: 0,
      note: 'Player left table with no cash out'
    });
  });
});
