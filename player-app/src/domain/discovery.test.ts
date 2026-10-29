import { describe, expect, it } from 'vitest';
import {
  tournamentScopeKey,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerCoordinate,
  type PlayerSyncGame,
  type PlayerTournament,
  type PlayerTournamentInterest
} from './playerSync';
import * as discovery from './discovery';

const table: PlayerSyncGame['openTables'][number] = {
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
  social: { seatedPlayerCount: 6, adminCount: 1, knownPlayersCount: 2 }
};

const game = (overrides: Partial<PlayerSyncGame> = {}): PlayerSyncGame => ({
  id: 'game-1',
  name: '1/2 NLH',
  maxSeats: 9,
  collectionMode: 'Time',
  openTables: [table],
  waitlistCount: 2,
  formingCount: 0,
  availableSeats: 3,
  knownPlayersCount: 2,
  updatedAt: '2026-08-08T02:00:00.000Z',
  ...overrides
});

const club = (id: string, overrides: Partial<PlayerClubSnapshot['club']> = {}, games: PlayerSyncGame[] = [game()]): PlayerClubSnapshot => ({
  club: { id, name: `Club ${id}`, ...overrides },
  games,
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-08-08T03:00:00.000Z'
});

const tournament = (overrides: Partial<PlayerTournament> = {}): PlayerTournament => ({
  id: 'event-1',
  clubId: 'club-a',
  name: 'Friday Tournament',
  startsAt: '2026-08-10T18:00:00.000Z',
  interestOpensAt: '2026-08-01T00:00:00.000Z',
  interestClosesAt: '2026-08-10T17:00:00.000Z',
  interestStatus: 'open',
  buyIn: 0,
  prizePoolLabel: '$1,000 published',
  startingStack: 20_000,
  levelMinutes: 20,
  lateRegistrationThroughLevel: 4,
  rebuyPrice: 0,
  rebuyStack: 0,
  unlimitedRebuys: false,
  rebuysAllowed: false,
  addOnPrice: 0,
  addOnStack: 0,
  addOnsAllowed: false,
  rules: [],
  withdrawalAllowed: true,
  entrantCount: 0,
  totalRebuys: 0,
  totalAddOns: 0,
  ...overrides
});

const interest = (overrides: Partial<PlayerTournamentInterest> = {}): PlayerTournamentInterest => ({
  id: 'opaque-interest',
  tournamentId: 'event-1',
  clubId: 'club-a',
  playerId: 'player-1',
  status: 'interested',
  createdAt: '2026-08-08T03:00:00.000Z',
  updatedAt: '2026-08-08T03:00:00.000Z',
  ...overrides
});

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Alex',
  email: 'alex@example.test',
  homeLocation: 'Typed city only',
  searchRadiusMiles: 20,
  preferredGameIds: ['game-1'],
  favoriteClubIds: []
};

const tournamentOptions = (overrides: Partial<discovery.FilterTournamentsOptions> = {}): discovery.FilterTournamentsOptions => ({
  clubs: [club('club-a')],
  originCoordinate: null,
  playerId: player.id,
  query: '',
  interests: [],
  nowMs: Date.parse('2026-08-09T12:00:00.000Z'),
  tournamentClubFilter: 'all',
  tournamentDistanceFilter: 'none',
  tournamentFilter: 'all',
  tournaments: [tournament()],
  ...overrides
});

describe('Native tournament discovery joins', () => {
  it('keeps the first club and first eligible interested record rather than later duplicates', () => {
    const origin = { latitude: 30.6, longitude: -96.3 };
    const firstClub = club('club-a', { name: 'First venue', coordinate: origin });
    const duplicateClub = club('club-a', { name: 'Later venue' });
    const selected = interest({ id: 'first-eligible' });
    const options = tournamentOptions({
      clubs: [firstClub, duplicateClub],
      originCoordinate: origin,
      interests: [
        interest({ id: 'other-player', playerId: 'other' }),
        interest({ id: 'withdrawn', status: 'withdrawn' }),
        selected,
        interest({ id: 'later-eligible' })
      ]
    });

    const [listing] = discovery.filterTournaments(options);
    expect(listing?.club).toBe(firstClub);
    expect(listing?.interest).toBe(selected);
    expect(listing?.distanceMiles).toBe(0);
    expect(discovery.filterTournaments({ ...options, query: 'later venue' })).toEqual([]);
    expect(discovery.filterTournaments({ ...options, tournamentDistanceFilter: 5 })).toHaveLength(1);
  });

  it('requires an exact player match even when the requested player ID is empty', () => {
    const emptyPlayerInterest = interest({ playerId: '' });
    const options = tournamentOptions({ playerId: '', interests: [interest(), emptyPlayerInterest] });
    expect(discovery.filterTournaments(options)[0]?.interest).toBe(emptyPlayerInterest);
    expect(discovery.filterTournaments({ ...options, interests: [interest()] })[0]?.interest).toBeUndefined();
    expect(discovery.filterTournaments({ ...options, interests: [interest()], tournamentFilter: 'interested' })).toEqual([]);
  });

  it('keeps raw club and tournament tuple identities distinct, including separator and prototype-like IDs', () => {
    const scopes = [
      { clubId: 'a:b', id: 'c' },
      { clubId: 'a', id: 'b:c' },
      { clubId: '__proto__', id: 'constructor' },
      { clubId: 'constructor', id: '__proto__' },
      { clubId: '', id: '' }
    ];
    const clubs = scopes.map(({ clubId }) => club(clubId));
    const tournaments = scopes.map((scope) => tournament(scope));
    const interests = scopes.map(({ clubId, id }, index) => interest({ clubId, tournamentId: id, id: `interest-${index}` }));
    const listings = discovery.filterTournaments(tournamentOptions({ clubs, tournaments, interests }));

    expect(listings).toHaveLength(scopes.length);
    listings.forEach((listing, index) => {
      expect(listing.club).toBe(clubs[index]);
      expect(listing.tournament).toBe(tournaments[index]);
      expect(listing.interest).toBe(interests[index]);
    });
  });

  it('retains duplicate events, stable start-time order and input object references without mutation', () => {
    const firstTie = tournament({ id: 'first-tie' });
    const secondTie = tournament({ id: 'second-tie' });
    const earlier = tournament({ id: 'earlier', startsAt: '2026-08-10T12:00:00.000Z' });
    const later = tournament({ id: 'later', startsAt: '2026-08-11T12:00:00.000Z' });
    const options = tournamentOptions({ tournaments: [secondTie, later, earlier, firstTie, secondTie], interests: [interest()] });
    const before = JSON.stringify(options);
    options.clubs.forEach((item) => { Object.freeze(item.club); Object.freeze(item); });
    options.tournaments.forEach((item) => { Object.freeze(item.rules); Object.freeze(item); });
    options.interests.forEach(Object.freeze);
    Object.freeze(options.clubs);
    Object.freeze(options.tournaments);
    Object.freeze(options.interests);

    const listings = discovery.filterTournaments(options);
    expect(listings.map((listing) => listing.tournament)).toEqual([earlier, secondTie, firstTie, secondTie, later]);
    expect(listings[1]?.tournament).toBe(secondTie);
    expect(listings[3]?.tournament).toBe(secondTie);
    expect(listings.every((listing) => listing.club === options.clubs[0])).toBe(true);
    expect(JSON.stringify(options)).toBe(before);
  });

  it('returns empty discovery without reading unrelated club or interest records', () => {
    let reads = 0;
    const currentClub = club('club-a');
    const currentInterest = interest();
    Object.defineProperty(currentClub.club, 'id', { get: () => { reads += 1; return 'club-a'; } });
    Object.defineProperty(currentInterest, 'clubId', { get: () => { reads += 1; return 'club-a'; } });

    expect(discovery.filterTournaments(tournamentOptions({ clubs: [], tournaments: [], interests: [] }))).toEqual([]);
    expect(discovery.filterTournaments(tournamentOptions({ clubs: [currentClub], tournaments: [], interests: [currentInterest] }))).toEqual([]);
    expect(reads).toBe(0);
  });

  it.each([
    { clubCount: 10, eventCount: 50, includeInterests: true },
    { clubCount: 50, eventCount: 250, includeInterests: true },
    { clubCount: 1_000, eventCount: 5_000, includeInterests: false },
    { clubCount: 1_000, eventCount: 5_000, includeInterests: true }
  ])('bounds related-record reads for $clubCount clubs / $eventCount events / interests=$includeInterests', ({ clubCount, eventCount, includeInterests }) => {
    let clubReads = 0;
    let interestReads = 0;
    const clubs = Array.from({ length: clubCount }, (_, index) => {
      const id = `club-${index}`;
      const item = club(id);
      Object.defineProperty(item.club, 'id', { get: () => { clubReads += 1; return id; } });
      return item;
    });
    const tournaments = Array.from({ length: eventCount }, (_, index) => tournament({ id: `event-${index}`, clubId: `club-${index % clubCount}` }));
    const interests = includeInterests ? tournaments.map((event, index) => {
      const clubId = event.clubId;
      const item = interest({ id: `interest-${index}`, clubId, tournamentId: event.id });
      Object.defineProperty(item, 'clubId', { get: () => { interestReads += 1; return clubId; } });
      return item;
    }) : [];

    const listings = discovery.filterTournaments(tournamentOptions({ clubs, tournaments, interests }));
    expect(listings).toHaveLength(eventCount);
    expect(listings[0]?.tournament).toBe(tournaments[0]);
    expect(listings[eventCount - 1]?.interest).toBe(interests[eventCount - 1]);
    // A linear budget allows implementation freedom without tolerating a scan per event.
    expect.soft(clubReads).toBeLessThanOrEqual(4 * (clubCount + eventCount));
    expect.soft(interestReads).toBeLessThanOrEqual(4 * (interests.length + eventCount));
  });
});

describe('Player discovery factual boundaries', () => {
  it('resolves a selected game only from the current authoritative catalog', () => {
    const currentClub = club('club-a');
    const selected = {
      club: currentClub,
      game: currentClub.games[0],
      distanceMiles: null,
      isJoined: false,
      isPreferred: false,
      seatRequestAccess: 'missing' as const
    };
    const refreshed = { ...selected, game: { ...selected.game, name: 'Current published name' } };

    expect(discovery.getActiveDiscoveryOpportunity([refreshed], selected)).toBe(refreshed);
    expect(discovery.getActiveDiscoveryOpportunity([], selected)).toBeNull();
  });

  it('never geocodes typed text or invents venue coordinates', () => {
    expect(discovery.resolveAddressCoordinate('Any city or address')).toBeNull();
    expect(discovery.getClubCoordinate(club('unknown'))).toBeNull();
    expect(discovery.getClubCoordinate(club('invalid', { coordinate: { latitude: 91, longitude: 1 } }))).toBeNull();
    expect(discovery.getClubCoordinate(club('published', { coordinate: { latitude: 30.6, longitude: -96.3 } })))
      .toEqual({ latitude: 30.6, longitude: -96.3 });
  });

  it('computes distance only from two validated coordinates', () => {
    const origin: PlayerCoordinate = { latitude: 30.6, longitude: -96.3 };
    expect(discovery.getDistanceMiles(origin, origin)).toBe(0);
    expect(discovery.getDistanceMiles(origin, { latitude: 91, longitude: 0 })).toBeNull();
    expect(discovery.getClubDistance(club('unknown'), origin)).toBeNull();
    expect(discovery.getClubDistance(club('published', { coordinate: origin }), null)).toBeNull();
  });
  it('keeps valid antipodal distances finite when floating-point rounding exceeds the Haversine upper bound', () => {
    const from = { latitude: -88.40000000000009, longitude: 0 };
    const to = { latitude: 88.40000000000009, longitude: 180 };
    expect(discovery.getDistanceMiles(from, to)).toBeCloseTo(Math.PI * 3958.8, 5);
    expect(discovery.getDistanceMiles(to, from)).toBeCloseTo(Math.PI * 3958.8, 5);
    expect(discovery.getDistanceMiles({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 180 })).toBeCloseTo(Math.PI * 3958.8, 5);
  });

  it('never lets unknown coordinates match any active distance filter', () => {
    const unknown = club('unknown', { name: 'Casino Query Match', venueKind: 'Casino' });
    const known = club('known', { coordinate: { latitude: 30.6, longitude: -96.3 }, venueKind: 'Casino' });
    const origin = { latitude: 30.6, longitude: -96.3 };

    expect(discovery.filterMapClubs([unknown], 'query match', 5, 'casino', origin)).toEqual([]);
    expect(discovery.filterMapClubs([unknown], '', 5, 'all', origin)).toEqual([]);
    expect(discovery.filterMapClubs([known, unknown], '', 5, 'all', origin).map((item) => item.club.id)).toEqual(['known']);

    const gameOptions = {
      activePlayerGameKeys: new Set<string>(),
      distanceFilter: 5 as const,
      favoriteClubIds: [],
      findGameClubs: [unknown],
      fitScoreFilterEnabled: false,
      gameQuery: 'query match',
      gameTypeFilter: 'all' as const,
      joinedClubIds: new Set<string>(),
      player,
      playerHomeCoordinate: null,
      selectedCasinoFilter: 'all' as const,
      selectedFilterClubId: 'all',
      stakesFilter: ''
    };
    expect(discovery.buildGameOpportunities(gameOptions)).toEqual([]);
  });

  it.each([
    ['Requested', undefined, 'pending'],
    ['Approved', undefined, 'pending'],
    ['Active', '2026-08-10T12:00:00.000Z', 'active'],
    ['Expired', undefined, 'renewal']
  ] as const)('projects %s membership into %s seat-request access', (status, expiresAt, expectedAccess) => {
    const memberClub = {
      ...club('club-member'),
      memberships: [{
        id: 'membership-1',
        clubId: 'club-member',
        playerId: player.id,
        playerName: player.name,
        status,
        expiresAt,
        preferredGameIds: []
      }]
    };
    const [opportunity] = discovery.buildGameOpportunities({
      activePlayerGameKeys: new Set<string>(),
      distanceFilter: 'none',
      favoriteClubIds: [],
      findGameClubs: [memberClub],
      fitScoreFilterEnabled: false,
      gameQuery: '',
      gameTypeFilter: 'all',
      joinedClubIds: new Set<string>(),
      nowMs: Date.parse('2026-08-09T12:00:00.000Z'),
      player,
      playerHomeCoordinate: null,
      selectedCasinoFilter: 'all',
      selectedFilterClubId: 'all',
      stakesFilter: ''
    });

    expect(opportunity?.seatRequestAccess).toBe(expectedAccess);
  });

  it('filters tournament interest without registration aliases or entrant inflation', () => {
    const known = club('club-a', { name: 'Alpha', coordinate: { latitude: 30.6, longitude: -96.3 } });
    const missingClubEvent = tournament({ id: 'event-missing', clubId: 'missing', startsAt: '2026-08-09T18:00:00.000Z' });
    const alreadyStarted = tournament({ id: 'event-past', startsAt: '2026-08-09T11:59:59.999Z' });
    const startsNow = tournament({ id: 'event-now', startsAt: '2026-08-09T12:00:00.000Z' });
    const base = {
      clubs: [known],
      originCoordinate: { latitude: 30.6, longitude: -96.3 },
      playerId: 'player-1',
      query: 'alpha',
      interests: [interest()],
      nowMs: Date.parse('2026-08-09T12:00:00.000Z'),
      tournamentClubFilter: 'all',
      tournamentDistanceFilter: 'none' as const,
      tournamentFilter: 'all' as const,
      tournaments: [tournament(), missingClubEvent, alreadyStarted, startsNow]
    };
    expect(discovery.filterTournaments(base).map((item) => item.tournament.id)).toEqual(['event-1']);
    expect(discovery.filterTournaments({ ...base, query: '', tournamentFilter: 'interested' }).map((item) => item.tournament.id)).toEqual(['event-1']);
    expect(discovery.filterTournaments({ ...base, query: '', tournamentDistanceFilter: 5 }).map((item) => item.tournament.id)).toEqual(['event-1']);
    expect(discovery.filterTournaments({ ...base, query: '', tournamentFilter: 'free' }).map((item) => item.tournament.id)).toEqual(['event-1']);
    expect(discovery.filterTournaments({ ...base, query: '', tournamentFilter: 'open' }).map((item) => item.tournament.id)).toEqual(['event-1']);
    expect(discovery.filterTournaments({
      ...base,
      query: '',
      tournamentFilter: 'open',
      nowMs: Date.parse('2026-08-10T17:00:00.000Z')
    })).toEqual([]);
  });

  it('joins tournament interest by venue and tournament when IDs collide across clubs', () => {
    const firstClub = club('club-a', { name: 'Alpha' });
    const secondClub = club('club-b', { name: 'Beta' });
    const firstTournament = tournament({ clubId: firstClub.club.id, name: 'Alpha Event' });
    const secondTournament = tournament({ clubId: secondClub.club.id, name: 'Beta Event' });
    const options = {
      clubs: [firstClub, secondClub],
      originCoordinate: null,
      playerId: player.id,
      query: '',
      interests: [interest({ clubId: firstClub.club.id })],
      nowMs: Date.parse('2026-08-09T12:00:00.000Z'),
      tournamentClubFilter: 'all',
      tournamentDistanceFilter: 'none' as const,
      tournamentFilter: 'all' as const,
      tournaments: [firstTournament, secondTournament]
    };

    const listings = discovery.filterTournaments(options);
    expect(listings.find((listing) => listing.tournament.clubId === firstClub.club.id)?.interest).toBeDefined();
    expect(listings.find((listing) => listing.tournament.clubId === secondClub.club.id)?.interest).toBeUndefined();
    expect(discovery.filterTournaments({ ...options, tournamentFilter: 'interested' }).map((listing) => listing.tournament.clubId))
      .toEqual([firstClub.club.id]);
    expect(tournamentScopeKey(firstTournament)).not.toBe(tournamentScopeKey(secondTournament));
  });

  it('uses neutral published game status labels and preserves zeros', () => {
    const noTable = game({ openTables: [], availableSeats: 8, formingCount: 0, waitlistCount: 0 });
    const runningFull = game({
      openTables: [{ ...table, seatsFilled: 9, availableSeats: 0, status: 'Running' }],
      availableSeats: 8,
      formingCount: 0,
      waitlistCount: 0
    });
    const formingWithCapacity = game({
      openTables: [{ ...table, seatsFilled: 0, availableSeats: 9, status: 'Forming' }],
      availableSeats: 9,
      formingCount: 1,
      waitlistCount: 2
    });
    const pausedWithCapacity = game({
      openTables: [{ ...table, seatsFilled: 4, availableSeats: 5, status: 'Paused' }],
      availableSeats: 5,
      formingCount: 0,
      waitlistCount: 1
    });
    const mixedStatus = game({
      openTables: [
        { ...table, id: 'running', seatsFilled: 8, availableSeats: 1, status: 'Running' },
        { ...table, id: 'forming', seatsFilled: 0, availableSeats: 9, status: 'Forming' },
        { ...table, id: 'paused', seatsFilled: 4, availableSeats: 5, status: 'Paused' }
      ],
      availableSeats: 15,
      formingCount: 1,
      waitlistCount: 3
    });

    expect(discovery.getGameStatusLabel(noTable)).toBe('No open table published');
    expect(discovery.getPublishedAvailabilityLabel(noTable)).toBe('No open table published · 0 waiting');
    expect(discovery.getGameStatusLabel(runningFull)).toBe('Running table · 0 seats open');
    expect(discovery.getPublishedAvailabilityLabel(runningFull))
      .toBe('0 seats open · 0 waiting');
    expect(discovery.getPublishedAvailabilityLabel(game({ openTables: [{ ...table, availableSeats: 1 }], availableSeats: 7, waitlistCount: 2 })))
      .toBe('1 seat open · 2 waiting');
    expect(discovery.getGameStatusLabel(formingWithCapacity)).toBe('Table forming');
    expect(discovery.getPublishedAvailabilityLabel(formingWithCapacity)).toBe('Table forming · 2 waiting');
    expect(discovery.getGameStatusLabel(pausedWithCapacity)).toBe('Table paused');
    expect(discovery.getPublishedAvailabilityLabel(pausedWithCapacity)).toBe('Table paused · 1 waiting');
    expect(discovery.getRunningAvailableSeats(mixedStatus)).toBe(1);
    expect(discovery.getGameStatusLabel(mixedStatus)).toBe('1 seat open');
    expect(discovery.getPublishedAvailabilityLabel(mixedStatus)).toBe('1 seat open · 3 waiting');
    expect(discovery.getPublishedTableSummary(mixedStatus)).toBe('1 running · 1 forming · 1 paused');
    expect(discovery.getClubAvailabilityLabel(club('club-mixed', {}, [mixedStatus]))).toBe('1 seat open');
    expect(discovery.getCompatibilitySummary({
      club: club('club-a'), game: formingWithCapacity, distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' as const
    })).not.toContain('open seat');
    expect(discovery.getCompatibilitySummary({
      club: club('club-a'), game: pausedWithCapacity, distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' as const
    })).not.toContain('open seat');

    const item = { club: club('club-a'), game: runningFull, distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' as const };
    expect(discovery.getOpportunityLabel(item)).toBe('Published game');
    expect(discovery.getRecommendationReason(item)).toBe('running table with 0 open seats / no active membership shown / 2 familiar players');
    expect(discovery.getOpportunityTableLabel({ ...item, game: game({ openTables: [{ ...table, label: '' }] }) }, 0)).toBeUndefined();
    expect(discovery.getOpportunityTableLabel({ ...item, game: game({ openTables: [{ ...table, label: 'Feature Table' }] }) }, 42)).toBe('Feature Table');
  });

  it('preserves immutable discovery decisions by club and game IDs', () => {
    const first = { club: club('club-a'), game: game(), distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' as const };
    const second = { club: club('club-b'), game: game({ id: 'game-2' }), distanceMiles: null, isJoined: false, isPreferred: false, seatRequestAccess: 'missing' as const };
    const decisions = { [discovery.getOpportunityKey(first)]: 'saved' as const };
    expect(discovery.getDiscoveryDeck([first, second], decisions)).toEqual([second]);
    expect(discovery.getSavedOpportunities([first, second], decisions)).toEqual([first]);
    expect(discovery.advanceDiscoveryCycle([first, second], decisions, second, 'pass')).toEqual({ [discovery.getOpportunityKey(second)]: 'pass' });
  });

  it('validates contact fields and updates preference IDs immutably', () => {
    expect(discovery.isValidEmail(' Alex@Example.COM ')).toBe(true);
    expect(discovery.isValidEmail('alex@example')).toBe(false);
    const updated = discovery.togglePreferredGame(player, 'game-2');
    expect(updated.preferredGameIds).toEqual(['game-1', 'game-2']);
    expect(player.preferredGameIds).toEqual(['game-1']);
  });
});
