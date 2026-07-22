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
  collectionMode?: 'Time' | 'Drop';
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
  plan?: 'day' | 'monthly';
  paymentMethod?: 'app' | 'in-person' | 'core';
  requestedAt?: string;
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
  plan?: 'day' | 'monthly';
  paymentMethod?: 'app' | 'in-person' | 'core';
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
  plan: 'day' | 'monthly';
  paymentMethod: 'app' | 'in-person';
  priceLabel?: string;
  requestedAt: string;
};

export type PlayerWaitlistRequest = {
  id: string;
  type: 'waitlist-request';
  clubId: string;
  player: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>;
  gameId: string;
  action?: 'join' | 'cancel';
  attendance?: 'arrived' | 'confirmed' | 'interested';
  expectedArrivalTime?: string;
  availabilityStartTime?: string;
  availabilityEndTime?: string;
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

export function createMembershipRequest(
  player: PlayerAccount,
  clubId: string,
  requestedAt = new Date().toISOString(),
  options: { plan?: 'day' | 'monthly'; paymentMethod?: 'app' | 'in-person'; priceLabel?: string } = {}
): PlayerMembershipRequest {
  return {
    id: requestId('join', `${clubId}-${player.email || player.id}`, requestedAt),
    type: 'membership-request',
    clubId,
    player,
    plan: options.plan ?? 'monthly',
    paymentMethod: options.paymentMethod ?? 'app',
    priceLabel: options.priceLabel,
    requestedAt
  };
}

export function createWaitlistRequest(
  player: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>,
  clubId: string,
  gameId: string,
  options: {
    action?: 'join' | 'cancel';
    attendance?: 'arrived' | 'confirmed' | 'interested';
    expectedArrivalTime?: string;
    availabilityStartTime?: string;
    availabilityEndTime?: string;
    tableId?: string;
    note?: string;
    requestedAt?: string;
  } = {}
): PlayerWaitlistRequest {
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  return {
    id: requestId('wait', `${clubId}-${gameId}-${player.email || player.id}`, requestedAt),
    type: 'waitlist-request',
    clubId,
    player,
    gameId,
    action: options.action ?? 'join',
    attendance: options.attendance,
    expectedArrivalTime: options.expectedArrivalTime,
    availabilityStartTime: options.availabilityStartTime,
    availabilityEndTime: options.availabilityEndTime,
    tableId: options.tableId,
    note: options.note,
    requestedAt
  };
}

export type ClubMembershipPlan = 'day' | 'monthly';
export type ClubMembershipPaymentMethod = 'app' | 'in-person';

export function normalizedIdentity(value?: string) {
  return (value ?? '').trim().toLowerCase();
}

export function isPlayerMembership(membership: PlayerClubSnapshot['memberships'][number], player: PlayerAccount) {
  const playerId = normalizedIdentity(player.id);
  const playerName = normalizedIdentity(player.name);
  return Boolean(
    (playerId && normalizedIdentity(membership.playerId) === playerId) ||
    (playerName && normalizedIdentity(membership.playerName) === playerName)
  );
}

export function isMembershipCurrentlyActive(
  membership: PlayerClubSnapshot['memberships'][number],
  nowMs: number
) {
  if (membership.status !== 'Active') return false;
  if (!membership.expiresAt) return true;
  const expiresAt = Date.parse(membership.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function formatPassCountdown(expiresAt: string | undefined, nowMs: number) {
  if (!expiresAt) return 'Active pass';
  const remaining = Math.max(0, Date.parse(expiresAt) - nowMs);
  const totalMinutes = Math.floor(remaining / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

export function isPlayerWaitlistEntry(entry: PlayerWaitlistEntry, player: PlayerAccount) {
  const playerId = normalizedIdentity(player.id);
  const playerName = normalizedIdentity(player.name);
  return Boolean(
    (playerId && normalizedIdentity(entry.playerId) === playerId) ||
    (playerName && normalizedIdentity(entry.playerName) === playerName)
  );
}

export function getWaitlistAheadText(entry: PlayerWaitlistEntry) {
  if (entry.status === 'Confirmed Coming') return 'Confirmed coming - Core has your RSVP.';
  if (entry.status === 'Arrived') return 'Checked in - Core has you marked as arrived.';
  if (entry.status === 'Seated') return 'Seated - Core has moved you to a table.';
  if (entry.status === 'Declined') return 'This request was declined. You can send a new seat request.';
  if (entry.status === 'No-Show') return 'Core marked this visit as a no-show. You can request again.';
  if (entry.status === 'Left Before Seated') return 'Core marked this visit as left before seating.';
  const ahead = Math.max(0, entry.position - 1);
  return ahead === 1 ? '1 person in front of you' : `${ahead} people in front of you`;
}

export function getPlayerGameStatusLabel(entry: PlayerWaitlistEntry) {
  if (entry.status === 'Interested') return `Waitlist #${entry.position}`;
  if (entry.status === 'Confirmed Coming') return 'Confirmed coming';
  if (entry.status === 'Arrived') return 'Arrived';
  if (entry.status === 'Seated') return 'Seated';
  return entry.status;
}
