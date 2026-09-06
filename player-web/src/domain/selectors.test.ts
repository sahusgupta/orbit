import { describe, expect, it } from 'vitest';
import {
  clubRouteKey,
  entityRouteKey,
  filterClubs,
  filterGames,
  filterTournaments,
  findClubByRouteKey,
  findGameByRouteKey,
  findTournamentByRouteKey,
  formatBuyIn,
  formatDistance,
  formatTournamentAddOns,
  formatTournamentRebuys,
  gameRouteKey,
  getActivePlayerRequests,
  getGameAvailabilityLabel,
  getGamePrimaryAction,
  getRunningAvailableSeats,
  getGameState,
  getGameStateLabel,
  getGameTypeLabel,
  getMembershipState,
  getNextTournamentInterestBoundary,
  getTournamentInterestLabel,
  getTournamentInterestState,
  getTournamentInterestTimingLabel,
  getStakesLabel,
  slugify,
  tournamentRouteKey
} from './selectors';
import { clubAlpha, clubBeta, discovery, formingGame, interest, openTournament, paidTournament, player, runningGame, scheduledGame } from '@/tests/fixtures';

const gameFilters = { query: '', gameType: 'all', stakes: 'all', venue: 'all', status: 'all', distance: '0' };

describe('Player Web domain selectors', () => {
  it('normalizes route labels without losing a usable fallback', () => {
    expect(slugify('  Sunday Orbit Major! ')).toBe('sunday-orbit-major');
    expect(slugify('***')).toBe('orbit');
  });

  it('builds deterministic entity keys that do not expose raw separators', () => {
    expect(entityRouteKey('Game', 'club/one', 'game/two')).toMatch(/^game--[A-Za-z0-9_-]+$/);
    expect(entityRouteKey('Game', 'club/one', 'game/two')).toBe(entityRouteKey('Game', 'club/one', 'game/two'));
  });

  it('resolves direct club links by route key and canonical id', () => {
    expect(findClubByRouteKey(discovery.clubs, clubRouteKey(clubAlpha))).toBe(clubAlpha);
    expect(findClubByRouteKey(discovery.clubs, 'club-beta')).toBe(clubBeta);
  });

  it('resolves direct game links by route key and canonical id', () => {
    expect(findGameByRouteKey(discovery.clubs, gameRouteKey(clubAlpha, runningGame))?.game).toBe(runningGame);
    expect(findGameByRouteKey(discovery.clubs, 'game-forming')?.game).toBe(formingGame);
  });

  it('requires a canonical game route when a raw ID is ambiguous across clubs', () => {
    const duplicate = { ...runningGame, name: 'River NLH' };
    const betaWithDuplicate = { ...clubBeta, games: [duplicate] };
    expect(findGameByRouteKey([clubAlpha, betaWithDuplicate], runningGame.id)).toBeUndefined();
    expect(findGameByRouteKey([clubAlpha, betaWithDuplicate], gameRouteKey(clubAlpha, runningGame))?.club).toBe(clubAlpha);
    expect(findGameByRouteKey([clubAlpha, betaWithDuplicate], gameRouteKey(betaWithDuplicate, duplicate))?.club).toBe(betaWithDuplicate);
  });

  it('resolves direct tournament links by route key and canonical id', () => {
    expect(findTournamentByRouteKey(discovery, tournamentRouteKey(clubAlpha, openTournament))).toBe(openTournament);
    expect(findTournamentByRouteKey(discovery, 'event-paid')).toBe(paidTournament);
  });

  it('requires a canonical tournament route when a raw ID is ambiguous across clubs', () => {
    const duplicate = { ...openTournament, clubId: clubBeta.club.id, name: 'River Orbit Major' };
    const collisions = { ...discovery, tournaments: [openTournament, duplicate] };
    expect(findTournamentByRouteKey(collisions, openTournament.id)).toBeUndefined();
    expect(findTournamentByRouteKey(collisions, tournamentRouteKey(clubAlpha, openTournament))).toBe(openTournament);
    expect(findTournamentByRouteKey(collisions, tournamentRouteKey(clubBeta, duplicate))).toBe(duplicate);
  });

  it('distinguishes published table states without inventing a schedule', () => {
    expect(getGameState(runningGame)).toBe('running');
    expect(getGameState(formingGame)).toBe('forming');
    expect(getGameState(scheduledGame)).toBe('unavailable');
  });

  it('uses consistent player-facing status vocabulary', () => {
    expect(getGameStateLabel('running')).toBe('Running now');
    expect(getGameStateLabel('forming')).toBe('Forming');
    expect(getGameStateLabel('unavailable')).toBe('Status unavailable');
  });

  it('shows availability only when a published table state supports it', () => {
    expect(getGameAvailabilityLabel(runningGame)).toBe('2 open seats');
    expect(getGameAvailabilityLabel({
      ...runningGame,
      availableSeats: 0,
      waitlistCount: 0,
      openTables: runningGame.openTables.map((table) => ({ ...table, availableSeats: 0 }))
    })).toBe('0 waiting');
    expect(getGameAvailabilityLabel(formingGame)).toBe('4 interested');
    expect(getGameAvailabilityLabel(scheduledGame)).toBe('Availability unavailable');
  });

  it('uses only Running tables for running-seat availability and actions', () => {
    const mixed = {
      ...runningGame,
      availableSeats: 99,
      openTables: [
        { ...runningGame.openTables[0], availableSeats: 0 },
        { ...formingGame.openTables[0], availableSeats: 7 }
      ]
    };
    expect(getRunningAvailableSeats(mixed)).toBe(0);
    expect(getGameAvailabilityLabel(mixed)).toBe('3 waiting');
    expect(getGamePrimaryAction(mixed)).toBe('Join waitlist');
  });

  it('extracts stakes without inventing missing values', () => {
    expect(getStakesLabel(runningGame)).toBe('1/2');
    expect(getStakesLabel({ ...runningGame, name: 'Dealer Choice' })).toBe('Stakes unavailable');
  });

  it('classifies only familiar game types and does not invent NLH for an unknown name', () => {
    expect(getGameTypeLabel(runningGame)).toBe('NLH');
    expect(getGameTypeLabel(formingGame)).toBe('PLO');
    expect(getGameTypeLabel(scheduledGame)).toBe('Limit');
    expect(getGameTypeLabel({ ...runningGame, name: 'Dealer Choice' })).toBe('Other');
  });

  it('adapts the primary action to live game state', () => {
    expect(getGamePrimaryAction(runningGame)).toBe("I'm here");
    expect(getGamePrimaryAction({
      ...runningGame,
      availableSeats: 0,
      openTables: runningGame.openTables.map((table) => ({ ...table, availableSeats: 0 }))
    })).toBe('Join waitlist');
    expect(getGamePrimaryAction(formingGame)).toBe("I'm interested");
    expect(getGamePrimaryAction(scheduledGame)).toBe("I'm interested");
  });

  it('filters already-loaded games by text without a transport round trip', () => {
    expect(filterGames(discovery.clubs, { ...gameFilters, query: 'river' }).map((item) => item.club.club.id)).toEqual(['club-beta']);
  });

  it('filters games by primary status', () => {
    expect(filterGames(discovery.clubs, { ...gameFilters, status: 'forming' }).map((item) => item.game.id)).toEqual(['game-forming']);
  });

  it('filters games by game type and stakes', () => {
    expect(filterGames(discovery.clubs, { ...gameFilters, gameType: 'plo', stakes: '2/5' }).map((item) => item.game.id)).toEqual(['game-forming']);
  });

  it('filters games by venue while retaining public visibility', () => {
    expect(filterGames(discovery.clubs, { ...gameFilters, venue: 'club-alpha' })).toHaveLength(3);
  });

  it('orders active games ahead of forming and unavailable inventory', () => {
    expect(filterGames([clubAlpha], gameFilters).map((item) => item.state)).toEqual(['running', 'forming', 'unavailable']);
  });

  it('filters clubs by meaningful live activity', () => {
    expect(filterClubs(discovery.clubs, { query: '', distance: '0', activity: 'forming' }).map((club) => club.club.id)).toEqual(['club-alpha']);
  });

  it('filters tournaments by open interest state', () => {
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', interest: 'open' }).map((item) => item.tournament.id)).toEqual(['event-open']);
  });

  it('filters authenticated tournament discovery to expressed interests', () => {
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', interest: 'interested' }, player.id).map((item) => item.tournament.id)).toEqual(['event-open']);
  });

  it('does not attach one club interest to another club tournament with the same ID', () => {
    const duplicate = { ...openTournament, clubId: clubBeta.club.id, name: 'River Orbit Major' };
    const listings = filterTournaments(
      { ...discovery, tournaments: [openTournament, duplicate] },
      { query: '', club: 'all', distance: '0', interest: 'all' },
      player.id
    );
    expect(listings.find((listing) => listing.tournament.clubId === clubAlpha.club.id)?.interest).toBe(interest);
    expect(listings.find((listing) => listing.tournament.clubId === clubBeta.club.id)?.interest).toBeUndefined();
  });

  it('enforces the published tournament interest window even when a stale status says open', () => {
    const beforeOpen = Date.parse('2025-12-31T23:59:59.000Z');
    const afterClose = Date.parse('2030-06-16T17:00:00.000Z');
    expect(getTournamentInterestState(openTournament, beforeOpen)).toBe('not-open');
    expect(getTournamentInterestLabel(openTournament, beforeOpen)).toBe('Interest not open yet');
    expect(getTournamentInterestTimingLabel(openTournament, beforeOpen)).toContain('Interest opens');
    expect(getTournamentInterestState(openTournament, afterClose)).toBe('closed');
    expect(getTournamentInterestTimingLabel(openTournament, afterClose)).toBe('Interest window closed');
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', interest: 'open' }, '', null, beforeOpen)).toHaveLength(0);
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', interest: 'open' }, '', null, afterClose)).toHaveLength(0);
  });

  it('selects the next tournament boundary for a time-based refresh', () => {
    const now = Date.parse('2025-12-31T23:00:00.000Z');
    expect(getNextTournamentInterestBoundary([openTournament, paidTournament], now))
      .toBe(Date.parse(openTournament.interestOpensAt));
    expect(getNextTournamentInterestBoundary([openTournament], Date.parse(openTournament.startsAt)))
      .toBeNull();
  });

  it('omits a tournament when its published club snapshot is unavailable', () => {
    const withoutClub = { ...discovery, clubs: discovery.clubs.filter((club) => club.club.id !== openTournament.clubId) };
    expect(filterTournaments(withoutClub, { query: '', club: 'all', distance: '0', interest: 'all' })
      .some((listing) => listing.tournament.id === openTournament.id)).toBe(false);
  });

  it('derives active membership without changing canonical membership rules', () => {
    expect(getMembershipState(clubAlpha, player, Date.parse('2030-06-15T00:00:00.000Z'))).toBe('active');
    expect(getMembershipState(clubBeta, player)).toBe('none');
  });

  it('projects current player game requests for My Orbit', () => {
    const requests = getActivePlayerRequests([clubAlpha], player);
    expect(requests).toHaveLength(1);
    expect(requests[0].game?.id).toBe('game-running');
  });

  it('formats supported money and distance states plainly', () => {
    expect(formatBuyIn(openTournament)).toBe('Venue lists no buy-in');
    expect(formatBuyIn(paidTournament)).toBe('$240 venue-listed buy-in');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('Distance unavailable');
  });

  it('distinguishes prohibited tournament rebuys and add-ons from missing published details', () => {
    expect(formatTournamentRebuys(openTournament)).toBe('No rebuys');
    expect(formatTournamentAddOns(openTournament)).toBe('No add-ons');
    expect(formatTournamentRebuys({ ...openTournament, rebuysAllowed: true, rebuyPrice: undefined, rebuyStack: undefined })).toBe('Details not published');
    expect(formatTournamentAddOns({ ...openTournament, addOnsAllowed: true, addOnPrice: undefined, addOnStack: undefined })).toBe('Details not published');
  });
});
