import { describe, expect, it } from 'vitest';
import selfCheckIn from './selfCheckIn.js';

const {
  appendSelfCheckInAssistanceRequest,
  findSelfCheckInProfile,
  getAvailableSelfCheckInTables,
  seatSelfCheckInPlayer
} = selfCheckIn;

const now = '2026-08-24T12:00:00.000Z';
const profile = {
  id: 'profile-one',
  name: 'Jos\u00e9 O\u2019Brien',
  preferredGameId: 'game-one',
  preferredGameIds: ['game-one'],
  gamePlayCounts: {},
  mostPlayedGameId: 'game-one'
};
const state = (overrides = {}) => ({
  settings: { clubAccount: { clubName: 'Orbit Room' }, pilotAccess: { licenseId: 'club-one' } },
  games: [
    { id: 'game-one', name: '1/2 NLH', maxSeats: 3 },
    { id: 'game-two', name: '2/5 NLH', maxSeats: 3 }
  ],
  profiles: [profile],
  interests: [],
  sessions: [
    { id: 'table-one', gameId: 'game-one', label: 'Table 1', status: 'Running', maxSeats: 3, seatsFilled: 0, startedAt: now },
    { id: 'table-full', gameId: 'game-two', label: 'Table 2', status: 'Running', maxSeats: 1, seatsFilled: 0, startedAt: now },
    { id: 'table-paused', gameId: 'game-one', label: 'Table 3', status: 'Paused', maxSeats: 3, seatsFilled: 0, startedAt: now }
  ],
  playerSessions: [{
    id: 'occupant', profileId: 'other', playerName: 'Other Player', gameId: 'game-two', tableId: 'table-full', seatNumber: 1, seatedAt: now
  }],
  playerLedger: [],
  staffRequests: [],
  ...overrides
});

describe('self-check-in state transitions', () => {
  it('matches exactly one normalized profile and treats duplicate names as ambiguous', () => {
    expect(findSelfCheckInProfile(state(), 'jos\u00e9 o\u2019brien')).toEqual({ kind: 'matched', profile });
    expect(findSelfCheckInProfile(state(), 'missing player')).toEqual({ kind: 'unmatched' });
    expect(findSelfCheckInProfile(state({ profiles: [profile, { ...profile, id: 'profile-two' }] }), 'jos\u00e9 o\u2019brien'))
      .toEqual({ kind: 'ambiguous' });
  });

  it('derives availability from active player sessions and excludes full, paused, and closed tables', () => {
    expect(getAvailableSelfCheckInTables(state())).toEqual([{
      id: 'table-one',
      label: 'Table 1',
      gameId: 'game-one',
      gameName: '1/2 NLH',
      status: 'Running',
      availableSeats: 3,
      maxSeats: 3
    }]);
  });

  it('counts malformed active seat records toward capacity without assigning past the table cap', () => {
    const malformedActiveSessions = [
      { id: 'duplicate-one', profileId: 'other-one', tableId: 'table-one', gameId: 'game-one', seatNumber: 1, seatedAt: now },
      { id: 'duplicate-two', profileId: 'other-two', tableId: 'table-one', gameId: 'game-one', seatNumber: 1, seatedAt: now },
      { id: 'missing-seat', profileId: 'other-three', tableId: 'table-full', gameId: 'game-two', seatedAt: now }
    ];
    const source = state({
      sessions: [
        { id: 'table-one', gameId: 'game-one', label: 'Table 1', status: 'Running', maxSeats: 2, seatsFilled: 0, startedAt: now },
        { id: 'table-full', gameId: 'game-two', label: 'Table 2', status: 'Running', maxSeats: 1, seatsFilled: 0, startedAt: now }
      ],
      playerSessions: malformedActiveSessions
    });

    expect(getAvailableSelfCheckInTables(source)).toEqual([]);
  });

  it('rejects table capacities above the bounded poker-table maximum', () => {
    const source = state({
      sessions: [
        { id: 'oversized', gameId: 'game-one', label: 'Oversized', status: 'Running', maxSeats: 1_000_000, seatsFilled: 0, startedAt: now }
      ],
      playerSessions: []
    });

    expect(getAvailableSelfCheckInTables(source)).toEqual([]);
    expect(seatSelfCheckInPlayer(source, {
      profileId: profile.id,
      tableId: 'oversized',
      timestamp: now,
      interestId: 'interest',
      playerSessionId: 'session',
      ledgerId: 'ledger'
    })).toMatchObject({ ok: false, code: 'TABLE_UNAVAILABLE' });
  });

  it('appends a staff request and deduplicates an equivalent pending name and reason', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const first = appendSelfCheckInAssistanceRequest(source, {
      id: 'request-one',
      playerName: 'New Player',
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    if (!first.ok) return;
    const repeated = appendSelfCheckInAssistanceRequest(first.state, {
      id: 'request-two',
      playerName: '  new   player ',
      reason: 'not-found',
      createdAt: now
    });

    expect(first.state.staffRequests).toEqual([{
      id: 'request-one',
      type: 'self-check-in-assistance',
      playerName: 'New Player',
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    }]);
    expect(first.state.profiles).toEqual(source.profiles);
    expect(first.state.interests).toEqual([]);
    expect(repeated).toMatchObject({ ok: true, duplicate: true, request: { id: 'request-one' } });
    expect(repeated.state).toBe(first.state);
    expect(source).toEqual(snapshot);
  });

  it('preserves every pending request and evicts only the oldest handled records', () => {
    const pending = Array.from({ length: 198 }, (_value, index) => ({
      id: `pending-${index}`,
      type: 'self-check-in-assistance',
      playerName: `Pending Player ${index}`,
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    }));
    const handled = Array.from({ length: 5 }, (_value, index) => ({
      id: `handled-${index}`,
      type: 'self-check-in-assistance',
      playerName: `Handled Player ${index}`,
      reason: 'not-found',
      status: 'handled',
      createdAt: now,
      handledAt: now
    }));
    const source = state({ staffRequests: [...handled, ...pending] });
    const result = appendSelfCheckInAssistanceRequest(source, {
      id: 'new-pending',
      playerName: 'New Pending Player',
      reason: 'ambiguous',
      createdAt: now
    });

    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) return;
    expect(result.state.staffRequests).toHaveLength(200);
    expect(result.state.staffRequests.filter((request) => request.status === 'pending')).toHaveLength(199);
    expect(result.state.staffRequests.filter((request) => request.status === 'handled').map((request) => request.id))
      .toEqual(['handled-4']);
    expect(pending.every((request) => result.state.staffRequests.some((candidate) => candidate.id === request.id))).toBe(true);

    const nearCapacity = state({ staffRequests: [...handled, ...pending, {
      id: 'pending-198',
      type: 'self-check-in-assistance',
      playerName: 'Pending Player 198',
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    }] });
    const boundary = appendSelfCheckInAssistanceRequest(nearCapacity, {
      id: 'boundary-pending',
      playerName: 'Boundary Pending Player',
      reason: 'ambiguous',
      createdAt: now
    });
    expect(boundary).toMatchObject({ ok: true, duplicate: false });
    if (!boundary.ok) return;
    expect(boundary.state.staffRequests).toHaveLength(200);
    expect(boundary.state.staffRequests.every((request) => request.status === 'pending')).toBe(true);
  });

  it('fails closed without changing state once 200 assistance requests are pending', () => {
    const pending = Array.from({ length: 200 }, (_value, index) => ({
      id: `pending-${index}`,
      type: 'self-check-in-assistance',
      playerName: `Pending Player ${index}`,
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    }));
    const source = state({ staffRequests: pending });
    const result = appendSelfCheckInAssistanceRequest(source, {
      id: 'overflow',
      playerName: 'Overflow Player',
      reason: 'ambiguous',
      createdAt: now
    });

    expect(result).toEqual({ ok: false, code: 'SELF_CHECK_IN_ASSISTANCE_QUEUE_FULL', state: source });
    expect(source.staffRequests).toHaveLength(200);
  });

  it('seats a known player at the first live seat and updates every floor-facing list', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const result = seatSelfCheckInPlayer(source, {
      profileId: profile.id,
      tableId: 'table-one',
      timestamp: now,
      interestId: 'self-interest',
      playerSessionId: 'self-session',
      ledgerId: 'self-ledger'
    });

    expect(result).toMatchObject({ ok: true, seatNumber: 1, playerName: profile.name, tableId: 'table-one' });
    if (!result.ok) return;
    expect(result.state.sessions[0]).toMatchObject({ status: 'Running', seatsFilled: 1 });
    expect(result.state.playerSessions.at(-1)).toMatchObject({
      id: 'self-session', profileId: profile.id, tableId: 'table-one', seatNumber: 1, timeFeeEnabled: false
    });
    expect(result.state.interests.at(-1)).toMatchObject({
      id: 'self-interest', profileId: profile.id, gameId: 'game-one', status: 'Seated', seatedAt: now
    });
    expect(result.state.playerLedger[0]).toMatchObject({
      id: 'self-ledger', type: 'Check-In', profileId: profile.id, tableId: 'table-one', note: 'Self-check-in: seat 1'
    });
    expect(result.state.profiles[0]).toMatchObject({ gamePlayCounts: { 'game-one': 1 }, preferredGameIds: ['game-one'] });
    expect(source).toEqual(snapshot);
  });

  it.each([
    ['missing profile', { profileId: 'missing', tableId: 'table-one' }, 'PLAYER_NOT_FOUND'],
    ['missing table', { profileId: profile.id, tableId: 'missing' }, 'TABLE_UNAVAILABLE'],
    ['full table', { profileId: profile.id, tableId: 'table-full' }, 'TABLE_UNAVAILABLE'],
    ['paused table', { profileId: profile.id, tableId: 'table-paused' }, 'TABLE_UNAVAILABLE'],
    ['already seated', { profileId: profile.id, tableId: 'table-one' }, 'ALREADY_SEATED']
  ])('rejects %s without changing state', (_label, input, code) => {
    const source = input.profileId === profile.id && code === 'ALREADY_SEATED'
      ? state({ playerSessions: [{ id: 'active', profileId: profile.id, playerName: profile.name, gameId: 'game-one', tableId: 'table-one', seatNumber: 1, seatedAt: now }] })
      : state();
    const snapshot = structuredClone(source);
    const result = seatSelfCheckInPlayer(source, {
      ...input,
      timestamp: now,
      interestId: 'interest',
      playerSessionId: 'session',
      ledgerId: 'ledger'
    });
    expect(result).toMatchObject({ ok: false, code });
    expect(source).toEqual(snapshot);
  });
});
