import { createSecureUuid } from '../security/secureIdentifier';

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

export type PlayerRecordDocument = {
  id: string;
  data(): unknown;
};

export type PlayerCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlayerSyncClub = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  minimumAge?: 18 | 21;
  coordinate?: PlayerCoordinate;
  venueKind?: 'Casino' | 'Card house' | 'Poker club';
  syncProtocolVersion?: number;
  syncRevision?: string;
  publishedAt?: string;
  membershipOptions?: PlayerMembershipOption[];
};

export type PlayerMembershipOption = {
  id: string;
  name: string;
  priceLabel: string;
  durationDays: number;
  description?: string;
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
  adultDeclaredAt?: string;
  adultDeclarationVersion?: 'v1';
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
  syncRevision?: string;
  updatedAt?: string;
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
  status: 'Requested' | 'Approved' | 'Active' | 'Expired';
  joinedAt?: string;
  expiresAt?: string;
  plan?: 'day' | 'monthly';
  planName?: string;
  membershipDurationDays?: number;
  paymentMethod?: 'app' | 'in-person' | 'core';
  paymentStatus?: 'Not required' | 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  identityReviewStatus?: 'Pending' | 'Approved' | 'Rejected' | 'Not required';
  requestedAt?: string;
  loyalty?: PlayerLoyalty;
  preferredGameIds: string[];
  preferredStakes?: string;
  clubNote?: string;
};

export function getApprovedMembershipActivationCopy(membership: PlayerMembership) {
  const identityPending = membership.identityReviewStatus === 'Pending';
  if (identityPending) {
    return {
      title: 'Physical ID review needed',
      body: 'Bring your physical ID. Venue staff will confirm any fee in person and publish your access status.'
    };
  }
  return {
    title: 'Confirm access with venue staff',
    body: 'Venue staff will confirm any fee in person and publish the membership status shown here.'
  };
}

export function getPublishedMembershipPlanLabel(membership: Pick<PlayerMembership, 'planName'>) {
  return membership.planName?.trim() || 'Membership access';
}

export type PlayerClubMembershipRecord = {
  clubId: string;
  status: 'Requested' | 'Approved' | 'Active' | 'Expired' | 'Denied';
  requestedAt?: string;
  joinedAt?: string;
  expiresAt?: string;
  plan?: 'day' | 'monthly';
  planName?: string;
  membershipDurationDays?: number;
  paymentMethod?: 'app' | 'in-person' | 'core';
  preferredGameIds?: string[];
  preferredStakes?: string;
};

export type PlayerProfileDocument = PlayerAccount & {
  uid: string;
  clubMemberships?: Record<string, PlayerClubMembershipRecord>;
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
  reason: 'game-forming' | 'seat-opened' | 'membership-approved' | 'membership-activated';
  createdAt: string;
  expiresAt?: string;
  targetPlayerIds?: string[];
  targetPlayerNames?: string[];
};

// Hydrated consumer snapshot. Revision fields remain optional so legacy
// pre-protocol-v2 publishers continue to load through the compatibility path.
export type PlayerClubSnapshot = {
  club: PlayerSyncClub;
  games: PlayerSyncGame[];
  memberships: PlayerMembership[];
  waitlists: PlayerWaitlistEntry[];
  notifications: PlayerInAppNotification[];
  social?: PlayerSocialSummary;
  timeAccess?: PlayerTimeAccess;
  generatedAt: string;
  syncProtocolVersion?: number;
  syncRevision?: string;
};

export type PlayerTimeAccess = {
  enabled: boolean;
  hourlyFeeCents: number;
  linked: boolean;
  profileId?: string;
  savedMinutes: number;
  activeSession?: {
    id: string;
    tableId: string;
    tableLabel: string;
    gameId: string;
    gameName: string;
    purchasedMinutes: number;
    remainingMinutes: number;
  };
};

export type PlayerTournament = {
  id: string;
  clubId: string;
  name: string;
  startsAt: string;
  interestOpensAt: string;
  interestClosesAt: string;
  interestStatus: 'open' | 'closed';
  buyIn?: number;
  prizePoolLabel?: string;
  startingStack?: number;
  levelMinutes?: number;
  lateRegistrationThroughLevel?: number;
  rebuyPrice?: number;
  rebuyStack?: number;
  unlimitedRebuys?: boolean;
  rebuysAllowed: boolean;
  addOnPrice?: number;
  addOnStack?: number;
  addOnsAllowed: boolean;
  rules: string[];
  withdrawalAllowed: boolean;
  entrantCount?: number;
  totalRebuys?: number;
  totalAddOns?: number;
  featured?: boolean;
};

export function isTournamentInterestOpen(tournament: PlayerTournament, nowMs = Date.now()) {
  const opensAt = Date.parse(tournament.interestOpensAt);
  const closesAt = Date.parse(tournament.interestClosesAt);
  const startsAt = Date.parse(tournament.startsAt);
  return tournament.interestStatus === 'open'
    && Number.isFinite(opensAt)
    && Number.isFinite(closesAt)
    && Number.isFinite(startsAt)
    && nowMs >= opensAt
    && nowMs < closesAt
    && nowMs < startsAt;
}

export type PlayerTournamentInterest = {
  id: string;
  tournamentId: string;
  clubId: string;
  playerId: string;
  status: 'interested' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
};

export type PlayerMembershipRequest = {
  id: string;
  type: 'membership-request';
  clubId: string;
  player: PlayerAccount;
  paymentMethod: 'in-person';
  priceLabel?: string;
  planId: string;
  planName: string;
  planPriceLabel?: string;
  membershipDurationDays: number;
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
  requestedAt: string;
};

export function createOpaquePlayerId(prefix: 'player' | 'join' | 'wait' | 'identity' = 'player') {
  return `${prefix}_${createSecureUuid()}`;
}

export function createMembershipRequest(
  player: PlayerAccount,
  clubId: string,
  requestedAt: string | undefined,
  options: {
    paymentMethod?: 'in-person';
    priceLabel?: string;
    planId: string;
    planName: string;
    membershipDurationDays: number;
  }
): PlayerMembershipRequest {
  return {
    id: createOpaquePlayerId('join'),
    type: 'membership-request',
    clubId,
    player,
    paymentMethod: options.paymentMethod ?? 'in-person',
    priceLabel: options.priceLabel,
    planId: options.planId,
    planName: options.planName,
    planPriceLabel: options.priceLabel,
    membershipDurationDays: options.membershipDurationDays,
    requestedAt: requestedAt ?? new Date().toISOString()
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
    requestedAt?: string;
  } = {}
): PlayerWaitlistRequest {
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  return {
    id: createOpaquePlayerId('wait'),
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
    requestedAt
  };
}

export function normalizedIdentity(value?: string) {
  return (value ?? '').trim().toLowerCase();
}

export function isPlayerMembership(membership: PlayerClubSnapshot['memberships'][number], player: PlayerAccount) {
  const playerId = normalizedIdentity(player.id);
  const membershipPlayerId = normalizedIdentity(membership.playerId);
  return Boolean(playerId && membershipPlayerId && membershipPlayerId === playerId);
}

export type PlayerSeatRequestAccess = 'active' | 'pending' | 'renewal' | 'missing';

export function getPlayerSeatRequestAccess(
  club: Pick<PlayerClubSnapshot, 'memberships'>,
  player: PlayerAccount,
  nowMs: number
): PlayerSeatRequestAccess {
  const membership = club.memberships.find((candidate) => isPlayerMembership(candidate, player));
  if (!membership) return 'missing';
  if (isMembershipCurrentlyActive(membership, nowMs)) return 'active';
  if (membership.status === 'Requested' || membership.status === 'Approved') return 'pending';
  return 'renewal';
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
  const entryPlayerId = normalizedIdentity(entry.playerId);
  return Boolean(playerId && entryPlayerId && entryPlayerId === playerId);
}

export function isActivePlayerGameRequest(entry: PlayerWaitlistEntry) {
  return ['Interested', 'Confirmed Coming', 'Arrived', 'Seated'].includes(entry.status);
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
