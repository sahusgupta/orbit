import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, PlayerProfile, Tournament } from '../../domain/types';
import {
  addTournamentEntry,
  advanceTournamentLevel,
  checkInTournamentPlayer,
  createTournament,
  drawTournamentTables,
  eliminateTournamentPlayer,
  pauseTournament,
  registerTournamentPlayer,
  rerunTournament,
  resumeTournament,
  startTournament,
  updateTournamentPayout,
  updateTournamentSettings,
  validateTournamentPayoutDrafts
} from './tournamentCommands';

const now = '2026-08-08T22:00:00.000Z';
const tournament = (overrides: Partial<Tournament> = {}): Tournament => ({
  id: 'tournament-one',
  name: 'Command Tournament',
  status: 'Draft',
  createdAt: '2026-08-08T18:00:00.000Z',
  currentLevelIndex: 0,
  buyIn: 100,
  startingStack: 20_000,
  rebuyPrizePercent: 50,
  tableSize: 2,
  levels: [
    { id: 'level-1', level: 1, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 10, breakAfter: false, breakMinutes: 0 },
    { id: 'level-2', level: 2, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: 15, breakAfter: false, breakMinutes: 0 }
  ],
  players: [
    { id: 'player-one', name: 'One', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000, status: 'Registered', registeredAt: now },
    { id: 'player-two', name: 'Two', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000, status: 'Registered', registeredAt: now },
    { id: 'player-eliminated', name: 'Out', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000, status: 'Eliminated', registeredAt: now }
  ],
  payouts: [{ place: 1, percent: 100 }],
  ...overrides
});
const profile: PlayerProfile = {
  id: 'profile-register', name: 'Registered Profile', phone: '555-0101', birthday: '', membershipStartDate: '', membershipExpirationDate: '',
  totalTimePlayedHours: 0, lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'game', preferredGameIds: ['game'],
  gamePlayCounts: {}, mostPlayedGameId: 'game', preferredStakes: '', typicalBuyInMin: 100, typicalBuyInMax: 300,
  willingnessToMove: true, typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: ''
};
const state = (events: Tournament[] = [tournament()], overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  tournaments: events,
  profiles: [],
  ...overrides
});
const dependencies = () => {
  let nextId = 0;
  return { createId: () => `created-${++nextId}`, nowIso: () => now };
};
const draft = {
  name: '  Created Event ', buyIn: '-10', startingStack: '500', levelMinutes: '2', rebuyPrizePercent: '120', tableSize: '99',
  payouts: [
    { place: 1, percent: '60' },
    { place: 2, percent: '25' },
    { place: 3, percent: '15' }
  ]
};

describe('management tournament commands', () => {
  it('creates, normalizes, edits, and reruns tournament structures without mutating sources', () => {
    const source = state([]);
    const snapshot = structuredClone(source);
    const created = createTournament(source, draft, dependencies());
    expect(created).not.toBeNull();
    if (!created) return;
    expect(created.tournament).toMatchObject({
      id: 'created-1', name: 'Created Event', status: 'Draft', createdAt: now,
      buyIn: 0, startingStack: 1000, rebuyPrizePercent: 100, tableSize: 10
    });
    expect(created.tournament.payouts).toEqual([
      { place: 1, percent: 60 },
      { place: 2, percent: 25 },
      { place: 3, percent: 15 }
    ]);
    expect(created.tournament.levels.every((level) => level.durationMinutes === 5)).toBe(true);
    expect(createTournament(source, { ...draft, name: ' ' }, dependencies())).toBeNull();
    expect(createTournament(source, { ...draft, payouts: undefined }, dependencies())?.tournament.payouts).toEqual([
      { place: 1, percent: 50 },
      { place: 2, percent: 30 },
      { place: 3, percent: 20 }
    ]);

    const updated = updateTournamentSettings(created.state, created.tournament.id, {
      name: '  Edited ', buyIn: '125', startingStack: '25000', levelMinutes: '30', rebuyPrizePercent: '60', tableSize: '8',
      payouts: [{ place: 1, percent: '70' }, { place: 2, percent: '30' }]
    });
    expect(updated).not.toBeNull();
    if (!updated) return;
    expect(updated.tournaments[0]).toMatchObject({ name: 'Edited', buyIn: 125, startingStack: 25_000, rebuyPrizePercent: 60, tableSize: 8 });
    expect(updated.tournaments[0].levels.every((level) => level.durationMinutes === 30)).toBe(true);
    expect(updated.tournaments[0].payouts).toEqual([{ place: 1, percent: 70 }, { place: 2, percent: 30 }]);
    expect(updateTournamentSettings(updated, created.tournament.id, {
      ...draft,
      payouts: undefined
    })?.tournaments[0].payouts).toEqual(updated.tournaments[0].payouts);

    const rerun = rerunTournament(source, tournament({ status: 'Finished', startedAt: now, completedAt: now, currentLevelIndex: 1 }), dependencies());
    expect(rerun.tournament).toMatchObject({ id: 'created-1', status: 'Draft', createdAt: now, currentLevelIndex: 0, players: [] });
    expect(rerun.tournament.startedAt).toBeUndefined();
    expect(rerun.tournament.completedAt).toBeUndefined();
    expect(source).toEqual(snapshot);
  });

  it('rejects non-sequential, out-of-range, and incomplete payout allocations atomically', () => {
    expect(validateTournamentPayoutDrafts([])).toMatchObject({ valid: false, total: 0 });
    expect(validateTournamentPayoutDrafts([
      { place: 1, percent: '60' },
      { place: 3, percent: '40' }
    ])).toMatchObject({ valid: false, error: expect.stringContaining('sequential') });
    expect(validateTournamentPayoutDrafts([{ place: 1, percent: '101' }])).toMatchObject({
      valid: false,
      error: expect.stringContaining('between 0% and 100%')
    });
    expect(validateTournamentPayoutDrafts([
      { place: 1, percent: '60' },
      { place: 2, percent: '30' }
    ])).toMatchObject({ valid: false, total: 90, error: expect.stringContaining('total 100%') });

    const source = state();
    const snapshot = structuredClone(source);
    expect(createTournament(source, {
      ...draft,
      payouts: [{ place: 1, percent: '90' }]
    }, dependencies())).toBeNull();
    expect(updateTournamentSettings(source, 'tournament-one', {
      ...draft,
      payouts: [{ place: 1, percent: '90' }]
    })).toBeNull();
    expect(source).toEqual(snapshot);
  });

  it('registers authoritative profiles and draws only non-eliminated players deterministically', () => {
    const source = state([tournament()], { profiles: [profile] });
    const registered = registerTournamentPlayer(source, source.tournaments[0], {
      name: 'Ignored', profileId: profile.id, phone: 'ignored', email: ' profile@example.test '
    }, dependencies());
    expect(registered).not.toBeNull();
    if (!registered) return;
    expect(registered.player).toEqual({
      id: 'created-1', profileId: profile.id, name: profile.name, phone: profile.phone,
      email: 'profile@example.test', buyIn: 100, rebuys: 0, addOns: 0, startingStack: 20_000,
      status: 'Registered', registeredAt: now
    });

    const randomValues = [0.9, 0.1, 0.5];
    const drawn = drawTournamentTables(registered.state, registered.state.tournaments[0], () => randomValues.shift() ?? 0);
    expect(drawn.tournaments[0].players.map((player) => [player.id, player.tableNumber, player.seatNumber])).toEqual([
      ['player-one', 1, 2],
      ['player-two', 1, 1],
      ['player-eliminated', undefined, undefined],
      ['created-1', 2, 1]
    ]);
    expect(registerTournamentPlayer(source, tournament({ id: 'missing' }), { name: ' ', profileId: '', phone: '', email: '' }, dependencies())).toBeNull();
  });

  it('preserves start, pause, resume, and bounded level clock fields', () => {
    const source = state();
    let result = startTournament(source, 'tournament-one', dependencies());
    expect(result.tournaments[0]).toMatchObject({ status: 'Running', startedAt: now, levelStartedAt: now, pausedRemainingSeconds: undefined });
    expect(result.tournaments[0].players.map((player) => player.status)).toEqual(['Active', 'Active', 'Eliminated']);

    result = pauseTournament(result, 'tournament-one', Date.parse(now) + 180_000, dependencies());
    expect(result.tournaments[0]).toMatchObject({ status: 'Paused', pausedAt: now, pausedRemainingSeconds: 420 });
    result = resumeTournament(result, 'tournament-one', 10, 420, Date.parse(now));
    expect(result.tournaments[0]).toMatchObject({ status: 'Running', levelStartedAt: '2026-08-08T21:57:00.000Z' });
    result = advanceTournamentLevel(result, 'tournament-one', 1, dependencies());
    expect(result.tournaments[0]).toMatchObject({ currentLevelIndex: 1, levelStartedAt: now, pausedRemainingSeconds: undefined });
    result = advanceTournamentLevel(result, 'tournament-one', 1, dependencies());
    expect(result.tournaments[0].currentLevelIndex).toBe(1);
    result = advanceTournamentLevel(result, 'tournament-one', -1, dependencies());
    expect(result.tournaments[0].currentLevelIndex).toBe(0);
  });

  it('checks in, increments entries, normalizes payouts, and maps elimination finish places', () => {
    let result = checkInTournamentPlayer(state(), 'tournament-one', 'player-one');
    expect(result.tournaments[0].players[0].status).toBe('Checked In');
    result = addTournamentEntry(result, 'tournament-one', 'player-one', 'rebuys');
    result = addTournamentEntry(result, 'tournament-one', 'player-one', 'addOns');
    expect(result.tournaments[0].players[0]).toMatchObject({ rebuys: 1, addOns: 1 });
    result = updateTournamentPayout(result, 'tournament-one', 2, -10);
    expect(result.tournaments[0].payouts).toEqual([{ place: 1, percent: 100 }, { place: 2, percent: 0 }]);
    result = updateTournamentPayout(result, 'tournament-one', 2, 150);
    expect(result.tournaments[0].payouts).toEqual([{ place: 1, percent: 100 }, { place: 2, percent: 100 }]);

    result = startTournament(result, 'tournament-one', dependencies());
    result = eliminateTournamentPlayer(result, result.tournaments[0], 'player-one', dependencies());
    expect(result.tournaments[0]).toMatchObject({ status: 'Finished', completedAt: now });
    expect(result.tournaments[0].players[0]).toMatchObject({ status: 'Eliminated', finishPlace: 2, eliminatedAt: now });
  });
});
