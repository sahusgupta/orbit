import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, Interest, PlayerProfile, PlayerSession } from '../../domain/types';
import {
  addPlayerBuyIn,
  addPlayerTime,
  applySavedPlayerTimeCredit,
  assignTableDealer,
  changePlayerSeat,
  correctPlayerSession,
  deductUnconsumedPlayerTime,
  endTableDealerAssignment,
  markInterestPlayerLeft,
  markPlayerSessionLeft,
  pauseAndStorePlayerTimeCredit,
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

  it('deducts only unconsumed purchased time with negative fee and correction audit entries', () => {
    const source = state({
      timeFeeLogs: [{
        id: 'original-time',
        playerSessionId: playerSession.id,
        tableId: playerSession.tableId,
        gameId: playerSession.gameId,
        playerName: playerSession.playerName,
        minutes: 60,
        amount: 12,
        timestamp: playerSession.seatedAt
      }]
    });
    const snapshot = structuredClone(source);

    const result = deductUnconsumedPlayerTime(
      source,
      playerSession.id,
      10,
      '  Staff added the wrong amount  ',
      dependencies()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.playerSessions[0]).toMatchObject({
      timePurchasedMinutes: 50,
      timeRemainingMinutes: 5,
      lastTimeTickAt: now,
      timeFeeEnabled: true
    });
    expect(result.state.timeFeeLogs.at(-1)).toEqual({
      id: 'created-1',
      playerSessionId: playerSession.id,
      tableId: playerSession.tableId,
      gameId: playerSession.gameId,
      playerName: playerSession.playerName,
      minutes: -10,
      amount: -2,
      timestamp: now
    });
    expect(result.state.correctionLog[0]).toEqual({
      id: 'created-2',
      entity: playerSession.id,
      field: 'timePurchasedMinutes',
      note: 'Deducted 10 unconsumed purchased minutes: Staff added the wrong amount',
      timestamp: now
    });
    expect(result.state.revenueTransactions).toBe(source.revenueTransactions);
    expect(source).toEqual(snapshot);
  });

  it('rejects invalid or consumed time deductions without changing state', () => {
    const source = state();

    expect(deductUnconsumedPlayerTime(source, playerSession.id, 16, 'Too much', dependencies())).toEqual({
      ok: false,
      error: 'Only 15 unconsumed purchased minutes can be deducted.'
    });
    expect(deductUnconsumedPlayerTime(source, playerSession.id, 0, 'Invalid', dependencies())).toEqual({
      ok: false,
      error: 'Enter a whole number of minutes to deduct.'
    });
    expect(deductUnconsumedPlayerTime(source, playerSession.id, 1, ' ', dependencies())).toEqual({
      ok: false,
      error: 'Enter a reason for the time correction.'
    });
    expect(source.timeFeeLogs).toEqual([]);
    expect(source.correctionLog).toEqual([]);
  });

  it('does not treat remaining applied credit as unconsumed purchased time', () => {
    const source = state({
      playerSessions: [{
        ...playerSession,
        timePurchasedMinutes: 30,
        timeCreditAppliedMinutes: 60,
        timeRemainingMinutes: 50,
        lastTimeTickAt: now
      }, peerSession]
    });

    expect(deductUnconsumedPlayerTime(source, playerSession.id, 1, 'Wrong purchase', dependencies())).toEqual({
      ok: false,
      error: 'Only 0 unconsumed purchased minutes can be deducted.'
    });
  });

  it('pauses the countdown and stores all current remaining time on the stable profile without revenue', () => {
    const targetProfile = { ...profile('profile-target', playerSession.playerName), savedTimeCreditMinutes: 20 };
    const source = state({
      profiles: [targetProfile, profile('profile-peer', peerSession.playerName)],
      timeFeeLogs: [{
        id: 'original-time',
        playerSessionId: playerSession.id,
        tableId: playerSession.tableId,
        gameId: playerSession.gameId,
        playerName: playerSession.playerName,
        minutes: 60,
        amount: 12,
        timestamp: playerSession.seatedAt
      }]
    });

    const result = pauseAndStorePlayerTimeCredit(source, playerSession.id, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.profiles[0]).toMatchObject({ savedTimeCreditMinutes: 35 });
    expect(result.state.playerSessions[0]).toMatchObject({
      timePurchasedMinutes: 60,
      timeRemainingMinutes: 0,
      lastTimeTickAt: now,
      timeFeeEnabled: false
    });
    expect(result.state.timeFeeLogs).toBe(source.timeFeeLogs);
    expect(result.state.revenueTransactions).toBe(source.revenueTransactions);
  });

  it('uses a unique legacy profile fallback for saved time but never falls back from a broken stable link', () => {
    const legacySession = { ...playerSession, profileId: undefined };
    const legacyState = state({ playerSessions: [legacySession, peerSession] });
    const stored = pauseAndStorePlayerTimeCredit(legacyState, legacySession.id, dependencies());
    const brokenLinkState = state({
      playerSessions: [{ ...playerSession, profileId: 'missing-profile' }, peerSession]
    });

    expect(stored.ok).toBe(true);
    if (stored.ok) expect(stored.state.profiles[0]).toMatchObject({ savedTimeCreditMinutes: 15 });
    expect(pauseAndStorePlayerTimeCredit(brokenLinkState, playerSession.id, dependencies())).toEqual({
      ok: false,
      error: 'The player session is linked to a profile that no longer exists.'
    });
  });

  it('applies saved profile credit to the live countdown without recording new revenue', () => {
    const source = state({
      profiles: [
        { ...profile('profile-target', playerSession.playerName), savedTimeCreditMinutes: 40 },
        profile('profile-peer', peerSession.playerName)
      ],
      playerSessions: [{ ...playerSession, timeCreditAppliedMinutes: 5 }, peerSession]
    });

    const result = applySavedPlayerTimeCredit(source, playerSession.id, 20, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.profiles[0]).toMatchObject({ savedTimeCreditMinutes: 20 });
    expect(result.state.playerSessions[0]).toMatchObject({
      timePurchasedMinutes: 60,
      timeCreditAppliedMinutes: 25,
      timeRemainingMinutes: 35,
      lastTimeTickAt: now,
      timeFeeEnabled: true
    });
    expect(result.state.timeFeeLogs).toBe(source.timeFeeLogs);
    expect(result.state.revenueTransactions).toBe(source.revenueTransactions);
  });

  it('rejects unavailable saved credit and applying credit outside an open time table', () => {
    const creditedProfiles = [
      { ...profile('profile-target', playerSession.playerName), savedTimeCreditMinutes: 10 },
      profile('profile-peer', peerSession.playerName)
    ];
    const source = state({ profiles: creditedProfiles });
    const dropState = state({
      profiles: creditedProfiles,
      sessions: [{ ...table, collectionMode: 'Drop', timeFeeBased: false }]
    });

    expect(applySavedPlayerTimeCredit(source, playerSession.id, 11, dependencies())).toEqual({
      ok: false,
      error: 'Only 10 saved minutes are available.'
    });
    expect(applySavedPlayerTimeCredit(dropState, playerSession.id, 5, dependencies())).toEqual({
      ok: false,
      error: 'Saved time can only be applied at a time-collection table.'
    });
    expect(source.timeFeeLogs).toEqual([]);
    expect(source.revenueTransactions).toEqual([]);
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

  it('uses the authoritative profile relationship when an interest and seated-session name differ', () => {
    const renamedInterest = { ...interest, playerName: 'Prior Display Name' };
    const source = state({ interests: [renamedInterest] });

    const result = markInterestPlayerLeft(source, renamedInterest, dependencies());

    expect(result.state.interests[0]).toMatchObject({ status: 'Removed', closedAt: now });
    expect(result.state.playerSessions[0]).toMatchObject({ id: playerSession.id, leftAt: now });
    expect(result.state.playerSessions[1]).toBe(source.playerSessions[1]);
  });

  it('never falls back by name when a profile-linked interest has no matching active session', () => {
    const linkedInterest = { ...interest, profileId: 'profile-missing' };
    const sameNameSession = { ...playerSession, profileId: 'profile-other' };
    const source = state({ interests: [linkedInterest], playerSessions: [sameNameSession, peerSession] });

    const result = markInterestPlayerLeft(source, linkedInterest, dependencies());

    expect(result.state.interests[0]).toMatchObject({ status: 'Removed', closedAt: now });
    expect(result.state.playerSessions[0]).toBe(source.playerSessions[0]);
    expect(result.state.playerSessions[1]).toBe(source.playerSessions[1]);
    expect(result.notification).toBeNull();
  });

  it('uses legacy name matching only when exactly one active session matches the game', () => {
    const { profileId: _profileId, ...legacyInterest } = interest;
    const uniqueSource = state({ interests: [legacyInterest] });
    const uniqueResult = markInterestPlayerLeft(uniqueSource, legacyInterest, dependencies());
    const duplicateSession = {
      ...playerSession,
      id: 'session-duplicate-name',
      profileId: 'profile-duplicate-name',
      seatNumber: 3
    };
    const ambiguousSource = state({
      interests: [legacyInterest],
      playerSessions: [playerSession, peerSession, duplicateSession]
    });

    const ambiguousResult = markInterestPlayerLeft(ambiguousSource, legacyInterest, dependencies());

    expect(uniqueResult.state.playerSessions[0]).toMatchObject({ leftAt: now });
    expect(uniqueResult.notification).toEqual({ gameId: game.id, reason: 'seat-opened' });
    expect(ambiguousResult.state.playerSessions[0]).toBe(ambiguousSource.playerSessions[0]);
    expect(ambiguousResult.state.playerSessions[2]).toBe(ambiguousSource.playerSessions[2]);
    expect(ambiguousResult.notification).toBeNull();
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
