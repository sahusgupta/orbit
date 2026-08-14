import {
  getClubDistance,
  getVenueKind,
  homeCoordinate
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

export const defaultCoordinate = homeCoordinate;

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
  return 'scheduled';
}

export function getGameStateLabel(state: GameState) {
  if (state === 'running') return 'Running now';
  if (state === 'forming') return 'Forming';
  if (state === 'paused') return 'Paused';
  return 'Scheduled';
}

export function getStakesLabel(game: PlayerSyncGame) {
  return game.name.match(stakesPattern)?.[0]?.replace(/\s/g, '') ?? 'Stakes listed by club';
}

export function getGameTypeLabel(game: PlayerSyncGame) {
  const normalized = game.name.toLowerCase();
  if (normalized.includes('plo') || normalized.includes('omaha')) return 'PLO';
  if (normalized.includes('limit') && !normalized.includes('no limit')) return 'Limit';
  if (normalized.includes('mixed')) return 'Mixed';
  return 'NLH';
}

export function getGamePrimaryAction(game: PlayerSyncGame) {
  const state = getGameState(game);
  if (state === 'forming') return "I'm interested";
  if (state === 'running' && game.availableSeats > 0) return "I'm here";
  if (state === 'running') return 'Join waitlist';
  return 'View club';
}

export function flattenGames(clubs: PlayerClubSnapshot[], origin: Coordinate = defaultCoordinate): GameListing[] {
  return clubs.flatMap((club) => club.games.map((game) => ({
    club,
    game,
    state: getGameState(game),
    distanceMiles: getClubDistance(club, origin),
    stakes: getStakesLabel(game)
  })));
}

export function filterGames(clubs: PlayerClubSnapshot[], filters: GameFilters, origin: Coordinate = defaultCoordinate) {
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
      if (Number.isFinite(maximumDistance) && maximumDistance > 0 && distanceMiles > maximumDistance) return false;
      return true;
    })
    .sort((left, right) => {
      const rank: Record<GameState, number> = { running: 0, forming: 1, paused: 2, scheduled: 3 };
      return rank[left.state] - rank[right.state]
        || right.game.availableSeats - left.game.availableSeats
        || left.distanceMiles - right.distanceMiles;
    });
}

export function filterClubs(clubs: PlayerClubSnapshot[], filters: ClubFilters, origin: Coordinate = defaultCoordinate) {
  const query = filters.query.trim().toLowerCase();
  const maximumDistance = Number(filters.distance);
  return [...clubs]
    .filter((club) => {
      const searchText = `${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`.toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (filters.activity === 'active' && !club.games.some((game) => getGameState(game) === 'running')) return false;
      if (filters.activity === 'forming' && !club.games.some((game) => getGameState(game) === 'forming')) return false;
      const distance = getClubDistance(club, origin);
      return !Number.isFinite(maximumDistance) || maximumDistance <= 0 || distance <= maximumDistance;
    })
    .sort((left, right) => getClubDistance(left, origin) - getClubDistance(right, origin));
}

export function filterTournaments(
  discovery: DiscoveryPayload,
  filters: TournamentFilters,
  playerId = '',
  origin: Coordinate = defaultCoordinate
): TournamentListing[] {
  const query = filters.query.trim().toLowerCase();
  const maximumDistance = Number(filters.distance);
  return discovery.tournaments
    .map((tournament) => {
      const club = discovery.clubs.find((candidate) => candidate.club.id === tournament.clubId);
      const registration = discovery.registrations.find((candidate) =>
        candidate.tournamentId === tournament.id && (!playerId || candidate.playerId === playerId));
      return {
        tournament,
        club,
        registration,
        distanceMiles: club ? getClubDistance(club, origin) : Number.POSITIVE_INFINITY
      };
    })
    .filter(({ tournament, club, registration, distanceMiles }) => {
      const searchText = `${tournament.name} ${club?.club.name ?? ''} ${tournament.prizePoolLabel}`.toLowerCase();
      if (query && !searchText.includes(query)) return false;
      if (filters.club !== 'all' && tournament.clubId !== filters.club) return false;
      if (filters.registration === 'open' && tournament.registrationStatus !== 'open') return false;
      if (filters.registration === 'free' && tournament.buyIn !== 0) return false;
      if (filters.registration === 'registered' && !registration) return false;
      if (Number.isFinite(maximumDistance) && maximumDistance > 0 && distanceMiles > maximumDistance) return false;
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

export function formatDistance(distanceMiles: number) {
  return Number.isFinite(distanceMiles) ? `${distanceMiles.toFixed(distanceMiles < 10 ? 1 : 0)} mi` : 'Distance unavailable';
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
  return tournament.buyIn === 0 ? 'Free entry' : `$${tournament.buyIn.toLocaleString()} buy-in`;
}
