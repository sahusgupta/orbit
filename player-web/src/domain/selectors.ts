import {
  getClubDistance,
  getVenueKind
} from '@orbit/player-domain/discovery';
import {
  isActivePlayerGameRequest,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry
} from '@orbit/player-domain/playerSync';
import type {
  ClubFilters,
  Coordinate,
  DiscoveryPayload,
  GameFilters,
  GameListing,
  GameState,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerSyncGame,
  PlayerTournament,
  TournamentFilters,
  TournamentListing
} from './types';

const stakesPattern = /\b\d+(?:\.\d+)?\s*[/-]\s*\d+(?:\.\d+)?\b/;

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'orbit';
}

function stableToken(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function entityRouteKey(label: string, clubId: string, entityId = clubId) {
  return `${slugify(label)}--${stableToken(`${clubId}\u0000${entityId}`)}`;
}

export function gameRouteKey(club: PlayerClubSnapshot, game: PlayerSyncGame) {
  return entityRouteKey(`${game.name}-${club.club.name}`, club.club.id, game.id);
}

export function clubRouteKey(club: PlayerClubSnapshot) {
  return entityRouteKey(club.club.name, club.club.id);
}

export function tournamentRouteKey(club: PlayerClubSnapshot | undefined, tournament: PlayerTournament) {
  return entityRouteKey(`${tournament.name}-${club?.club.name ?? 'orbit'}`, tournament.clubId, tournament.id);
}

export function findClubByRouteKey(clubs: PlayerClubSnapshot[], key: string) {
  return clubs.find((club) => clubRouteKey(club) === key || club.club.id === key);
}

export function findGameByRouteKey(clubs: PlayerClubSnapshot[], key: string) {
  return flattenGames(clubs).find(({ club, game }) => gameRouteKey(club, game) === key || game.id === key);
}

export function findTournamentByRouteKey(discovery: DiscoveryPayload, key: string) {
  return discovery.tournaments.find((tournament) => {
    const club = discovery.clubs.find((candidate) => candidate.club.id === tournament.clubId);
    return tournamentRouteKey(club, tournament) === key || tournament.id === key;
  });
}

export function getGameState(game: PlayerSyncGame): GameState {
  if (game.openTables.some((table) => table.status === 'Running')) return 'running';
  if (game.openTables.some((table) => table.status === 'Forming')) return 'forming';
  if (game.openTables.some((table) => table.status === 'Paused')) return 'paused';
  return 'unavailable';
}

export function getGameStateLabel(state: GameState) {
  if (state === 'running') return 'Running now';
  if (state === 'forming') return 'Forming';
  if (state === 'paused') return 'Paused';
  return 'Status unavailable';
}

export function getRunningAvailableSeats(game: PlayerSyncGame) {
  return game.openTables
    .filter((table) => table.status === 'Running')
    .reduce((total, table) => total + table.availableSeats, 0);
}

export function getFirstRunningTable(game: PlayerSyncGame) {
  return game.openTables.find((table) => table.status === 'Running');
}

export function getGameAvailabilityLabel(game: PlayerSyncGame) {
  const state = getGameState(game);
  if (state === 'running') {
    const availableSeats = getRunningAvailableSeats(game);
    return availableSeats > 0
      ? `${availableSeats} open seat${availableSeats === 1 ? '' : 's'}`
      : `${game.waitlistCount} waiting`;
  }
  if (state === 'forming') return `${game.waitlistCount} interested`;
  if (state === 'paused') return 'Availability paused';
  return 'Availability unavailable';
}

export function getStakesLabel(game: PlayerSyncGame) {
  return game.name.match(stakesPattern)?.[0]?.replace(/\s/g, '') ?? 'Stakes unavailable';
}

export function getGameTypeLabel(game: PlayerSyncGame) {
  const normalized = game.name.toLowerCase();
  if (normalized.includes('plo') || normalized.includes('omaha')) return 'PLO';
  if (normalized.includes('mixed')) return 'Mixed';
  if (/\bnlh\b|no[-\s]?limit\s+(?:texas\s+)?hold/.test(normalized)) return 'NLH';
  if (normalized.includes('limit')) return 'Limit';
  return 'Other';
}

export function getGamePrimaryAction(game: PlayerSyncGame) {
  const state = getGameState(game);
  if (state === 'running' && getRunningAvailableSeats(game) > 0) return "I'm here";
  if (state === 'running') return 'Join waitlist';
  return "I'm interested";
}

export function flattenGames(clubs: PlayerClubSnapshot[], origin: Coordinate | null = null): GameListing[] {
  return clubs.flatMap((club) => club.games.map((game) => ({
    club,
    game,
    state: getGameState(game),
    distanceMiles: getClubDistance(club, origin),
    stakes: getStakesLabel(game)
  })));
}

export function filterGames(clubs: PlayerClubSnapshot[], filters: GameFilters, origin: Coordinate | null = null) {
  const query = filters.query.trim().toLowerCase();
  const maximumDistance = Number(filters.distance);
  return flattenGames(clubs, origin)
    .filter(({ club, game, state, stakes, distanceMiles }) => {
      const searchText = `${game.name} ${club.club.name} ${club.club.address ?? ''}`.toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (filters.gameType !== 'all' && getGameTypeLabel(game).toLowerCase() !== filters.gameType) return false;
      if (filters.stakes !== 'all' && stakes !== filters.stakes) return false;
      if (filters.venue !== 'all' && club.club.id !== filters.venue) return false;
      if (filters.status !== 'all' && state !== filters.status) return false;
      if (Number.isFinite(maximumDistance) && maximumDistance > 0 && (distanceMiles == null || distanceMiles > maximumDistance)) return false;
      return true;
    })
    .sort((left, right) => {
      const rank: Record<GameState, number> = { running: 0, forming: 1, paused: 2, unavailable: 3 };
      return rank[left.state] - rank[right.state]
        || getRunningAvailableSeats(right.game) - getRunningAvailableSeats(left.game)
        || compareOptionalDistances(left.distanceMiles, right.distanceMiles);
    });
}

export function filterClubs(clubs: PlayerClubSnapshot[], filters: ClubFilters, origin: Coordinate | null = null) {
  const query = filters.query.trim().toLowerCase();
  const maximumDistance = Number(filters.distance);
  return [...clubs]
    .filter((club) => {
      const searchText = `${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`.toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (filters.activity === 'active' && !club.games.some((game) => getGameState(game) === 'running')) return false;
      if (filters.activity === 'forming' && !club.games.some((game) => getGameState(game) === 'forming')) return false;
      const distance = getClubDistance(club, origin);
      return !Number.isFinite(maximumDistance) || maximumDistance <= 0 || (distance != null && distance <= maximumDistance);
    })
    .sort((left, right) => compareOptionalDistances(getClubDistance(left, origin), getClubDistance(right, origin)));
}

export function filterTournaments(
  discovery: DiscoveryPayload,
  filters: TournamentFilters,
  playerId = '',
  origin: Coordinate | null = null,
  nowMs = Date.now()
): TournamentListing[] {
  const query = filters.query.trim().toLowerCase();
  const maximumDistance = Number(filters.distance);
  return discovery.tournaments
    .map((tournament) => {
      const club = discovery.clubs.find((candidate) => candidate.club.id === tournament.clubId);
      const interest = discovery.interests.find((candidate) =>
        candidate.tournamentId === tournament.id && (!playerId || candidate.playerId === playerId));
      return {
        tournament,
        club,
        interest,
        distanceMiles: club ? getClubDistance(club, origin) : null
      };
    })
    .filter(({ tournament, club, interest, distanceMiles }) => {
      // A tournament without its published venue snapshot is not actionable or
      // safe to render. Omit it until the related club arrives rather than
      // presenting an orphaned interest action.
      if (!club) return false;
      const searchText = `${tournament.name} ${club?.club.name ?? ''} ${tournament.prizePoolLabel}`.toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (filters.club !== 'all' && tournament.clubId !== filters.club) return false;
      if (filters.interest === 'open' && getTournamentInterestState(tournament, nowMs) !== 'open') return false;
      if (filters.interest === 'interested' && interest?.status !== 'interested') return false;
      if (Number.isFinite(maximumDistance) && maximumDistance > 0 && (distanceMiles == null || distanceMiles > maximumDistance)) return false;
      return true;
    })
    .sort((left, right) => Date.parse(left.tournament.startsAt) - Date.parse(right.tournament.startsAt));
}

export function getPlayerMembership(club: PlayerClubSnapshot, player: PlayerAccount | null) {
  return player ? club.memberships.find((membership) => isPlayerMembership(membership, player)) : undefined;
}

export function getMembershipState(club: PlayerClubSnapshot, player: PlayerAccount | null, now = Date.now()) {
  const membership = getPlayerMembership(club, player);
  if (!membership) return 'none' as const;
  if (membership.status === 'Requested' || membership.status === 'Approved') return 'requested' as const;
  return isMembershipCurrentlyActive(membership, now) ? 'active' as const : 'expired' as const;
}

export function getActivePlayerRequests(clubs: PlayerClubSnapshot[], player: PlayerAccount | null) {
  if (!player) return [];
  return clubs.flatMap((club) => club.waitlists
    .filter((entry) => isPlayerWaitlistEntry(entry, player) && isActivePlayerGameRequest(entry))
    .map((entry) => ({ club, entry, game: club.games.find((game) => game.id === entry.gameId) })));
}

export function getVenueLabel(club: PlayerClubSnapshot) {
  return getVenueKind(club);
}

export function formatDistance(distanceMiles: number | null) {
  return distanceMiles != null && Number.isFinite(distanceMiles) ? `${distanceMiles.toFixed(distanceMiles < 10 ? 1 : 0)} mi` : 'Distance unavailable';
}

export function getTournamentInterestState(tournament: PlayerTournament, nowMs = Date.now()) {
  const opensAt = Date.parse(tournament.interestOpensAt);
  const closesAt = Date.parse(tournament.interestClosesAt);
  const startsAt = Date.parse(tournament.startsAt);
  if (![opensAt, closesAt, startsAt].every(Number.isFinite) || tournament.interestStatus !== 'open') return 'closed' as const;
  if (nowMs < opensAt) return 'not-open' as const;
  if (nowMs >= closesAt || nowMs >= startsAt) return 'closed' as const;
  return 'open' as const;
}

export function getTournamentInterestLabel(tournament: PlayerTournament, nowMs = Date.now()) {
  const state = getTournamentInterestState(tournament, nowMs);
  if (state === 'open') return 'Interest open';
  if (state === 'not-open') return 'Interest not open yet';
  return 'Interest closed';
}

export function getTournamentInterestTimingLabel(tournament: PlayerTournament, nowMs = Date.now()) {
  const state = getTournamentInterestState(tournament, nowMs);
  if (state === 'open') return `Interest closes ${formatEventDate(tournament.interestClosesAt)}`;
  if (state === 'not-open') return `Interest opens ${formatEventDate(tournament.interestOpensAt)}`;
  return 'Interest window closed';
}

export function getNextTournamentInterestBoundary(tournaments: PlayerTournament[], nowMs = Date.now()) {
  const futureBoundaries = tournaments.flatMap((tournament) => [
    Date.parse(tournament.interestOpensAt),
    Date.parse(tournament.interestClosesAt),
    Date.parse(tournament.startsAt)
  ]).filter((boundary) => Number.isFinite(boundary) && boundary > nowMs);
  return futureBoundaries.length ? Math.min(...futureBoundaries) : null;
}

function compareOptionalDistances(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

export function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time to be announced';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatBuyIn(tournament: PlayerTournament) {
  if (tournament.buyIn == null) return 'Buy-in not published';
  return tournament.buyIn === 0 ? 'Venue lists no buy-in' : `$${tournament.buyIn.toLocaleString()} venue-listed buy-in`;
}

export function formatTournamentRebuys(tournament: PlayerTournament) {
  if (!tournament.rebuysAllowed) return 'No rebuys';
  if (tournament.rebuyPrice == null || tournament.rebuyStack == null) return 'Details not published';
  return `Venue lists ${tournament.unlimitedRebuys ? 'unlimited ' : ''}rebuys at $${tournament.rebuyPrice.toLocaleString()} for ${tournament.rebuyStack.toLocaleString()} chips`;
}

export function formatTournamentAddOns(tournament: PlayerTournament) {
  if (!tournament.addOnsAllowed) return 'No add-ons';
  if (tournament.addOnPrice == null || tournament.addOnStack == null) return 'Details not published';
  return `Venue lists $${tournament.addOnPrice.toLocaleString()} for ${tournament.addOnStack.toLocaleString()} chips`;
}
