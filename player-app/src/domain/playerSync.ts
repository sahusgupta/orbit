export type PlayerSyncGameStatus = 'Running' | 'Forming' | 'Paused' | 'Closed' | 'Failed to Start';
export type PlayerSyncInterestStatus =
  | 'Interested'
  | 'Confirmed Coming'
  | 'Arrived'
  | 'Seated'
  | 'Declined'
  | 'No-Show'
  | 'Left Before Seated'
  | 'Removed';

export type PlayerSyncClub = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
};

export type PlayerAccount = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  homeLocation?: string;
  searchRadiusMiles?: number;
  preferredGameIds: string[];
  favoriteClubIds?: string[];
  preferredStakes?: string;
  typicalAvailability?: string;
};

export type PlayerSyncTable = {
  id: string;
  gameId: string;
  label: string;
  status: Extract<PlayerSyncGameStatus, 'Running' | 'Forming' | 'Paused'>;
  seatsFilled: number;
  maxSeats: number;
  availableSeats: number;
  collectionMode: 'Time' | 'Drop';
  tags: string[];
  startedAt: string;
  social: PlayerTableSocialSummary;
};

export type PlayerSyncGame = {
  id: string;
  name: string;
  maxSeats: number;
  openTables: PlayerSyncTable[];
  waitlistCount: number;
  formingCount: number;
  availableSeats: number;
  knownPlayersCount: number;
};

export type PlayerSocialSummary = {
  activePlayerCount: number;
  adminCount: number;
  knownPlayersInHouse: number;
  waitlistCount: number;
};

export type PlayerTableSocialSummary = {
  seatedPlayerCount: number;
  adminCount: number;
  knownPlayersCount: number;
};

export type PlayerLoyalty = {
  clubId: string;
  points: number;
  lifetimeHours: number;
  tier: 'New' | 'Regular' | 'Preferred' | 'Anchor';
  nextTierAtHours: number | null;
};

export type PlayerMembership = {
  id: string;
  clubId: string;
  playerId: string;
  playerName: string;
  status: 'Requested' | 'Active' | 'Expired';
  joinedAt: string;
  expiresAt?: string;
  loyalty: PlayerLoyalty;
  preferredGameIds: string[];
  preferredStakes?: string;
  clubNote?: string;
};

export type PlayerClubMembershipRecord = {
  clubId: string;
  status: 'Requested' | 'Active' | 'Expired' | 'Denied';
  requestedAt?: string;
  joinedAt?: string;
  expiresAt?: string;
  preferredGameIds?: string[];
  preferredStakes?: string;
};

export type PlayerProfileDocument = PlayerAccount & {
  uid: string;
  clubMemberships?: Record<string, PlayerClubMembershipRecord>;
  premium?: {
    status?: 'inactive' | 'pending' | 'active' | 'past_due' | 'canceled';
    currentPeriodEnd?: string;
  };
  subscriptionStatus?: 'inactive' | 'pending' | 'active' | 'past_due' | 'canceled';
  updatedAt?: string;
};

export type PlayerWaitlistEntry = {
  id: string;
  clubId: string;
  gameId: string;
  playerId?: string;
  playerName: string;
  status: PlayerSyncInterestStatus;
  position: number;
  requestedAt: string;
  tableId?: string;
};

export type PlayerInAppNotification = {
  id: string;
  clubId: string;
  gameId: string;
  title: string;
  body: string;
  reason: 'game-forming' | 'seat-opened';
  createdAt: string;
  expiresAt?: string;
  targetPlayerIds?: string[];
  targetPlayerNames?: string[];
};

export type PlayerClubSnapshot = {
  club: PlayerSyncClub;
  games: PlayerSyncGame[];
  memberships: PlayerMembership[];
  waitlists: PlayerWaitlistEntry[];
  notifications: PlayerInAppNotification[];
  social: PlayerSocialSummary;
  generatedAt: string;
};

export type TournamentRegistrationStatus =
  | 'registered'
  | 'checked-in'
  | 'eliminated'
  | 'rebought'
  | 'add-on-purchased'
  | 'finished';

export type PlayerTournament = {
  id: string;
  clubId: string;
  name: string;
  startsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  registrationStatus: 'open' | 'closed';
  buyIn: number;
  prizePoolLabel: string;
  startingStack: number;
  levelMinutes: number;
  lateRegistrationThroughLevel: number;
  rebuyPrice: number;
  rebuyStack: number;
  unlimitedRebuys: boolean;
  addOnPrice: number;
  addOnStack: number;
  rules: string[];
  unregisterAllowed: boolean;
  entrantCount: number;
  totalRebuys: number;
  totalAddOns: number;
  featured?: boolean;
};

export type PlayerTournamentRegistration = {
  id: string;
  tournamentId: string;
  clubId: string;
  playerId: string;
  playerName: string;
  playerEmail: string;
  status: TournamentRegistrationStatus;
  rebuys: number;
  addOns: number;
  registeredAt: string;
  checkedInAt?: string;
  updatedAt: string;
};

export type PlayerPrivateGameListing = {
  id: string;
  name: string;
  location: string;
  startsAt: string;
  seats: string;
  note: string;
  hostPlayerId: string;
  hostPlayerPath: string;
  hostPlayerName: string;
  hostPlayerEmail?: string;
  createdAt: string;
  status: 'Open' | 'Cancelled' | 'Closed';
};

export type PlayerMembershipRequest = {
  id: string;
  type: 'membership-request';
  clubId: string;
  player: PlayerAccount;
  requestedAt: string;
};

export type PlayerWaitlistRequest = {
  id: string;
  type: 'waitlist-request';
  clubId: string;
  player: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>;
  gameId: string;
  tableId?: string;
  note?: string;
  requestedAt: string;
};

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'club';

const requestId = (prefix: string, seed: string, at: string) => `${prefix}_${slug(seed)}_${Date.parse(at) || Date.now()}`;

export function getPlayerLoyalty(clubId: string, lifetimeHours = 0): PlayerLoyalty {
  const hours = Math.max(0, lifetimeHours);
  if (hours >= 120) {
    return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Anchor', nextTierAtHours: null };
  }
  if (hours >= 50) {
    return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Preferred', nextTierAtHours: 120 };
  }
  if (hours >= 12) {
    return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Regular', nextTierAtHours: 50 };
  }
  return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'New', nextTierAtHours: 12 };
}

export function createMembershipRequest(player: PlayerAccount, clubId: string, requestedAt = new Date().toISOString()): PlayerMembershipRequest {
  return {
    id: requestId('join', `${clubId}-${player.email || player.id}`, requestedAt),
    type: 'membership-request',
    clubId,
    player,
    requestedAt
  };
}

export function createWaitlistRequest(
  player: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>,
  clubId: string,
  gameId: string,
  options: { tableId?: string; note?: string; requestedAt?: string } = {}
): PlayerWaitlistRequest {
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  return {
    id: requestId('wait', `${clubId}-${gameId}-${player.email || player.id}`, requestedAt),
    type: 'waitlist-request',
    clubId,
    player,
    gameId,
    tableId: options.tableId,
    note: options.note,
    requestedAt
  };
}
