import { describe, expect, it } from 'vitest';
import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerPrivateGameListing,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration
} from './playerSync';
import * as discovery from './discovery';

const table = (overrides: Partial<PlayerSyncGame['openTables'][number]> = {}): PlayerSyncGame['openTables'][number] => ({
  id: 'table-1',
  gameId: 'game-1',
  label: 'Feature Table',
  status: 'Running',
  seatsFilled: 6,
  maxSeats: 9,
  availableSeats: 3,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-08T01:00:00.000Z',
  social: { seatedPlayerCount: 6, adminCount: 1, knownPlayersCount: 2 },
  ...overrides
});

const game = (overrides: Partial<PlayerSyncGame> = {}): PlayerSyncGame => ({
  id: 'game-1',
  name: '1/2 NLH',
  maxSeats: 9,
  collectionMode: 'Time',
  openTables: [table()],
  waitlistCount: 2,
  formingCount: 0,
  availableSeats: 3,
  knownPlayersCount: 2,
  updatedAt: '2026-08-08T02:00:00.000Z',
  ...overrides
});

const club = (
  id: string,
  name: string,
  games: PlayerSyncGame[] = [game()],
  address = '100 Main Street, Bryan, TX'
): PlayerClubSnapshot => ({
  club: { id, name, address },
  games,
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 6, adminCount: 1, knownPlayersInHouse: 2, waitlistCount: 2 },
  generatedAt: '2026-08-08T03:00:00.000Z'
});

const privateGame = (overrides: Partial<PlayerPrivateGameListing> = {}): PlayerPrivateGameListing => ({
  id: 'private-1',
  name: '1/2 Home NLH',
  location: 'Bryan loft',
  startsAt: 'Tonight',
  seats: '6',
  note: 'Friendly deep stack',
  hostPlayerId: 'player-1',
  hostPlayerPath: 'players/player-1',
  hostPlayerName: 'Alex',
  createdAt: '2026-08-08T03:00:00.000Z',
  status: 'Open',
  ...overrides
});

const tournament = (overrides: Partial<PlayerTournament> = {}): PlayerTournament => ({
  id: 'tournament-1',
  clubId: 'club-a',
  name: 'Friday Freeroll',
  startsAt: '2026-08-09T01:00:00.000Z',
  registrationOpensAt: '2026-08-08T01:00:00.000Z',
  registrationClosesAt: '2026-08-09T01:15:00.000Z',
  registrationStatus: 'open',
  buyIn: 0,
  prizePoolLabel: '$1,000 guaranteed',
  startingStack: 20_000,
  levelMinutes: 20,
  lateRegistrationThroughLevel: 4,
  rebuyPrice: 0,
  rebuyStack: 0,
  unlimitedRebuys: false,
  addOnPrice: 0,
  addOnStack: 0,
  rules: ['No re-entry'],
  unregisterAllowed: true,
  entrantCount: 12,
  totalRebuys: 0,
  totalAddOns: 0,
  ...overrides
});

const registration = (overrides: Partial<PlayerTournamentRegistration> = {}): PlayerTournamentRegistration => ({
  id: 'registration-1',
  tournamentId: 'tournament-1',
  clubId: 'club-a',
  playerId: 'player-1',
  playerName: 'Alex',
  playerEmail: 'alex@example.com',
  status: 'registered',
  rebuys: 0,
  addOns: 0,
  registeredAt: '2026-08-08T03:00:00.000Z',
  updatedAt: '2026-08-08T03:00:00.000Z',
  ...overrides
});

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Alex',
  email: 'alex@example.com',
  phone: '979-555-0101',
  homeLocation: 'Bryan, TX',
  searchRadiusMiles: 20,
  preferredGameIds: ['game-preferred'],
  favoriteClubIds: ['club-favorite']
};

describe('Player discovery characterization', () => {
  it('pins address resolution, haversine distance, and deterministic club coordinates', () => {
    expect(discovery.resolveAddressCoordinate()).toEqual({ latitude: 30.613, longitude: -96.342 });
    expect(discovery.resolveAddressCoordinate('2711 Main, Dallas, TX 75226')).toEqual({ latitude: 32.7867, longitude: -96.7997 });
    const bryan = discovery.resolveAddressCoordinate('Main Street Bryan, TX 77803');
    const dallas = discovery.resolveAddressCoordinate('Dallas, TX');
    expect(discovery.getDistanceMiles(bryan, bryan)).toBe(0);
    expect(discovery.getDistanceMiles(bryan, dallas)).toBeCloseTo(152.230, 3);
    expect(discovery.getDistanceMiles(dallas, bryan)).toBeCloseTo(152.230, 3);
    expect(discovery.getClubCoordinate(club('club-a', 'Alpha'))).toEqual({ latitude: 30.583, longitude: -96.336 });
  });

  it('pins private-game search, stakes, type filtering, ordering, and immutability', () => {
    const games = [
      privateGame(),
      privateGame({ id: 'private-2', name: '2/5 NLH', location: 'Austin', note: 'Serious game' })
    ];
    const snapshot = structuredClone(games);
    expect(discovery.filterPrivateGames(games, 'friendly', '1/2', 'private').map((item) => item.id)).toEqual(['private-1']);
    expect(discovery.filterPrivateGames(games, '', '', 'public')).toEqual([]);
    expect(discovery.filterPrivateGames(games, 'austin', '', 'home-game').map((item) => item.id)).toEqual(['private-2']);
    expect(games).toEqual(snapshot);
  });

  it('pins map query, venue, distance filtering and nearest-first ordering', () => {
    const pokerClub = club('club-a', 'Friendly Poker Club');
    const cardHouse = club('card-room-b', 'River Card Room', [game({ name: '2/5 NLH' })]);
    const casino = club('casino-c', 'Choctaw Casino', [game({ name: '5/10 NLH' })], 'Durant, OK 74701');
    const clubs = [casino, cardHouse, pokerClub];
    const origin = discovery.getClubCoordinate(pokerClub);
    expect(discovery.filterMapClubs(clubs, '', 'none', 'all', origin).map((item) => item.club.id)).toEqual(['club-a', 'card-room-b', 'casino-c']);
    expect(discovery.filterMapClubs(clubs, '5/10', 'none', 'casino', origin).map((item) => item.club.id)).toEqual(['casino-c']);
    expect(discovery.filterMapClubs(clubs, '', 5, 'card-house', origin).map((item) => item.club.id)).toEqual(['card-room-b']);
    expect(clubs.map((item) => item.club.id)).toEqual(['casino-c', 'card-room-b', 'club-a']);
  });

  it('pins tournament projection, search/filter precedence, missing-club distance behavior, and start ordering', () => {
    const clubs = [club('club-a', 'Alpha Poker')];
    const tournaments = [
      tournament({ id: 'paid', name: 'Main Event', startsAt: '2026-08-10T01:00:00.000Z', buyIn: 200, prizePoolLabel: '$20,000', registrationStatus: 'closed' }),
      tournament(),
      tournament({ id: 'remote', clubId: 'missing-club', name: 'Remote Freeroll', startsAt: '2026-08-08T23:00:00.000Z' })
    ];
    const registrations = [registration()];
    const base = {
      clubs,
      originCoordinate: discovery.getClubCoordinate(clubs[0]),
      playerId: 'player-1',
      query: '',
      registrations,
      tournamentClubFilter: 'all',
      tournamentDistanceFilter: 'none' as const,
      tournamentFilter: 'all' as const,
      tournaments
    };
    expect(discovery.filterTournaments(base).map((item) => item.tournament.id)).toEqual(['remote', 'tournament-1', 'paid']);
    expect(discovery.filterTournaments({ ...base, tournamentFilter: 'free' }).map((item) => item.tournament.id)).toEqual(['remote', 'tournament-1']);
    expect(discovery.filterTournaments({ ...base, tournamentFilter: 'open' }).map((item) => item.tournament.id)).toEqual(['remote', 'tournament-1']);
    expect(discovery.filterTournaments({ ...base, tournamentFilter: 'registered' }).map((item) => item.tournament.id)).toEqual(['tournament-1']);
    expect(discovery.filterTournaments({ ...base, query: 'guaranteed' }).map((item) => item.tournament.id)).toEqual(['remote', 'tournament-1']);
    expect(discovery.filterTournaments({ ...base, tournamentDistanceFilter: 5 }).map((item) => item.tournament.id)).toEqual(['remote', 'tournament-1', 'paid']);
  });

  it('pins configured-game inclusion, active-request exclusion, casino gates, distance bypass, and activity ordering', () => {
    const older = game({ id: 'game-older', updatedAt: '2026-08-08T01:00:00.000Z' });
    const preferred = game({ id: 'game-preferred', updatedAt: '2026-08-08T04:00:00.000Z' });
    const inactive = game({ id: 'game-inactive', openTables: [], availableSeats: 0 });
    const favoriteClub = club('club-favorite', 'Favorite Club', [older, preferred, inactive]);
    const otherClub = club('club-other', 'Other Club', [game({ id: 'game-other', updatedAt: '2026-08-08T05:00:00.000Z' })]);
    const casino = club('casino-c', 'Choctaw Casino', [game({ id: 'casino-game', updatedAt: '2026-08-08T06:00:00.000Z' })]);
    const base = {
      activePlayerGameKeys: new Set(['club-other:game-other']),
      distanceFilter: 'none' as const,
      favoriteClubIds: ['club-favorite'],
      findGameClubs: [favoriteClub, otherClub, casino],
      fitScoreFilterEnabled: false,
      gameQuery: '',
      gameTypeFilter: 'all' as const,
      joinedClubIds: new Set(['club-favorite']),
      player,
      playerHomeCoordinate: discovery.getClubCoordinate(favoriteClub),
      selectedCasinoFilter: 'none' as const,
      selectedFilterClubId: 'all',
      stakesFilter: ''
    };
    expect(discovery.buildGameOpportunities(base).map((item) => item.game.id)).toEqual(['game-preferred', 'game-inactive', 'game-older']);
    expect(discovery.buildGameOpportunities({ ...base, gameTypeFilter: 'favorites' }).map((item) => item.game.id)).toEqual(['game-preferred', 'game-inactive', 'game-older']);
    expect(discovery.buildGameOpportunities({ ...base, selectedCasinoFilter: 'all' }).map((item) => item.game.id)).toEqual(['casino-game', 'game-preferred', 'game-inactive', 'game-older']);
    expect(discovery.buildGameOpportunities({ ...base, selectedFilterClubId: 'none', selectedCasinoFilter: 'all' }).map((item) => item.game.id)).toEqual(['casino-game']);
    expect(discovery.buildGameOpportunities({ ...base, gameQuery: 'favorite', distanceFilter: 5 }).map((item) => item.game.id)).toEqual(['game-preferred', 'game-inactive', 'game-older']);
  });

  it('pins discovery decision projection and active-item refresh by stable opportunity key', () => {
    const alpha = club('club-a', 'Alpha');
    const first = { club: alpha, game: game(), distanceMiles: 2, isJoined: false, isPreferred: false };
    const refreshed = { ...first, distanceMiles: 1, isJoined: true };
    const second = { club: club('club-b', 'Beta'), game: game({ id: 'game-2' }), distanceMiles: 3, isJoined: false, isPreferred: false };
    const decisions = { [discovery.getOpportunityKey(first)]: 'saved' as const };
    expect(discovery.getDiscoveryDeck([first, second], decisions)).toEqual([second]);
    const exhausted = discovery.advanceDiscoveryCycle([first, second], decisions, second, 'pass');
    expect(exhausted).toEqual({ [discovery.getOpportunityKey(second)]: 'pass' });
    expect(discovery.getDiscoveryDeck([first, second], exhausted)).toEqual([first]);
    expect(discovery.getDiscoveryDeck([first, second], {
      [discovery.getOpportunityKey(first)]: 'saved',
      [discovery.getOpportunityKey(second)]: 'pass'
    })).toEqual([first, second]);
    expect(discovery.getDiscoveryDeck([], decisions)).toEqual([]);
    expect(discovery.advanceDiscoveryCycle([first], {}, first, 'pass')).toEqual({});
    expect(discovery.getSavedOpportunities([first, second], decisions)).toEqual([first]);
    expect(discovery.getActiveDiscoveryOpportunity([refreshed, second], first)).toBe(refreshed);
    expect(discovery.getActiveDiscoveryOpportunity([second], first)).toBe(first);
    expect(discovery.getActiveDiscoveryOpportunity([second], null)).toBeNull();
  });

  it('pins player-facing labels, compatibility reasons, grouping, table labels, and game-type matching', () => {
    const alpha = club('club-a', 'Alpha Poker Club');
    const preferred = { club: alpha, game: game(), distanceMiles: 4, isJoined: true, isPreferred: true };
    expect(discovery.getOpportunityLabel(preferred)).toBe('Preferred');
    expect(discovery.getCompatibilitySummary(preferred)).toBe('Your stakes, 2 familiar players, and live seats make this a strong fit.');
    expect(discovery.getGameStatusLabel(game())).toBe('3 seats open');
    expect(discovery.getGameStatusLabel(game({ availableSeats: 0, formingCount: 1 }))).toBe('Table forming');
    expect(discovery.getGameStatusLabel(game({ openTables: [] }))).toBe('Planning next game');
    expect(discovery.getVenueKind(alpha)).toBe('Poker club');
    expect(discovery.getVenueKind(club('card-room', 'River Card Room'))).toBe('Card house');
    expect(discovery.getVenueKind(club('casino-x', 'Choctaw'))).toBe('Casino');
    expect(discovery.getClubCity(club('club-dallas', 'Dallas Club', [], '2711 Main, Dallas, TX'))).toBe('Dallas');
    expect(discovery.getClubSearchText(alpha)).toContain('alpha poker club');
    expect(discovery.matchesGameTypeFilter(alpha, game({ name: 'Private 1/2 NLH' }), 'private')).toBe(true);
    expect(discovery.matchesGameTypeFilter(alpha, game({ name: 'Home PLO' }), 'public')).toBe(false);
    expect(discovery.getOpportunityTableLabel(preferred, 0)).toBe('Table 1: Feature Table');
    expect(discovery.getOpportunityTableLabel({ ...preferred, game: game({ openTables: [] }) }, 0)).toBeUndefined();
    expect(discovery.getRecommendationReason(preferred)).toBe('3 open seats / matches your profile / club access ready / 2 familiar players / 4.0 mi away');
    const grouped = discovery.groupOpportunitiesByClub([
      preferred,
      { ...preferred, game: game({ id: 'game-2' }), distanceMiles: 2 },
      { club: club('club-b', 'Beta'), game: game({ id: 'game-3' }), distanceMiles: 1, isJoined: false, isPreferred: false }
    ]);
    expect(grouped.map((folder) => [folder.club.club.id, folder.distanceMiles, folder.items.length])).toEqual([
      ['club-a', 2, 2],
      ['club-b', 1, 1]
    ]);
  });

  it('pins validation and immutable preferred-game toggles', () => {
    expect(discovery.isValidEmail(' Alex@Example.COM ')).toBe(true);
    expect(discovery.isValidEmail('alex@example')).toBe(false);
    expect(discovery.isValidPhoneNumber('(979) 555-0101')).toBe(true);
    expect(discovery.isValidPhoneNumber('+1 979 555 0101')).toBe(true);
    expect(discovery.isValidPhoneNumber('', true)).toBe(true);
    expect(discovery.isValidPhoneNumber('', false)).toBe(false);

    const original = { ...player, preferredGameIds: ['game-1'] };
    let draft = discovery.togglePreferredGame(original, 'game-2');
    expect(draft.preferredGameIds).toEqual(['game-1', 'game-2']);
    draft = discovery.togglePreferredGame(draft, 'game-1');
    expect(draft.preferredGameIds).toEqual(['game-2']);
    expect(original.preferredGameIds).toEqual(['game-1']);
  });
});
