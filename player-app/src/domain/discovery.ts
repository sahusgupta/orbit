import { normalizedIdentity } from './playerSync';
import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerPrivateGameListing,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration
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

const clubCoordinates: Record<string, Coordinate> = {};
const findGamesClubOrder: string[] = [];
const findGamesClubNames: string[] = [];

export const homeCoordinate: Coordinate = { latitude: 30.613, longitude: -96.342 };

const texasAddressCoordinates: Array<{ keywords: string[]; coordinate: Coordinate }> = [
  { keywords: ['dallas', '75226', '2711 main'], coordinate: { latitude: 32.7867, longitude: -96.7997 } },
  { keywords: ['austin', '78701', '78705', 'congress', '26th street'], coordinate: { latitude: 30.2679, longitude: -97.743 } },
  { keywords: ['college station', 'bryan', '77803', '77840', 'main street bryan'], coordinate: { latitude: 30.6205, longitude: -96.3269 } },
  { keywords: ['houston', '77002', 'prairie', 'san jacinto'], coordinate: { latitude: 29.7608, longitude: -95.3608 } },
  { keywords: ['durant', 'choctaw', '74701'], coordinate: { latitude: 33.952, longitude: -96.4122 } },
  { keywords: ['thackerville', 'winstar', '73459'], coordinate: { latitude: 33.7913, longitude: -97.1456 } },
  { keywords: ['el paso', 'elpaso', '79901', '79902'], coordinate: { latitude: 31.7619, longitude: -106.485 } }
];

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function filterPrivateGames(
  privateGames: PlayerPrivateGameListing[],
  gameQuery: string,
  stakesFilter: string,
  gameTypeFilter: GameTypeFilter
) {
  const query = gameQuery.trim().toLowerCase();
  const stakesQuery = stakesFilter.trim().toLowerCase();
  const typeAllowsPrivate = gameTypeFilter === 'none'
    || gameTypeFilter === 'all'
    || gameTypeFilter === 'private'
    || gameTypeFilter === 'home-game';
  if (!typeAllowsPrivate) return [];
  return privateGames.filter((game) => {
    const haystack = `${game.name} ${game.location} ${game.note}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!stakesQuery || game.name.toLowerCase().includes(stakesQuery));
  });
}

export function filterMapClubs(
  clubs: PlayerClubSnapshot[],
  mapQuery: string,
  mapDistanceFilter: DistanceFilter,
  mapVenueFilter: MapVenueFilter,
  originCoordinate: Coordinate
) {
  const query = mapQuery.trim().toLowerCase();
  return clubs
    .filter((club) => {
      const haystack = `${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (mapDistanceFilter !== 'none' && getClubDistance(club, originCoordinate) > mapDistanceFilter) return false;
      if (mapVenueFilter === 'casino' && !isCasinoClub(club)) return false;
      if (mapVenueFilter === 'card-house' && getVenueKind(club) !== 'Card house') return false;
      if (mapVenueFilter === 'club' && getVenueKind(club) !== 'Poker club') return false;
      return true;
    })
    .sort((left, right) => getClubDistance(left, originCoordinate) - getClubDistance(right, originCoordinate));
}

export type FilterTournamentsOptions = {
  clubs: PlayerClubSnapshot[];
  originCoordinate: Coordinate;
  playerId: string;
  query: string;
  registrations: PlayerTournamentRegistration[];
  tournamentClubFilter: string;
  tournamentDistanceFilter: DistanceFilter;
  tournamentFilter: TournamentFilter;
  tournaments: PlayerTournament[];
};

export function filterTournaments({
  clubs,
  originCoordinate,
  playerId,
  query: rawQuery,
  registrations,
  tournamentClubFilter,
  tournamentDistanceFilter,
  tournamentFilter,
  tournaments
}: FilterTournamentsOptions): TournamentOpportunity[] {
  const query = rawQuery.trim().toLowerCase();
  return tournaments
    .map((tournament) => {
      const club = clubs.find((item) => item.club.id === tournament.clubId);
      const registration = registrations.find((item) => item.tournamentId === tournament.id && item.playerId === playerId);
      const distanceMiles = club ? getClubDistance(club, originCoordinate) : Number.POSITIVE_INFINITY;
      return { tournament, club, registration, distanceMiles };
    })
    .filter(({ tournament, club, registration, distanceMiles }) => {
      const haystack = `${tournament.name} ${club?.club.name ?? ''} ${club?.club.address ?? ''} ${tournament.prizePoolLabel} ${tournament.rules.join(' ')}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (tournamentClubFilter !== 'all' && tournament.clubId !== tournamentClubFilter) return false;
      if (tournamentDistanceFilter !== 'none' && club && distanceMiles > tournamentDistanceFilter) return false;
      if (tournamentFilter === 'open' && tournament.registrationStatus !== 'open') return false;
      if (tournamentFilter === 'free' && tournament.buyIn !== 0) return false;
      if (tournamentFilter === 'registered' && !registration) return false;
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
  player: PlayerAccount;
  playerHomeCoordinate: Coordinate;
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
            isPreferred
          };
        });
    })
    .filter((item) => !hasLocationFilter
      || distanceFilter === 'none'
      || isCasinoClub(item.club)
      || item.distanceMiles <= distanceFilter
      || Boolean(query && getClubSearchText(item.club).includes(query)))
    .sort((left, right) => {
      const activityDifference = getActiveGameActivityTime(right.game) - getActiveGameActivityTime(left.game);
      if (activityDifference) return activityDifference;
      const leftFavorite = favoriteClubIds.includes(left.club.club.id);
      const rightFavorite = favoriteClubIds.includes(right.club.club.id);
      if (leftFavorite !== rightFavorite) return leftFavorite ? -1 : 1;
      if (fitScoreFilterEnabled) {
        if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1;
        if (left.isJoined !== right.isJoined) return left.isJoined ? -1 : 1;
        if (left.game.availableSeats !== right.game.availableSeats) return right.game.availableSeats - left.game.availableSeats;
        if (left.game.waitlistCount !== right.game.waitlistCount) return left.game.waitlistCount - right.game.waitlistCount;
      }
      return left.distanceMiles - right.distanceMiles;
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
  ) ?? selectedOpportunity;
}

export function resolveAddressCoordinate(address?: string) {
  const normalized = (address ?? '').trim().toLowerCase();
  if (!normalized) return homeCoordinate;
  const match = texasAddressCoordinates.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.coordinate ?? homeCoordinate;
}

export function getDistanceMiles(from: Coordinate, to: Coordinate) {
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

export function getClubDistance(club: PlayerClubSnapshot, originCoordinate = homeCoordinate) {
  return getDistanceMiles(originCoordinate, getClubCoordinate(club));
}

export function getOpportunityKey(item: GameOpportunity) {
  return `${item.club.club.id}:${item.game.id}`;
}

export function getOpportunityLabel(item: GameOpportunity) {
  if (item.isPreferred) return 'Preferred';
  if (item.isJoined) return 'Member';
  if (item.game.availableSeats) return 'Seats open';
  if (item.distanceMiles <= 10) return 'Nearby';
  return 'Available';
}

export function getCompatibilitySummary(item: GameOpportunity) {
  if (item.isPreferred && item.game.knownPlayersCount) return `Your stakes, ${item.game.knownPlayersCount} familiar player${item.game.knownPlayersCount === 1 ? '' : 's'}, and live seats make this a strong fit.`;
  if (item.isPreferred) return 'This matches your preferred game and has a seat profile that fits how you play.';
  if (item.game.knownPlayersCount) return `${item.game.knownPlayersCount} player${item.game.knownPlayersCount === 1 ? '' : 's'} you know ${item.game.knownPlayersCount === 1 ? 'is' : 'are'} already connected to this game.`;
  if (item.game.availableSeats) return `${item.game.availableSeats} live seat${item.game.availableSeats === 1 ? '' : 's'} and a manageable wait make this worth a look.`;
  return 'This host regularly spreads games close to your preferred stakes and location.';
}

export function getGameStatusLabel(game: PlayerSyncGame) {
  if (!game.openTables.length) return 'Planning next game';
  if (game.availableSeats) return `${game.availableSeats} seats open`;
  if (game.formingCount) return 'Table forming';
  return `${game.waitlistCount} on waitlist`;
}

export function getVenueKind(club: PlayerClubSnapshot) {
  if (isCasinoClub(club)) return 'Casino';
  const identity = `${club.club.id} ${club.club.name}`.toLowerCase();
  if (identity.includes('card') || identity.includes('poker hall') || identity.includes('room')) return 'Card house';
  return 'Poker club';
}

export function getClubCity(club: PlayerClubSnapshot) {
  const address = club.club.address ?? '';
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  if (address.toLowerCase().includes('dallas')) return 'Dallas';
  if (address.toLowerCase().includes('austin')) return 'Austin';
  if (address.toLowerCase().includes('houston')) return 'Houston';
  if (address.toLowerCase().includes('bryan')) return 'Bryan';
  if (address.toLowerCase().includes('college station')) return 'College Station';
  return 'Texas';
}

export function getClubSearchText(club: PlayerClubSnapshot) {
  return `${club.club.name} ${club.club.address ?? ''} ${getClubCity(club)}`.toLowerCase();
}

export function isCasinoClub(club: PlayerClubSnapshot) {
  const text = getClubSearchText(club);
  return club.club.id.includes('casino') || text.includes('casino') || text.includes('choctaw') || text.includes('winstar');
}

export function getClubCoordinate(club: PlayerClubSnapshot) {
  const known = clubCoordinates[club.club.id];
  if (known) return known;
  const seed = Array.from(club.club.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    latitude: homeCoordinate.latitude + ((seed % 17) - 8) * 0.006,
    longitude: homeCoordinate.longitude + (((seed * 3) % 17) - 8) * 0.006
  };
}

export function findGamesClubKey(club: PlayerClubSnapshot) {
  const normalizedId = normalizedIdentity(club.club.id).replace(/\s+/g, '-');
  const normalizedName = normalizedIdentity(club.club.name);
  const idIndex = findGamesClubOrder.indexOf(normalizedId);
  if (idIndex >= 0) return findGamesClubOrder[idIndex];
  const nameIndex = findGamesClubNames.indexOf(normalizedName);
  return nameIndex >= 0 ? findGamesClubOrder[nameIndex] : '';
}

export function isFindGamesClub(club: PlayerClubSnapshot) {
  return Boolean(findGamesClubKey(club));
}

export function compareFindGamesClubOrder(left: PlayerClubSnapshot, right: PlayerClubSnapshot) {
  const leftIndex = findGamesClubOrder.indexOf(findGamesClubKey(left));
  const rightIndex = findGamesClubOrder.indexOf(findGamesClubKey(right));
  return leftIndex - rightIndex || left.club.name.localeCompare(right.club.name);
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
  const folders = new Map<string, { club: PlayerClubSnapshot; distanceMiles: number; items: GameOpportunity[] }>();
  opportunities.forEach((item) => {
    const current = folders.get(item.club.club.id);
    if (current) {
      current.items.push(item);
      current.distanceMiles = Math.min(current.distanceMiles, item.distanceMiles);
      return;
    }
    folders.set(item.club.club.id, { club: item.club, distanceMiles: item.distanceMiles, items: [item] });
  });
  return Array.from(folders.values()).sort((left, right) => compareFindGamesClubOrder(left.club, right.club));
}

export function getOpportunityTableLabel(item: GameOpportunity, index: number) {
  if (!(item.game.openTables ?? []).length) return undefined;
  const tableLabel = item.game.openTables[0]?.label?.trim();
  if (!tableLabel) return `Table ${index + 1}`;
  if (/^table\s+\d+/i.test(tableLabel)) return tableLabel;
  return `Table ${index + 1}: ${tableLabel}`;
}

export function matchesGameTypeFilter(club: PlayerClubSnapshot, game: PlayerSyncGame, filter: GameTypeFilter) {
  if (filter === 'none') return true;
  if (filter === 'all') return true;
  if (filter === 'favorites') return true;
  const text = `${club.club.name} ${game.name}`.toLowerCase();
  if (filter === 'home-game') return text.includes('home');
  if (filter === 'private') return text.includes('private');
  if (filter === 'public') return !text.includes('private') && !text.includes('home');
  return !text.includes('private') && !text.includes('home');
}

export function getRecommendationReason(item: GameOpportunity) {
  const reasons = [
    item.game.availableSeats
      ? `${item.game.availableSeats} open seats`
      : item.game.formingCount
        ? 'forming table'
        : (item.game.openTables ?? []).length || item.game.waitlistCount
          ? 'waitlist only'
          : 'configured - no open table yet',
    item.isPreferred ? 'matches your profile' : '',
    item.isJoined ? 'club access ready' : 'membership needed',
    item.game.knownPlayersCount ? `${item.game.knownPlayersCount} familiar players` : '',
    `${item.distanceMiles.toFixed(1)} mi away`
  ].filter(Boolean);
  return reasons.join(' / ');
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

export function isValidPhoneNumber(value: string, optional = false) {
  const trimmed = value.trim();
  if (!trimmed) return optional;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export function togglePreferredGame(player: PlayerAccount, gameId: string): PlayerAccount {
  return {
    ...player,
    preferredGameIds: player.preferredGameIds.includes(gameId)
      ? player.preferredGameIds.filter((id) => id !== gameId)
      : [...player.preferredGameIds, gameId]
  };
}
