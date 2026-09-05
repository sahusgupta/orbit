import { describe, expect, it } from 'vitest';
import service from './tournamentInterestService.js';

const {
  applyTournamentInterestTransition,
  buildPlayerTournamentInterests,
  interestWindow,
  parseTournamentInterestRequest
} = service;

const now = '2026-09-04T18:00:00.000Z';
const nowMs = Date.parse(now);

function state(tournamentOverrides = {}, stateOverrides = {}) {
  return {
    games: [], sessions: [], playerSessions: [], profiles: [], interests: [],
    tournaments: [{
      id: 'event-one',
      name: 'Fall Classic',
      status: 'Draft',
      registrationStatus: 'open',
      registrationOpensAt: '2026-09-01T18:00:00.000Z',
      registrationClosesAt: '2026-09-05T18:00:00.000Z',
      scheduledAt: '2026-09-06T18:00:00.000Z',
      unregisterAllowed: true,
      buyIn: 500,
      rebuyPrice: 500,
      addOnPrice: 250,
      players: [{ id: 'staff-entry', profileId: 'other-player', buyIn: 500, rebuys: 1, addOns: 1 }],
      ...tournamentOverrides
    }],
    buyIns: [{ id: 'buy-one', amount: 500 }],
    playerLedger: [{ id: 'ledger-one', amount: 500 }],
    revenueTransactions: [{ id: 'revenue-one', amount: 500 }],
    settings: { pilotAccess: { licenseId: 'club-one' } },
    ...stateOverrides
  };
}

const input = {
  action: 'express',
  clubId: 'club-one',
  tournamentId: 'event-one',
  playerId: 'firebase-player-one'
};

describe('tournament interest contract', () => {
  it('accepts only exact, bounded, opaque request fields', () => {
    expect(parseTournamentInterestRequest({
      clubId: 'club-one', tournamentId: 'event-one', mutationId: '550e8400-e29b-41d4-a716-446655440000'
    })).toMatchObject({ ok: true });
    expect(parseTournamentInterestRequest({
      clubId: 'club-one', tournamentId: 'event-one', mutationId: 'short'
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(parseTournamentInterestRequest({
      clubId: 'club-one', tournamentId: 'event-one', mutationId: 'private-player@example.test'
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(parseTournamentInterestRequest({
      clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request', playerId: 'another-player'
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(parseTournamentInterestRequest({
      clubId: '../club-one', tournamentId: 'event-one', mutationId: 'opaque-request'
    })).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it.each([
    ['free', { buyIn: 0 }],
    ['paid', { buyIn: 500 }],
    ['rebuy and add-on', { buyIn: 500, rebuyPrice: 500, addOnPrice: 250 }]
  ])('stores %s event interest separately without changing entrants or finances', (_label, tournamentOverrides) => {
    const source = state(tournamentOverrides);
    const operationalBefore = structuredClone({
      tournaments: source.tournaments,
      buyIns: source.buyIns,
      playerLedger: source.playerLedger,
      revenueTransactions: source.revenueTransactions
    });
    const result = applyTournamentInterestTransition(source, input, {
      now,
      nowMs,
      createId: () => '00000000-0000-4000-8000-000000000001'
    });

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      interest: {
        id: 'ti_00000000-0000-4000-8000-000000000001',
        clubId: 'club-one',
        tournamentId: 'event-one',
        playerId: 'firebase-player-one',
        status: 'interested',
        createdAt: now,
        updatedAt: now
      }
    });
    expect({
      tournaments: result.state.tournaments,
      buyIns: result.state.buyIns,
      playerLedger: result.state.playerLedger,
      revenueTransactions: result.state.revenueTransactions
    }).toEqual(operationalBefore);
    expect(JSON.stringify(result.interest)).not.toContain('500');
  });

  it('is logically idempotent and permits an explicit withdraw/reactivate lifecycle', () => {
    const expressed = applyTournamentInterestTransition(state(), input, { now, nowMs, createId: () => 'interest-id' });
    const replay = applyTournamentInterestTransition(expressed.state, input, { now, nowMs, createId: () => 'different-id' });
    expect(replay).toMatchObject({ ok: true, changed: false, interest: expressed.interest });

    const withdrawnAt = '2026-09-04T19:00:00.000Z';
    const withdrawn = applyTournamentInterestTransition(expressed.state, { ...input, action: 'withdraw' }, {
      now: withdrawnAt,
      nowMs: Date.parse(withdrawnAt)
    });
    expect(withdrawn.interest).toMatchObject({
      id: expressed.interest.id,
      status: 'withdrawn',
      withdrawnAt
    });
    const withdrawReplay = applyTournamentInterestTransition(withdrawn.state, { ...input, action: 'withdraw' }, {
      now: '2026-09-04T20:00:00.000Z', nowMs: Date.parse('2026-09-04T20:00:00.000Z')
    });
    expect(withdrawReplay).toMatchObject({ ok: true, changed: false, interest: withdrawn.interest });

    const reactivated = applyTournamentInterestTransition(withdrawn.state, input, {
      now: '2026-09-04T20:00:00.000Z', nowMs: Date.parse('2026-09-04T20:00:00.000Z')
    });
    expect(reactivated.interest).toMatchObject({ id: expressed.interest.id, status: 'interested' });
    expect(reactivated.interest).not.toHaveProperty('withdrawnAt');
  });

  it('fails closed for missing, not-yet-open, closed, and expired events', () => {
    expect(applyTournamentInterestTransition(state(), { ...input, tournamentId: 'missing' }, { now, nowMs }))
      .toMatchObject({ ok: false, code: 'TOURNAMENT_NOT_FOUND' });
    expect(interestWindow(state({ registrationOpensAt: '2026-09-05T17:00:00.000Z' }).tournaments[0], nowMs))
      .toEqual({ open: false, code: 'TOURNAMENT_INTEREST_NOT_OPEN' });
    expect(applyTournamentInterestTransition(state({ registrationStatus: 'closed' }), input, { now, nowMs }))
      .toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_CLOSED' });
    expect(applyTournamentInterestTransition(state({ registrationClosesAt: now }), input, { now, nowMs }))
      .toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_CLOSED' });
    for (const status of ['Running', 'Paused', 'Finished']) {
      expect(applyTournamentInterestTransition(state({ status }), input, { now, nowMs }))
        .toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_CLOSED' });
    }
    expect(applyTournamentInterestTransition(state({
      scheduledAt: '2026-09-04T17:59:59.000Z',
      registrationClosesAt: '2026-09-05T18:00:00.000Z'
    }), input, { now, nowMs })).toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_CLOSED' });
  });

  it('allows withdrawal only when the venue explicitly permits it and the event has not started', () => {
    const expressed = applyTournamentInterestTransition(state(), input, { now, nowMs, createId: () => 'interest-id' });
    expect(applyTournamentInterestTransition(
      { ...expressed.state, tournaments: [{ ...expressed.state.tournaments[0], unregisterAllowed: false }] },
      { ...input, action: 'withdraw' },
      { now, nowMs }
    )).toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_WITHDRAWAL_CLOSED' });
    expect(applyTournamentInterestTransition(
      { ...expressed.state, tournaments: [{ ...expressed.state.tournaments[0], scheduledAt: now }] },
      { ...input, action: 'withdraw' },
      { now, nowMs }
    )).toMatchObject({ ok: false, code: 'TOURNAMENT_INTEREST_WITHDRAWAL_CLOSED' });
  });

  it('returns only the authenticated player interests from the selected venue', () => {
    const records = [
      { id: 'own', clubId: 'club-one', tournamentId: 'event-one', playerId: 'firebase-player-one', status: 'interested', createdAt: now, updatedAt: now },
      { id: 'other', clubId: 'club-one', tournamentId: 'event-one', playerId: 'other-player', status: 'interested', createdAt: now, updatedAt: now },
      { id: 'venue', clubId: 'club-two', tournamentId: 'event-one', playerId: 'firebase-player-one', status: 'interested', createdAt: now, updatedAt: now },
      { id: 'invalid', clubId: 'club-one', tournamentId: 'event-one', playerId: 'firebase-player-one', status: 'registered', createdAt: now, updatedAt: now },
      { id: 'missing-updated', clubId: 'club-one', tournamentId: 'event-one', playerId: 'firebase-player-one', status: 'interested', createdAt: now },
      { id: 'bad-created', clubId: 'club-one', tournamentId: 'event-one', playerId: 'firebase-player-one', status: 'interested', createdAt: 'invalid', updatedAt: now }
    ];
    expect(buildPlayerTournamentInterests({ tournamentInterests: records }, 'club-one', 'firebase-player-one'))
      .toEqual([records[0]]);
  });
});
