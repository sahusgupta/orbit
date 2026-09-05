import {
  getPlayerSeatRequestAccess,
  isTournamentInterestOpen,
  isTournamentInterestFor,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerSyncGame,
  type PlayerTournament,
  type PlayerTournamentInterest
} from './playerSync';
import type {
  CasinoFilter,
  Coordinate,
  DiscoveryDecision,
  DistanceFilter,
  GameOpportunity,
  GameTypeFilter,
  MapVenueFilter,
  TournamentFilter,
  TournamentOpportunity
} from './playerTypes';

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function filterMapClubs(
  clubs: PlayerClubSnapshot[],
  mapQuery: string,
  mapDistanceFilter: DistanceFilter,
  mapVenueFilter: MapVenueFilter,
  originCoordinate: Coordinate | null
) {
  const query = mapQuery.trim().toLowerCase();
  return clubs
    .filter((club) => {
      const haystack = `${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      const distance = getClubDistance(club, originCoordinate);
      if (mapDistanceFilter !== 'none' && (distance == null || distance > mapDistanceFilter)) return false;
      if (mapVenueFilter === 'casino' && !isCasinoClub(club)) return false;
      if (mapVenueFilter === 'card-house' && getVenueKind(club) !== 'Card house') return false;
      if (mapVenueFilter === 'club' && getVenueKind(club) !== 'Poker club') return false;
      return true;
    })
    .sort((left, right) => compareOptionalDistances(getClubDistance(left, originCoordinate), getClubDistance(right, originCoordinate)));
}

export type FilterTournamentsOptions = {
  clubs: PlayerClubSnapshot[];
  originCoordinate: Coordinate | null;
  playerId: string;
  query: string;
  interests: PlayerTournamentInterest[];
  nowMs?: number;
  tournamentClubFilter: string;
  tournamentDistanceFilter: DistanceFilter;
  tournamentFilter: TournamentFilter;
  tournaments: PlayerTournament[];
};

export function isUpcomingTournament(tournament: Pick<PlayerTournament, 'startsAt'>, nowMs = Date.now()) {
  const startsAt = Date.parse(tournament.startsAt);
  return Number.isFinite(startsAt) && startsAt > nowMs;
}

export function filterTournaments({
  clubs,
  originCoordinate,
  playerId,
  query: rawQuery,
  interests,
  nowMs = Date.now(),
  tournamentClubFilter,
  tournamentDistanceFilter,
  tournamentFilter,
  tournaments
}: FilterTournamentsOptions): TournamentOpportunity[] {
  const query = rawQuery.trim().toLowerCase();
  return tournaments
    .map((tournament) => {
      const club = clubs.find((item) => item.club.id === tournament.clubId);
      const interest = interests.find((item) => isTournamentInterestFor(item, tournament) && item.playerId === playerId && item.status === 'interested');
      const distanceMiles = club ? getClubDistance(club, originCoordinate) : null;
      return { tournament, club, interest, distanceMiles };
    })
    .filter(({ tournament, club, interest, distanceMiles }) => {
      if (!club) return false;
      if (!isUpcomingTournament(tournament, nowMs)) return false;
      const haystack = `${tournament.name} ${club?.club.name ?? ''} ${club?.club.address ?? ''} ${tournament.prizePoolLabel ?? ''} ${tournament.rules.join(' ')}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (tournamentClubFilter !== 'all' && tournament.clubId !== tournamentClubFilter) return false;
      if (tournamentDistanceFilter !== 'none' && (distanceMiles == null || distanceMiles > tournamentDistanceFilter)) return false;
      if (tournamentFilter === 'open' && !isTournamentInterestOpen(tournament, nowMs)) return false;
      if (tournamentFilter === 'free' && tournament.buyIn !== 0) return false;
      if (tournamentFilter === 'interested' && !interest) return false;
      return true;
    })
    .sort((left, right) => Date.parse(left.tournament.startsAt) - Date.parse(right.tournament.startsAt));
}

export type BuildGameOpportunitiesOptions = {
  activePlayerGameKeys: Set<string>;
  distanceFilter: DistanceFilter;
  favoriteClubIds: string[];
  findGameClubs: PlayerClubSnapshot[];
  fitScoreFilterEnabled: boolean;
  gameQuery: string;
  gameTypeFilter: GameTypeFilter;
  joinedClubIds: Set<string>;
  nowMs?: number;
  player: PlayerAccount;
  playerHomeCoordinate: Coordinate | null;
  selectedCasinoFilter: CasinoFilter;
  selectedFilterClubId: string;
  stakesFilter: string;
};

export function buildGameOpportunities({
  activePlayerGameKeys,
  distanceFilter,
  favoriteClubIds,
  findGameClubs,
  fitScoreFilterEnabled,
  gameQuery,
  gameTypeFilter,
  joinedClubIds,
  nowMs = Date.now(),
  player,
  playerHomeCoordinate,
  selectedCasinoFilter,
  selectedFilterClubId,
  stakesFilter
}: BuildGameOpportunitiesOptions) {
  const query = gameQuery.trim().toLowerCase();
  const stakesQuery = stakesFilter.trim().toLowerCase();
  const hasLocationFilter = Boolean(player.homeLocation?.trim());
  return findGameClubs
    .flatMap<GameOpportunity>((club) => {
      const distanceMiles = getClubDistance(club, playerHomeCoordinate);
      const isJoined = joinedClubIds.has(club.club.id);
      const seatRequestAccess = getPlayerSeatRequestAccess(club, player, nowMs);
      const clubSearchText = getClubSearchText(club);
      const casinoClub = isCasinoClub(club);
      if (gameTypeFilter === 'favorites' && !favoriteClubIds.includes(club.club.id)) return [];
      if (casinoClub) {
        if (selectedCasinoFilter === 'none') return [];
        if (selectedCasinoFilter !== 'all' && club.club.id !== selectedCasinoFilter) return [];
      } else {
        if (selectedFilterClubId === 'none') return [];
        if (selectedFilterClubId !== 'all' && club.club.id !== selectedFilterClubId) return [];
      }
      return club.games
        .filter((game) => !activePlayerGameKeys.has(`${club.club.id}:${game.id}`))
        .filter((game) => !query || `${game.name} ${clubSearchText}`.toLowerCase().includes(query))
        .filter((game) => !stakesQuery || game.name.toLowerCase().includes(stakesQuery))
        .filter((game) => matchesGameTypeFilter(club, game, gameTypeFilter))
        .map((game) => {
          const isPreferred = player.preferredGameIds.includes(game.id);
          return {
            club,
            game,
            distanceMiles,
            isJoined,
            isPreferred,
            seatRequestAccess
          };
        });
    })
    .filter((item) => !hasLocationFilter
      || distanceFilter === 'none'
      || (item.distanceMiles != null && item.distanceMiles <= distanceFilter))
    .sort((left, right) => {
      const activityDifference = getActiveGameActivityTime(right.game) - getActiveGameActivityTime(left.game);
      if (activityDifference) return activityDifference;
      const leftFavorite = favoriteClubIds.includes(left.club.club.id);
      const rightFavorite = favoriteClubIds.includes(right.club.club.id);
      if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
      if (fitScoreFilterEnabled) {
        if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
        if (left.isJoined !== right.isJoined) return left.isJoined ? -1 : 1;
        const leftRunningSeats = getRunningAvailableSeats(left.game);
        const rightRunningSeats = getRunningAvailableSeats(right.game);
        if (leftRunningSeats !== rightRunningSeats) return rightRunningSeats - leftRunningSeats;
        if (left.game.waitlistCount !== right.game.waitlistCount) return left.game.waitlistCount - right.game.waitlistCount;
      }
      return compareOptionalDistances(left.distanceMiles, right.distanceMiles);
    });
}

export function selectContinuousDiscoveryOpportunities(
  exactMatches: GameOpportunity[],
  broadMatches: GameOpportunity[]
) {
  if (exactMatches.length) return { opportunities: exactMatches, filtersRelaxed: false };
  if (broadMatches.length) return { opportunities: broadMatches, filtersRelaxed: true };
  return { opportunities: [], filtersRelaxed: false };
}

export function getDiscoveryDeck(opportunities: GameOpportunity[], decisions: Record<string, DiscoveryDecision>) {
  const unreviewed = opportunities.filter((item) => !decisions[getOpportunityKey(item)]);
  return unreviewed.length || !opportunities.length ? unreviewed : opportunities;
}

export function advanceDiscoveryCycle(
  opportunities: GameOpportunity[],
  decisions: Record<string, DiscoveryDecision>,
  item: GameOpportunity,
  decision: DiscoveryDecision
) {
  const itemKey = getOpportunityKey(item);
  const next = { ...decisions, [itemKey]: decision };
  const exhausted = opportunities.length > 0
    && opportunities.every((opportunity) => Boolean(next[getOpportunityKey(opportunity)]));
  if (!exhausted) return next;
  return opportunities.length === 1 ? {} : { [itemKey]: decision };
}

export function getSavedOpportunities(opportunities: GameOpportunity[], decisions: Record<string, DiscoveryDecision>) {
  return opportunities.filter((item) => decisions[getOpportunityKey(item)] === 'saved');
}

export function getActiveDiscoveryOpportunity(
  opportunities: GameOpportunity[],
  selectedOpportunity: GameOpportunity | null
) {
  if (!selectedOpportunity) return null;
  return opportunities.find(
    (item) => getOpportunityKey(item) === getOpportunityKey(selectedOpportunity)
  ) ?? null;
}

export function resolveAddressCoordinate(_address?: string): Coordinate | null {
  // Typed place names are not coordinates. A future geocoding flow must return a
  // validated coordinate with explicit user consent before distance is enabled.
  return null;
}

export function getDistanceMiles(from: Coordinate, to: Coordinate) {
  if (!isValidCoordinate(from) || !isValidCoordinate(to)) return null;
  const earthRadiusMiles = 3958.8;
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLat = degreesToRadians(from.latitude);
  const toLat = degreesToRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function getClubDistance(club: PlayerClubSnapshot, originCoordinate: Coordinate | null) {
  const coordinate = getClubCoordinate(club);
  return originCoordinate && coordinate ? getDistanceMiles(originCoordinate, coordinate) : null;
}

export function getOpportunityKey(item: GameOpportunity) {
  return `${item.club.club.id}:${item.game.id}`;
}

export function getOpportunityLabel(item: GameOpportunity) {
  if (item.isPreferred) return 'Preferred';
  if (item.isJoined) return 'Member';
  if (getRunningAvailableSeats(item.game)) return 'Seats open';
  return 'Published game';
}

export function getCompatibilitySummary(item: GameOpportunity) {
  if (item.isPreferred && item.game.knownPlayersCount) return `This matches a saved game preference, and the venue reports ${item.game.knownPlayersCount} familiar player${item.game.knownPlayersCount === 1 ? '' : 's'}.`;
  if (item.isPreferred) return 'This matches a saved game preference.';
  if (item.game.knownPlayersCount) return `The venue reports ${item.game.knownPlayersCount} familiar player${item.game.knownPlayersCount === 1 ? '' : 's'} for this game.`;
  const runningSeats = getRunningAvailableSeats(item.game);
  if (runningSeats) return `The venue reports ${runningSeats} open seat${runningSeats === 1 ? '' : 's'} at a running table.`;
  return `${item.club.club.name} published this game in its current room inventory.`;
}

export function getGameStatusLabel(game: PlayerSyncGame) {
  const runningTables = game.openTables.filter((table) => table.status === 'Running');
  if (runningTables.length) {
    const runningSeats = getRunningAvailableSeats(game);
    const tableLabel = runningTables.length === 1 ? 'Running table' : `${runningTables.length} running tables`;
    return runningSeats ? `${runningSeats} ${runningSeats === 1 ? 'seat' : 'seats'} open` : `${tableLabel} · 0 seats open`;
  }
  if (game.openTables.some((table) => table.status === 'Forming')) return 'Table forming';
  if (game.openTables.some((table) => table.status === 'Paused')) return 'Table paused';
  return 'No open table published';
}

export function getRunningAvailableSeats(game: Pick<PlayerSyncGame, 'openTables'>) {
  return game.openTables
    .filter((table) => table.status === 'Running')
    .reduce((total, table) => total + table.availableSeats, 0);
}

export function hasRunningTable(game: Pick<PlayerSyncGame, 'openTables'>) {
  return game.openTables.some((table) => table.status === 'Running');
}

export function getPublishedAvailabilityLabel(game: Pick<PlayerSyncGame, 'openTables' | 'waitlistCount'>) {
  if (hasRunningTable(game)) {
    const runningSeats = getRunningAvailableSeats(game);
    const seatLabel = runningSeats === 1 ? 'seat' : 'seats';
    return `${runningSeats} ${seatLabel} open · ${game.waitlistCount} waiting`;
  }
  if (game.openTables.some((table) => table.status === 'Forming')) return `Table forming · ${game.waitlistCount} waiting`;
  if (game.openTables.some((table) => table.status === 'Paused')) return `Table paused · ${game.waitlistCount} waiting`;
  return `No open table published · ${game.waitlistCount} waiting`;
}

export function getClubAvailabilityLabel(club: Pick<PlayerClubSnapshot, 'games'>) {
  const tables = club.games.flatMap((game) => game.openTables);
  const runningTables = tables.filter((table) => table.status === 'Running');
  if (runningTables.length) {
    const seats = runningTables.reduce((total, table) => total + table.availableSeats, 0);
    return `${seats} ${seats === 1 ? 'seat' : 'seats'} open`;
  }
  if (tables.some((table) => table.status === 'Forming')) return 'Table forming';
  if (tables.some((table) => table.status === 'Paused')) return 'Table paused';
  return 'No open table published';
}

export function getPublishedTableSummary(game: Pick<PlayerSyncGame, 'openTables'>) {
  const counts = game.openTables.reduce((result, table) => ({
    ...result,
    [table.status]: result[table.status] + 1
  }), { Running: 0, Forming: 0, Paused: 0 });
  const parts = [
    counts.Running ? `${counts.Running} running` : '',
    counts.Forming ? `${counts.Forming} forming` : '',
    counts.Paused ? `${counts.Paused} paused` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No table published';
}

export function getVenueKind(club: PlayerClubSnapshot) {
  return club.club.venueKind ?? 'Venue';
}

export function getClubCity(club: PlayerClubSnapshot) {
  const address = club.club.address ?? '';
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return address.trim() || 'Location unavailable';
}

export function getClubSearchText(club: PlayerClubSnapshot) {
  return `${club.club.name} ${club.club.address ?? ''} ${getClubCity(club)}`.toLowerCase();
}

export function isCasinoClub(club: PlayerClubSnapshot) {
  return club.club.venueKind === 'Casino';
}

export function getClubCoordinate(club: PlayerClubSnapshot) {
  return isValidCoordinate(club.club.coordinate) ? club.club.coordinate : null;
}

export function buildFindGameClubs(clubs: PlayerClubSnapshot[]) {
  return clubs.slice().sort((left, right) => left.club.name.localeCompare(right.club.name));
}

export function isActivePlayerGame(game: PlayerSyncGame) {
  return (game.openTables ?? []).some((table) => table.status === 'Running' || table.status === 'Forming');
}

export function getActiveGameActivityTime(game: PlayerSyncGame) {
  const gameUpdatedAt = Date.parse(game.updatedAt || '');
  const tableStartedAt = Math.max(
    0,
    ...(game.openTables ?? []).map((table) => Date.parse(table.startedAt || '') || 0)
  );
  return Math.max(Number.isFinite(gameUpdatedAt) ? gameUpdatedAt : 0, tableStartedAt);
}

export function groupOpportunitiesByClub(opportunities: GameOpportunity[]) {
  const folders = new Map<string, { club: PlayerClubSnapshot; distanceMiles: number | null; items: GameOpportunity[] }>();
  opportunities.forEach((item) => {
    const current = folders.get(item.club.club.id);
    if (current) {
      current.items.push(item);
      if (item.distanceMiles != null && (current.distanceMiles == null || item.distanceMiles < current.distanceMiles)) {
        current.distanceMiles = item.distanceMiles;
      }
      return;
    }
    folders.set(item.club.club.id, { club: item.club, distanceMiles: item.distanceMiles, items: [item] });
  });
  return Array.from(folders.values()).sort((left, right) => left.club.club.name.localeCompare(right.club.club.name));
}

export function getOpportunityTableLabel(item: GameOpportunity, _index: number) {
  if (!(item.game.openTables ?? []).length) return undefined;
  const tableLabel = item.game.openTables[0]?.label?.trim();
  return tableLabel || undefined;
}

export function matchesGameTypeFilter(club: PlayerClubSnapshot, _game: PlayerSyncGame, filter: GameTypeFilter) {
  if (filter === 'none') return true;
  if (filter === 'all') return true;
  if (filter === 'favorites') return true;
  if (filter === 'card-house') return getVenueKind(club) === 'Card house';
  return true;
}

export function getRecommendationReason(item: GameOpportunity) {
  const runningSeats = getRunningAvailableSeats(item.game);
  const reasons = [
    hasRunningTable(item.game)
      ? runningSeats ? `${runningSeats} open seats` : 'running table with 0 open seats'
      : item.game.openTables.some((table) => table.status === 'Forming')
        ? 'forming table'
        : item.game.openTables.some((table) => table.status === 'Paused')
          ? 'paused table'
          : 'no open table published',
    item.isPreferred ? 'matches your profile' : '',
    item.isJoined ? 'active membership shown' : 'no active membership shown',
    item.game.knownPlayersCount ? `${item.game.knownPlayersCount} familiar players` : '',
    item.distanceMiles == null ? '' : `${item.distanceMiles.toFixed(1)} mi away`
  ].filter(Boolean);
  return reasons.join(' / ');
}

export function isValidCoordinate(value: Coordinate | null | undefined): value is Coordinate {
  return Boolean(
    value &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function compareOptionalDistances(left: number | null, right: number | null) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

export function togglePreferredGame(player: PlayerAccount, gameId: string): PlayerAccount {
  return {
    ...player,
    preferredGameIds: player.preferredGameIds.includes(gameId)
      ? player.preferredGameIds.filter((id) => id !== gameId)
      : [...player.preferredGameIds, gameId]
  };
}
