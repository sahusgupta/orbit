import type {
  PlayerClubSnapshot,
  PlayerClubMembershipRecord,
  PlayerCoordinate,
  PlayerInAppNotification,
  PlayerMembership,
  PlayerProfileDocument,
  PlayerSyncGame,
  PlayerSyncTable,
  PlayerTournament,
  PlayerTournamentInterest,
  PlayerWaitlistEntry
} from '../playerSync';
import type { PlayerIdentityStatus } from '../playerIdentity';
import { normalizeE164Phone } from '../playerPhone';

type UnknownRecord = Record<string, unknown>;

const identityStatuses = new Set<PlayerIdentityStatus['status']>([
  'unverified', 'requires_input', 'processing', 'provisional', 'verified', 'underage', 'canceled', 'redacted'
]);
const membershipStatuses = new Set<PlayerMembership['status']>(['Requested', 'Approved', 'Active', 'Expired']);
const waitlistStatuses = new Set<PlayerWaitlistEntry['status']>([
  'Interested', 'Confirmed Coming', 'Arrived', 'Seated', 'Declined', 'No-Show', 'Left Before Seated', 'Removed'
]);
const notificationReasons = new Set<PlayerInAppNotification['reason']>([
  'game-forming', 'seat-opened', 'membership-approved', 'membership-activated'
]);

export type DecodedIdentityResponse = {
  ok: true;
  identity: PlayerIdentityStatus;
  alreadyVerified?: boolean;
  verificationUrl?: string | null;
  returnUrl?: string;
};

export function decodeIdentityResponse(value: unknown): DecodedIdentityResponse | null {
  const record = asRecord(value);
  const identity = record && decodeIdentityStatus(record.identity);
  if (!record || !identity) return null;
  return {
    ok: true,
    identity,
    ...(typeof record.alreadyVerified === 'boolean' ? { alreadyVerified: record.alreadyVerified } : {}),
    ...(typeof record.verificationUrl === 'string' || record.verificationUrl === null ? { verificationUrl: record.verificationUrl } : {}),
    ...(typeof record.returnUrl === 'string' ? { returnUrl: record.returnUrl } : {})
  };
}

export function decodeSnapshotEnvelope(value: unknown) {
  const record = asRecord(value);
  const snapshot = record && decodePlayerClubSnapshot(record.snapshot);
  if (!record || !snapshot) return null;
  return {
    ok: true as const,
    snapshot,
    accountKey: typeof record.accountKey === 'string' ? record.accountKey : snapshot.club.id,
    ...(typeof record.savedAt === 'string' ? { savedAt: record.savedAt } : {})
  };
}

export function decodeDiscoveryResponse(value: unknown) {
  const record = asRecord(value);
  const page = record && asRecord(record.page);
  if (!record || !page || !Array.isArray(record.clubs) || !Array.isArray(record.tournaments) || !Array.isArray(record.interests)) return null;
  const clubs = record.clubs.flatMap((candidate) => {
    const decoded = decodePlayerClubSnapshot(candidate);
    return decoded ? [decoded] : [];
  });
  const tournaments = record.tournaments.flatMap((candidate) => {
    const decoded = decodePlayerTournament(candidate);
    return decoded ? [decoded] : [];
  });
  const interests = record.interests.flatMap((candidate) => {
    const decoded = decodeTournamentInterest(candidate);
    return decoded ? [decoded] : [];
  });
  return {
    ok: true as const,
    clubs,
    tournaments,
    interests,
    page: {
      count: nonnegativeInteger(page.count) ?? clubs.length,
      hasMore: page.hasMore === true,
      nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null,
      databaseQueries: nonnegativeInteger(page.databaseQueries) ?? undefined
    }
  };
}

export function decodeTournamentInterestMutationResponse(value: unknown) {
  const record = asRecord(value);
  if (!record || record.ok !== true) return null;
  const interest = record.interest === undefined ? undefined : decodeTournamentInterest(record.interest);
  if (record.interest !== undefined && !interest) return null;
  return { ok: true as const, ...(interest ? { interest } : {}) };
}

export function decodeMembershipQrResponse(value: unknown) {
  const record = asRecord(value);
  if (
    !record || record.ok !== true || !nonemptyString(record.token) ||
    !validTimestamp(record.expiresAt) || !validTimestamp(record.issuedAt)
  ) return null;
  return { ok: true as const, token: record.token, expiresAt: record.expiresAt, issuedAt: record.issuedAt };
}

export function decodePlayerProfile(value: unknown): PlayerProfileDocument | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.uid) || !nonemptyString(record.name) ||
    typeof record.email !== 'string' || !isStringArray(record.preferredGameIds)
  ) return null;
  const email = record.email;
  if (!nonemptyString(email) && !(email === '' && isE164Phone(record.phone))) return null;
  const searchRadiusMiles = boundedSearchRadius(record.searchRadiusMiles);
  const clubMemberships = decodeProfileMemberships(record.clubMemberships);
  return {
    uid: record.uid,
    id: typeof record.id === 'string' ? record.id : record.uid,
    name: record.name,
    email,
    preferredGameIds: record.preferredGameIds,
    ...(typeof record.phone === 'string' ? { phone: record.phone } : {}),
    ...(typeof record.homeLocation === 'string' ? { homeLocation: record.homeLocation } : {}),
    ...(searchRadiusMiles != null ? { searchRadiusMiles } : {}),
    ...(isStringArray(record.favoriteClubIds) ? { favoriteClubIds: record.favoriteClubIds } : {}),
    ...(typeof record.preferredStakes === 'string' ? { preferredStakes: record.preferredStakes } : {}),
    ...(typeof record.typicalAvailability === 'string' ? { typicalAvailability: record.typicalAvailability } : {}),
    ...(typeof record.adultDeclaredAt === 'string' ? { adultDeclaredAt: record.adultDeclaredAt } : {}),
    ...(record.adultDeclarationVersion === 'v1' ? { adultDeclarationVersion: 'v1' as const } : {}),
    ...(clubMemberships ? { clubMemberships } : {}),
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {})
  };
}

export function readBoundaryError(value: unknown, fallback: string) {
  const record = asRecord(value);
  return typeof record?.error === 'string' ? record.error : fallback;
}

export function readFirebaseErrorCode(value: unknown) {
  const record = asRecord(value);
  return typeof record?.code === 'string' ? record.code : undefined;
}

export function decodePlayerClubSnapshot(value: unknown): PlayerClubSnapshot | null {
  const record = asRecord(value);
  const rawClub = record && asRecord(record.club);
  if (
    !record || !rawClub || !nonemptyString(rawClub.id) || !nonemptyString(rawClub.name) ||
    !Array.isArray(record.games) || !Array.isArray(record.memberships) || !Array.isArray(record.waitlists) ||
    (record.notifications !== undefined && !Array.isArray(record.notifications))
  ) return null;

  const coordinate = decodeCoordinate(rawClub.coordinate);
  const timeAccess = record.timeAccess === undefined ? undefined : decodePlayerTimeAccess(record.timeAccess);
  if (record.timeAccess !== undefined && !timeAccess) return null;
  const minimumAge = rawClub.minimumAge === 18 || rawClub.minimumAge === 21 ? rawClub.minimumAge : undefined;
  const venueKind = rawClub.venueKind === 'Casino' || rawClub.venueKind === 'Card house' || rawClub.venueKind === 'Poker club'
    ? rawClub.venueKind
    : undefined;
  const syncProtocolVersion = nonnegativeInteger(rawClub.syncProtocolVersion);
  const snapshotProtocolVersion = nonnegativeInteger(record.syncProtocolVersion);
  const social = decodeSocial(record.social);
  return {
    club: {
      id: rawClub.id,
      name: rawClub.name,
      ...(typeof rawClub.address === 'string' ? { address: rawClub.address } : {}),
      ...(typeof rawClub.phone === 'string' ? { phone: rawClub.phone } : {}),
      ...(minimumAge ? { minimumAge } : {}),
      ...(coordinate ? { coordinate } : {}),
      ...(venueKind ? { venueKind } : {}),
      ...(Array.isArray(rawClub.membershipOptions) ? { membershipOptions: rawClub.membershipOptions.flatMap(decodeMembershipOption) } : {}),
      ...(syncProtocolVersion != null ? { syncProtocolVersion } : {}),
      ...(typeof rawClub.syncRevision === 'string' ? { syncRevision: rawClub.syncRevision } : {}),
      ...(typeof rawClub.publishedAt === 'string' ? { publishedAt: rawClub.publishedAt } : {})
    },
    games: record.games.flatMap((candidate) => {
      const decoded = decodePlayerSyncGame(candidate);
      return decoded ? [decoded] : [];
    }),
    memberships: record.memberships.flatMap((candidate) => {
      const decoded = decodePlayerMembership(candidate);
      return decoded ? [decoded] : [];
    }),
    waitlists: record.waitlists.flatMap((candidate) => {
      const decoded = decodePlayerWaitlist(candidate);
      return decoded ? [decoded] : [];
    }),
    notifications: (record.notifications ?? []).flatMap((candidate: unknown) => {
      const decoded = decodePlayerNotification(candidate);
      return decoded ? [decoded] : [];
    }),
    ...(social ? { social } : {}),
    ...(timeAccess ? { timeAccess } : {}),
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
    ...(snapshotProtocolVersion != null ? { syncProtocolVersion: snapshotProtocolVersion } : {}),
    ...(typeof record.syncRevision === 'string' ? { syncRevision: record.syncRevision } : {})
  };
}

export function decodePlayerTournament(value: unknown): PlayerTournament | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.clubId) || !nonemptyString(record.name) ||
    !validTimestamp(record.startsAt) || !validTimestamp(record.interestOpensAt) || !validTimestamp(record.interestClosesAt) ||
    (record.interestStatus !== 'open' && record.interestStatus !== 'closed') ||
    typeof record.withdrawalAllowed !== 'boolean' || typeof record.rebuysAllowed !== 'boolean' ||
    typeof record.addOnsAllowed !== 'boolean' ||
    !isStringArray(record.rules)
  ) return null;
  const numericFields = [
    'buyIn', 'startingStack', 'levelMinutes', 'lateRegistrationThroughLevel', 'rebuyPrice', 'rebuyStack',
    'addOnPrice', 'addOnStack', 'entrantCount', 'totalRebuys', 'totalAddOns'
  ] as const;
  if (numericFields.some((field) => record[field] !== undefined && nonnegativeFinite(record[field]) == null)) return null;
  if (record.unlimitedRebuys !== undefined && typeof record.unlimitedRebuys !== 'boolean') return null;
  return {
    id: record.id,
    clubId: record.clubId,
    name: record.name,
    startsAt: record.startsAt,
    interestOpensAt: record.interestOpensAt,
    interestClosesAt: record.interestClosesAt,
    interestStatus: record.interestStatus,
    ...(record.buyIn === undefined ? {} : { buyIn: record.buyIn as number }),
    ...(nonemptyString(record.prizePoolLabel) ? { prizePoolLabel: record.prizePoolLabel } : {}),
    ...(record.startingStack === undefined ? {} : { startingStack: record.startingStack as number }),
    ...(record.levelMinutes === undefined ? {} : { levelMinutes: record.levelMinutes as number }),
    ...(record.lateRegistrationThroughLevel === undefined ? {} : { lateRegistrationThroughLevel: record.lateRegistrationThroughLevel as number }),
    rebuysAllowed: record.rebuysAllowed,
    ...(record.rebuysAllowed && record.rebuyPrice !== undefined ? { rebuyPrice: record.rebuyPrice as number } : {}),
    ...(record.rebuysAllowed && record.rebuyStack !== undefined ? { rebuyStack: record.rebuyStack as number } : {}),
    ...(record.rebuysAllowed && typeof record.unlimitedRebuys === 'boolean' ? { unlimitedRebuys: record.unlimitedRebuys } : {}),
    addOnsAllowed: record.addOnsAllowed,
    ...(record.addOnsAllowed && record.addOnPrice !== undefined ? { addOnPrice: record.addOnPrice as number } : {}),
    ...(record.addOnsAllowed && record.addOnStack !== undefined ? { addOnStack: record.addOnStack as number } : {}),
    rules: record.rules,
    withdrawalAllowed: record.withdrawalAllowed,
    ...(record.entrantCount === undefined ? {} : { entrantCount: record.entrantCount as number }),
    ...(record.totalRebuys === undefined ? {} : { totalRebuys: record.totalRebuys as number }),
    ...(record.totalAddOns === undefined ? {} : { totalAddOns: record.totalAddOns as number }),
    ...(typeof record.featured === 'boolean' ? { featured: record.featured } : {})
  };
}

export function decodeTournamentInterest(value: unknown): PlayerTournamentInterest | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.tournamentId) ||
    !nonemptyString(record.clubId) || !nonemptyString(record.playerId) ||
    (record.status !== 'interested' && record.status !== 'withdrawn') ||
    !validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)
  ) return null;
  return {
    id: record.id,
    tournamentId: record.tournamentId,
    clubId: record.clubId,
    playerId: record.playerId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function decodeCoordinate(value: unknown): PlayerCoordinate | null {
  const record = asRecord(value);
  if (!record || typeof record.latitude !== 'number' || typeof record.longitude !== 'number') return null;
  if (
    !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude) ||
    record.latitude < -90 || record.latitude > 90 || record.longitude < -180 || record.longitude > 180
  ) return null;
  return { latitude: record.latitude, longitude: record.longitude };
}

function decodeIdentityStatus(value: unknown): PlayerIdentityStatus | null {
  const record = asRecord(value);
  const hasVerifiedDetails = Boolean(record && Object.prototype.hasOwnProperty.call(record, 'verifiedDetails'));
  const verifiedDetailsRecord = record && asRecord(record.verifiedDetails);
  const verifiedDetails = !hasVerifiedDetails
    ? undefined
    : record?.verifiedDetails === null
      ? null
      : verifiedDetailsRecord && typeof verifiedDetailsRecord.fullName === 'string' &&
        typeof verifiedDetailsRecord.dateOfBirth === 'string' && typeof verifiedDetailsRecord.address === 'string'
        ? { fullName: verifiedDetailsRecord.fullName, dateOfBirth: verifiedDetailsRecord.dateOfBirth, address: verifiedDetailsRecord.address }
        : undefined;
  if (
    !record || typeof record.status !== 'string' || !identityStatuses.has(record.status as PlayerIdentityStatus['status']) ||
    typeof record.ageVerified !== 'boolean' || typeof record.ageEligible !== 'boolean' ||
    typeof record.ageLevel !== 'number' || typeof record.minimumAge !== 'number' ||
    (record.verifiedAt !== null && typeof record.verifiedAt !== 'string') ||
    (record.capturedAt !== null && typeof record.capturedAt !== 'string') ||
    (record.failureCode !== null && typeof record.failureCode !== 'string') ||
    !['not-started', 'pending-in-person', 'approved'].includes(String(record.reviewStatus || '')) ||
    (hasVerifiedDetails && verifiedDetails === undefined)
  ) return null;
  return {
    status: record.status as PlayerIdentityStatus['status'],
    ageVerified: record.ageVerified,
    ageEligible: record.ageEligible,
    ageLevel: record.ageLevel,
    minimumAge: record.minimumAge,
    verifiedAt: record.verifiedAt,
    capturedAt: record.capturedAt,
    failureCode: record.failureCode,
    reviewStatus: record.reviewStatus as PlayerIdentityStatus['reviewStatus'],
    ...(hasVerifiedDetails ? { verifiedDetails } : {})
  };
}

export function decodePlayerSyncGame(value: unknown): PlayerSyncGame | null {
  const record = asRecord(value);
  if (!record || !nonemptyString(record.id) || !nonemptyString(record.name) || !Array.isArray(record.openTables)) return null;
  const openTables = record.openTables.flatMap((candidate) => {
    const decoded = decodeTable(candidate);
    return decoded ? [decoded] : [];
  });
  if (
    positiveInteger(record.maxSeats) == null ||
    ['waitlistCount', 'formingCount', 'availableSeats', 'knownPlayersCount'].some((field) => nonnegativeInteger(record[field]) == null)
  ) return null;
  const publishedCapacity = openTables.length
    ? openTables.filter((table) => table.status === 'Running').reduce((sum, table) => sum + table.maxSeats, 0)
    : record.maxSeats as number;
  if ((record.availableSeats as number) > publishedCapacity) return null;
  return {
    id: record.id,
    name: record.name,
    maxSeats: record.maxSeats as number,
    ...(record.collectionMode === 'Time' || record.collectionMode === 'Drop' ? { collectionMode: record.collectionMode } : {}),
    openTables,
    waitlistCount: record.waitlistCount as number,
    formingCount: record.formingCount as number,
    availableSeats: record.availableSeats as number,
    knownPlayersCount: record.knownPlayersCount as number,
    ...(typeof record.syncRevision === 'string' ? { syncRevision: record.syncRevision } : {}),
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {})
  };
}

function decodeTable(value: unknown): PlayerSyncTable | null {
  const record = asRecord(value);
  const social = record && decodeTableSocial(record.social);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.gameId) || !nonemptyString(record.label) ||
    !['Running', 'Forming', 'Paused'].includes(String(record.status)) ||
    !['Time', 'Drop'].includes(String(record.collectionMode)) || !isStringArray(record.tags) ||
    typeof record.startedAt !== 'string' || !social
  ) return null;
  if (
    positiveInteger(record.maxSeats) == null || nonnegativeInteger(record.seatsFilled) == null ||
    nonnegativeInteger(record.availableSeats) == null || (record.seatsFilled as number) > (record.maxSeats as number) ||
    (record.availableSeats as number) > (record.maxSeats as number)
  ) return null;
  return {
    id: record.id,
    gameId: record.gameId,
    label: record.label,
    status: record.status as PlayerSyncTable['status'],
    seatsFilled: record.seatsFilled as number,
    maxSeats: record.maxSeats as number,
    availableSeats: record.availableSeats as number,
    collectionMode: record.collectionMode as PlayerSyncTable['collectionMode'],
    tags: record.tags,
    startedAt: record.startedAt,
    social
  };
}

function decodeProfileMemberships(value: unknown): Record<string, PlayerClubMembershipRecord> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Record<string, PlayerClubMembershipRecord> = {};
  for (const [clubId, candidate] of Object.entries(record)) {
    const membership = asRecord(candidate);
    if (
      !nonemptyString(clubId) || !membership || membership.clubId !== clubId ||
      !['Requested', 'Approved', 'Active', 'Expired', 'Denied'].includes(String(membership.status))
    ) continue;
    const plan = membership.plan === 'day' || membership.plan === 'monthly' ? membership.plan : undefined;
    const paymentMethod = membership.paymentMethod === 'app' || membership.paymentMethod === 'in-person' || membership.paymentMethod === 'core'
      ? membership.paymentMethod
      : undefined;
    result[clubId] = {
      clubId,
      status: membership.status as PlayerClubMembershipRecord['status'],
      ...(typeof membership.requestedAt === 'string' ? { requestedAt: membership.requestedAt } : {}),
      ...(typeof membership.joinedAt === 'string' ? { joinedAt: membership.joinedAt } : {}),
      ...(typeof membership.expiresAt === 'string' ? { expiresAt: membership.expiresAt } : {}),
      ...(plan ? { plan } : {}),
      ...(nonemptyString(membership.planName) ? { planName: membership.planName } : {}),
      ...(positiveFinite(membership.membershipDurationDays) != null ? { membershipDurationDays: membership.membershipDurationDays as number } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(isStringArray(membership.preferredGameIds) ? { preferredGameIds: membership.preferredGameIds } : {}),
      ...(typeof membership.preferredStakes === 'string' ? { preferredStakes: membership.preferredStakes } : {})
    };
  }
  return result;
}

export function decodePlayerMembership(value: unknown): (PlayerMembership & { publishedAt?: string; syncRevision?: string }) | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.clubId) || !nonemptyString(record.playerId) ||
    typeof record.playerName !== 'string' || typeof record.status !== 'string' ||
    !membershipStatuses.has(record.status as PlayerMembership['status']) ||
    (record.joinedAt !== undefined && typeof record.joinedAt !== 'string') ||
    !isStringArray(record.preferredGameIds)
  ) return null;
  const loyalty = record.loyalty === undefined ? undefined : decodeLoyalty(record.loyalty, record.clubId);
  if (record.loyalty !== undefined && !loyalty) return null;
  const plan = record.plan === 'day' || record.plan === 'monthly' ? record.plan : undefined;
  const paymentMethod = record.paymentMethod === 'app' || record.paymentMethod === 'in-person' || record.paymentMethod === 'core'
    ? record.paymentMethod
    : undefined;
  const paymentStatus = record.paymentStatus === 'Not required' || record.paymentStatus === 'Pending' || record.paymentStatus === 'Paid' || record.paymentStatus === 'Failed' || record.paymentStatus === 'Refunded'
    ? record.paymentStatus
    : undefined;
  const identityReviewStatus = record.identityReviewStatus === 'Pending' || record.identityReviewStatus === 'Approved' || record.identityReviewStatus === 'Rejected' || record.identityReviewStatus === 'Not required'
    ? record.identityReviewStatus
    : undefined;
  return {
    id: record.id,
    clubId: record.clubId,
    playerId: record.playerId,
    playerName: record.playerName,
    status: record.status as PlayerMembership['status'],
    ...(loyalty ? { loyalty } : {}),
    preferredGameIds: record.preferredGameIds,
    ...(typeof record.joinedAt === 'string' ? { joinedAt: record.joinedAt } : {}),
    ...(typeof record.expiresAt === 'string' ? { expiresAt: record.expiresAt } : {}),
    ...(plan ? { plan } : {}),
    ...(nonemptyString(record.planName) ? { planName: record.planName } : {}),
    ...(positiveFinite(record.membershipDurationDays) != null ? { membershipDurationDays: record.membershipDurationDays as number } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(identityReviewStatus ? { identityReviewStatus } : {}),
    ...(typeof record.requestedAt === 'string' ? { requestedAt: record.requestedAt } : {}),
    ...(typeof record.preferredStakes === 'string' ? { preferredStakes: record.preferredStakes } : {}),
    ...(typeof record.clubNote === 'string' ? { clubNote: record.clubNote } : {}),
    ...(typeof record.publishedAt === 'string' ? { publishedAt: record.publishedAt } : {}),
    ...(typeof record.syncRevision === 'string' ? { syncRevision: record.syncRevision } : {})
  };
}

export function decodePlayerWaitlist(value: unknown): (PlayerWaitlistEntry & { publishedAt?: string; syncRevision?: string }) | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.clubId) || !nonemptyString(record.gameId) ||
    !nonemptyString(record.playerId) || typeof record.playerName !== 'string' || typeof record.status !== 'string' ||
    !waitlistStatuses.has(record.status as PlayerWaitlistEntry['status']) || nonnegativeInteger(record.position) == null ||
    typeof record.requestedAt !== 'string'
  ) return null;
  return record as PlayerWaitlistEntry & { publishedAt?: string; syncRevision?: string };
}

export function decodePlayerNotification(value: unknown): (PlayerInAppNotification & { publishedAt?: string; syncRevision?: string }) | null {
  const record = asRecord(value);
  if (
    !record || !nonemptyString(record.id) || !nonemptyString(record.clubId) || !nonemptyString(record.gameId) ||
    typeof record.title !== 'string' || typeof record.body !== 'string' || typeof record.reason !== 'string' ||
    !notificationReasons.has(record.reason as PlayerInAppNotification['reason']) || typeof record.createdAt !== 'string' ||
    !isStringArray(record.targetPlayerIds) || record.targetPlayerIds.length === 0
  ) return null;
  return {
    id: record.id,
    clubId: record.clubId,
    gameId: record.gameId,
    title: record.title,
    body: record.body,
    reason: record.reason as PlayerInAppNotification['reason'],
    createdAt: record.createdAt,
    targetPlayerIds: record.targetPlayerIds,
    ...(typeof record.expiresAt === 'string' ? { expiresAt: record.expiresAt } : {}),
    ...(typeof record.publishedAt === 'string' ? { publishedAt: record.publishedAt } : {}),
    ...(typeof record.syncRevision === 'string' ? { syncRevision: record.syncRevision } : {})
  };
}

function decodeMembershipOption(value: unknown) {
  const record = asRecord(value);
  if (!record || !nonemptyString(record.id) || !nonemptyString(record.name) || typeof record.priceLabel !== 'string' || positiveFinite(record.durationDays) == null) return [];
  return [{
    id: record.id,
    name: record.name,
    priceLabel: record.priceLabel,
    durationDays: record.durationDays as number,
    ...(typeof record.description === 'string' ? { description: record.description } : {})
  }];
}

function decodePlayerTimeAccess(value: unknown) {
  const record = asRecord(value);
  const activeSession = record?.activeSession === undefined ? undefined : asRecord(record.activeSession);
  if (
    !record || typeof record.enabled !== 'boolean' || typeof record.linked !== 'boolean' ||
    nonnegativeFinite(record.hourlyFeeCents) == null || nonnegativeFinite(record.savedMinutes) == null ||
    (record.profileId !== undefined && typeof record.profileId !== 'string') ||
    (record.activeSession !== undefined && (!activeSession ||
      !nonemptyString(activeSession.id) || !nonemptyString(activeSession.tableId) || !nonemptyString(activeSession.tableLabel) ||
      !nonemptyString(activeSession.gameId) || !nonemptyString(activeSession.gameName) ||
      nonnegativeFinite(activeSession.purchasedMinutes) == null || nonnegativeFinite(activeSession.remainingMinutes) == null))
  ) return null;
  return record as PlayerClubSnapshot['timeAccess'];
}

function decodeSocial(value: unknown): PlayerClubSnapshot['social'] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const activePlayerCount = nonnegativeInteger(record.activePlayerCount);
  const adminCount = nonnegativeInteger(record.adminCount);
  const knownPlayersInHouse = nonnegativeInteger(record.knownPlayersInHouse);
  const waitlistCount = nonnegativeInteger(record.waitlistCount);
  if (activePlayerCount == null || adminCount == null || knownPlayersInHouse == null || waitlistCount == null) return undefined;
  return {
    activePlayerCount,
    adminCount,
    knownPlayersInHouse,
    waitlistCount
  };
}

function decodeTableSocial(value: unknown): PlayerSyncTable['social'] | null {
  const record = asRecord(value);
  if (!record) return null;
  const seatedPlayerCount = nonnegativeFinite(record.seatedPlayerCount);
  const adminCount = nonnegativeFinite(record.adminCount);
  const knownPlayersCount = nonnegativeFinite(record.knownPlayersCount);
  return seatedPlayerCount == null || adminCount == null || knownPlayersCount == null
    ? null
    : { seatedPlayerCount, adminCount, knownPlayersCount };
}

function decodeLoyalty(value: unknown, clubId: string): NonNullable<PlayerMembership['loyalty']> | null {
  const record = asRecord(value);
  if (!record) return null;
  const points = nonnegativeFinite(record.points);
  const lifetimeHours = nonnegativeFinite(record.lifetimeHours);
  if (points == null || lifetimeHours == null || !['New', 'Regular', 'Preferred', 'Anchor'].includes(String(record.tier))) return null;
  const nextTierAtHours = record.nextTierAtHours === null ? null : nonnegativeFinite(record.nextTierAtHours);
  if (record.nextTierAtHours !== null && nextTierAtHours == null) return null;
  return { clubId, points, lifetimeHours, tier: record.tier as NonNullable<PlayerMembership['loyalty']>['tier'], nextTierAtHours };
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function isE164Phone(value: unknown): value is string {
  return typeof value === 'string' && normalizeE164Phone(value) === value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function nonnegativeFinite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveFinite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function boundedSearchRadius(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 500 ? value : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UnknownRecord;
}
