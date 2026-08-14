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
  gameRouteKey,
  getActivePlayerRequests,
  getGamePrimaryAction,
  getGameState,
  getGameStateLabel,
  getGameTypeLabel,
  getMembershipState,
  getStakesLabel,
  slugify,
  tournamentRouteKey
} from './selectors';
import { clubAlpha, clubBeta, discovery, formingGame, openTournament, paidTournament, player, runningGame, scheduledGame } from '@/tests/fixtures';

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

  it('resolves direct tournament links by route key and canonical id', () => {
    expect(findTournamentByRouteKey(discovery, tournamentRouteKey(clubAlpha, openTournament))).toBe(openTournament);
    expect(findTournamentByRouteKey(discovery, 'event-paid')).toBe(paidTournament);
  });

  it('distinguishes running, forming, and scheduled game states', () => {
    expect(getGameState(runningGame)).toBe('running');
    expect(getGameState(formingGame)).toBe('forming');
    expect(getGameState(scheduledGame)).toBe('scheduled');
  });

  it('uses consistent player-facing status vocabulary', () => {
    expect(getGameStateLabel('running')).toBe('Running now');
    expect(getGameStateLabel('forming')).toBe('Forming');
    expect(getGameStateLabel('scheduled')).toBe('Scheduled');
  });

  it('extracts stakes without inventing missing values', () => {
    expect(getStakesLabel(runningGame)).toBe('1/2');
    expect(getStakesLabel({ ...runningGame, name: 'Dealer Choice' })).toBe('Stakes listed by club');
  });

  it('classifies familiar game types from canonical names', () => {
    expect(getGameTypeLabel(runningGame)).toBe('NLH');
    expect(getGameTypeLabel(formingGame)).toBe('PLO');
    expect(getGameTypeLabel(scheduledGame)).toBe('Limit');
  });

  it('adapts the primary action to live game state', () => {
    expect(getGamePrimaryAction(runningGame)).toBe("I'm here");
    expect(getGamePrimaryAction({ ...runningGame, availableSeats: 0 })).toBe('Join waitlist');
    expect(getGamePrimaryAction(formingGame)).toBe("I'm interested");
    expect(getGamePrimaryAction(scheduledGame)).toBe('View club');
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

  it('orders active games ahead of forming and scheduled inventory', () => {
    expect(filterGames([clubAlpha], gameFilters).map((item) => item.state)).toEqual(['running', 'forming', 'scheduled']);
  });

  it('filters clubs by meaningful live activity', () => {
    expect(filterClubs(discovery.clubs, { query: '', distance: '0', activity: 'forming' }).map((club) => club.club.id)).toEqual(['club-alpha']);
  });

  it('filters tournaments by open registration and freeroll state', () => {
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', registration: 'open' }).map((item) => item.tournament.id)).toEqual(['event-open']);
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', registration: 'free' }).map((item) => item.tournament.id)).toEqual(['event-open']);
  });

  it('filters authenticated tournament discovery to registered events', () => {
    expect(filterTournaments(discovery, { query: '', club: 'all', distance: '0', registration: 'registered' }, player.id).map((item) => item.tournament.id)).toEqual(['event-open']);
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
    expect(formatBuyIn(openTournament)).toBe('Free entry');
    expect(formatBuyIn(paidTournament)).toBe('$240 buy-in');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('Distance unavailable');
  });
});
