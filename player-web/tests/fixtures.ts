import type {
  DiscoveryPayload,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentInterest
} from '@/src/domain/types';

export const player: PlayerAccount = {
  id: 'player-1',
  name: 'Avery Stone',
  email: 'avery@example.com',
  preferredGameIds: ['game-running'],
  favoriteClubIds: ['club-alpha'],
  preferredStakes: '1/2',
  searchRadiusMiles: 20
};

export const runningGame: PlayerSyncGame = {
  id: 'game-running',
  name: '1/2 NLH',
  maxSeats: 9,
  collectionMode: 'Time',
  openTables: [{
    id: 'table-1',
    gameId: 'game-running',
    label: 'Table One',
    status: 'Running',
    seatsFilled: 7,
    maxSeats: 9,
    availableSeats: 2,
    collectionMode: 'Time',
    tags: [],
    startedAt: '2030-06-15T18:00:00.000Z',
    social: { seatedPlayerCount: 7, adminCount: 1, knownPlayersCount: 0 }
  }],
  waitlistCount: 3,
  formingCount: 0,
  availableSeats: 2,
  knownPlayersCount: 0
};

export const formingGame: PlayerSyncGame = {
  id: 'game-forming',
  name: '2/5 PLO',
  maxSeats: 9,
  collectionMode: 'Drop',
  openTables: [{
    id: 'table-2',
    gameId: 'game-forming',
    label: 'Table Two',
    status: 'Forming',
    seatsFilled: 4,
    maxSeats: 9,
    availableSeats: 5,
    collectionMode: 'Drop',
    tags: [],
    startedAt: '2030-06-15T19:00:00.000Z',
    social: { seatedPlayerCount: 4, adminCount: 1, knownPlayersCount: 0 }
  }],
  waitlistCount: 4,
  formingCount: 1,
  availableSeats: 0,
  knownPlayersCount: 0
};

export const scheduledGame: PlayerSyncGame = {
  id: 'game-scheduled',
  name: '4/8 Limit Holdem',
  maxSeats: 9,
  collectionMode: 'Drop',
  openTables: [],
  waitlistCount: 0,
  formingCount: 0,
  availableSeats: 0,
  knownPlayersCount: 0
};

export const clubAlpha: PlayerClubSnapshot = {
  club: {
    id: 'club-alpha',
    name: 'North Loop Poker Club',
    address: '100 Main Street, Austin, TX',
    membershipOptions: [
      { id: 'day-pass', name: 'Day Pass', priceLabel: '$12', durationDays: 1 },
      { id: 'monthly', name: 'Monthly', priceLabel: '$80', durationDays: 30 }
    ]
  },
  games: [runningGame, formingGame, scheduledGame],
  memberships: [{
    id: 'membership-player-1',
    clubId: 'club-alpha',
    playerId: 'player-1',
    playerName: 'Avery Stone',
    status: 'Active',
    joinedAt: '2030-06-01',
    expiresAt: '2030-07-01T00:00:00.000Z',
    plan: 'monthly',
    paymentMethod: 'in-person',
    loyalty: { clubId: 'club-alpha', points: 120, lifetimeHours: 12, tier: 'Regular', nextTierAtHours: 50 },
    preferredGameIds: ['game-running']
  }],
  waitlists: [{
    id: 'wait-player-1',
    clubId: 'club-alpha',
    gameId: 'game-running',
    playerId: 'player-1',
    playerName: 'Avery Stone',
    status: 'Confirmed Coming',
    position: 2,
    requestedAt: '2030-06-15T17:30:00.000Z'
  }],
  notifications: [],
  social: { activePlayerCount: 18, adminCount: 2, knownPlayersInHouse: 0, waitlistCount: 3 },
  generatedAt: '2030-06-15T18:00:00.000Z'
};

export const clubBeta: PlayerClubSnapshot = {
  club: { id: 'club-beta', name: 'River Room', address: '200 Main Street, Dallas, TX' },
  games: [{ ...runningGame, id: 'game-beta', name: '5/10 Mixed', availableSeats: 1, openTables: runningGame.openTables.map((table) => ({ ...table, id: 'table-beta', gameId: 'game-beta' })) }],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 8, adminCount: 1, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2030-06-15T18:00:00.000Z'
};

export const openTournament: PlayerTournament = {
  id: 'event-open',
  clubId: 'club-alpha',
  name: 'Sunday Orbit Major',
  startsAt: '2030-06-16T18:00:00.000Z',
  interestOpensAt: '2026-01-01T00:00:00.000Z',
  interestClosesAt: '2030-06-16T17:00:00.000Z',
  interestStatus: 'open',
  buyIn: 0,
  prizePoolLabel: '$5,000 guaranteed',
  startingStack: 30000,
  levelMinutes: 25,
  lateRegistrationThroughLevel: 6,
  rebuyPrice: 0,
  rebuyStack: 0,
  unlimitedRebuys: false,
  rebuysAllowed: false,
  addOnPrice: 0,
  addOnStack: 0,
  addOnsAllowed: false,
  rules: ['House rules apply.'],
  withdrawalAllowed: true,
  entrantCount: 28,
  totalRebuys: 0,
  totalAddOns: 0
};

export const paidTournament: PlayerTournament = {
  ...openTournament,
  id: 'event-paid',
  clubId: 'club-beta',
  name: 'Deep Stack Classic',
  interestStatus: 'closed',
  buyIn: 240,
  prizePoolLabel: '$20,000 guaranteed'
};

export const interest: PlayerTournamentInterest = {
  id: 'event-open:player-1',
  tournamentId: 'event-open',
  clubId: 'club-alpha',
  playerId: 'player-1',
  status: 'interested',
  createdAt: '2030-06-01T12:00:00.000Z',
  updatedAt: '2030-06-01T12:00:00.000Z'
};

export const discovery: DiscoveryPayload = {
  clubs: [clubAlpha, clubBeta],
  tournaments: [openTournament, paidTournament],
  interests: [interest],
  page: { count: 2, hasMore: false, nextCursor: null }
};
