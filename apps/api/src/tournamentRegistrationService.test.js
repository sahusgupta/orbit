import { describe, expect, it } from 'vitest';
import service from './tournamentRegistrationService';

const nowMs = Date.parse('2026-10-20T12:00:00Z');
const input = { clubId: 'club-one', tournamentId: 'event-one', player: { id: 'player-one', name: 'Verified Player', email: 'player@example.invalid' } };
const state = (overrides = {}) => ({
  settings: { clubAccount: { email: 'club-one' } }, profiles: [],
  buyIns: [{ id: 'buy-one', amount: 50 }], revenueTransactions: [], playerLedger: [],
  tournaments: [{ id: 'event-one', name: 'Launch Freeroll', status: 'Draft', registrationStatus: 'open',
    registrationOpensAt: '2026-10-01T00:00:00Z', registrationClosesAt: '2026-10-21T12:00:00Z',
    scheduledAt: '2026-10-21T13:00:00Z', buyIn: 0, startingStack: 10000, rebuysAllowed: false, addOnsAllowed: false,
    players: [], ...overrides }]
});

describe('no-payment tournament registration', () => {
  it('adds an authenticated entrant using the existing operational shape without financial writes', () => {
    const source = state();
    const result = service.applyTournamentRegistration(source, input, { nowMs, entryId: 'tr_fixture' });
    expect(result).toMatchObject({ ok: true, changed: true, registration: {
      id: 'tr_fixture', playerId: 'player-one', clubId: 'club-one', tournamentId: 'event-one', status: 'registered'
    } });
    expect(result.state.tournaments[0].players).toEqual([{
      id: 'tr_fixture', registrationId: 'tr_fixture', profileId: 'player-one', name: 'Verified Player',
      email: 'player@example.invalid', buyIn: 0, rebuys: 0, addOns: 0, startingStack: 10000,
      status: 'Registered', registeredAt: new Date(nowMs).toISOString()
    }]);
    expect(result.state.buyIns).toBe(source.buyIns);
    expect(result.state.revenueTransactions).toBe(source.revenueTransactions);
    expect(result.state.playerLedger).toBe(source.playerLedger);
    expect(source.tournaments[0].players).toEqual([]);
  });

  it.each([
    { buyIn: 50 }, { buyIn: undefined }, { buyIn: '0' },
    { rebuysAllowed: true, rebuyPrice: 10 }, { rebuysAllowed: true },
    { addOnsAllowed: true, addOnPrice: 5 }, { addOnsAllowed: true },
    { rebuysAllowed: 'false' }, { addOnsAllowed: null }
  ])('rejects nonzero or unpublished payment terms %j', (terms) => {
    expect(service.applyTournamentRegistration(state(terms), input, { nowMs })).toEqual({ ok: false, code: 'PLAYER_TOURNAMENT_PAYMENT_NOT_SUPPORTED' });
  });

  it('permits explicitly free extra entries without creating any of them', () => {
    const result = service.applyTournamentRegistration(state({ rebuysAllowed: true, rebuyPrice: 0, addOnsAllowed: true, addOnPrice: 0 }), input, { nowMs });
    expect(result.state.tournaments[0].players[0]).toMatchObject({ buyIn: 0, rebuys: 0, addOns: 0 });
  });

  it('deduplicates a linked venue profile and returns only the requesting player projection', () => {
    const source = { ...state(), profiles: [{ id: 'venue-profile', orbitPlayerId: 'player-one', name: 'Venue Profile' }] };
    const first = service.applyTournamentRegistration(source, input, { nowMs, entryId: 'tr_first' });
    const second = service.applyTournamentRegistration(first.state, input, { nowMs, entryId: 'tr_second' });
    expect(second.changed).toBe(false);
    expect(second.state.tournaments[0].players).toHaveLength(1);
    expect(second.registration.id).toBe('tr_first');
    expect(service.buildPlayerTournamentRegistration(second.state, 'club-one', 'event-one', 'other-player')).toBeUndefined();
    expect(service.buildPlayerTournamentRegistration(second.state, 'other-club', 'event-one', 'player-one')).toBeUndefined();
    expect(service.buildPlayerTournamentRegistration(second.state, 'club-one', 'event-one', 'player-one')).toEqual(first.registration);
    expect(first.state.tournaments[0].players[0].profileId).toBe('venue-profile');
  });

  it.each([
    { status: 'Running' }, { registrationStatus: 'closed' },
    { registrationOpensAt: '2026-10-21T00:00:00Z' }, { registrationClosesAt: new Date(nowMs).toISOString() },
    { scheduledAt: new Date(nowMs).toISOString() }
  ])('fails closed at event/window boundaries %j', (terms) => {
    expect(service.applyTournamentRegistration(state(terms), input, { nowMs })).toEqual({ ok: false, code: 'TOURNAMENT_REGISTRATION_CLOSED' });
  });

  it('rejects cross-club input and never identifies an entrant by email', () => {
    const source = state({ players: [{ id: 'other-entry', profileId: 'other-player', email: input.player.email, registeredAt: new Date(nowMs).toISOString() }] });
    expect(service.applyTournamentRegistration(source, { ...input, clubId: 'other-club' }, { nowMs }).code).toBe('CLUB_NOT_FOUND');
    expect(service.buildPlayerTournamentRegistration(source, 'club-one', 'event-one', 'player-one')).toBeUndefined();
  });
});
