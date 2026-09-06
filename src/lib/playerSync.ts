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
  phone?: string;
  address?: string;
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
  collectionMode?: 'Time' | 'Drop';
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
  status: 'Requested' | 'Approved' | 'Active' | 'Expired';
  joinedAt?: string;
  expiresAt?: string;
  plan?: 'day' | 'monthly';
  planId?: string;
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

export type PlayerClubMembershipRecord = {
  clubId: string;
  status: 'Requested' | 'Approved' | 'Active' | 'Expired' | 'Denied';
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
  updatedAt?: string;
};

// Pre-publication player-safe payload. Firebase publication adds protocol-v2
// revision metadata and the parent club commit marker around this shape.
export type PlayerClubSnapshot = {
  club: PlayerSyncClub;
  games: PlayerSyncGame[];
  memberships: PlayerMembership[];
  waitlists: PlayerWaitlistEntry[];
  notifications: PlayerInAppNotification[];
  social: PlayerSocialSummary;
  timeAccess?: PlayerTimeAccess;
  generatedAt: string;
};

export type PlayerTimeAccess = {
  enabled: boolean;
  hourlyFeeCents?: number;
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

export type PlayerMembershipRequest = {
  id: string;
  type: 'membership-request';
  clubId: string;
  player: PlayerAccount;
  plan?: 'day' | 'monthly';
  paymentMethod: 'app' | 'in-person';
  priceLabel?: string;
  planId?: string;
  planName?: string;
  planPriceLabel?: string;
  membershipDurationDays?: number;
  identitySummary?: {
    fullName: string;
    dateOfBirth: string;
    address: string;
    captureMethod: 'player-camera-pdf417';
    capturedAt: string;
    ageLevel: number;
  };
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

type ManagementGame = {
  id: string;
  name: string;
  maxSeats: number;
};

type ManagementSession = {
  id: string;
  gameId: string;
  label: string;
  status: PlayerSyncGameStatus;
  seatsFilled: number;
  maxSeats: number;
  collectionMode?: 'Time' | 'Drop';
  timeFeeBased?: boolean;
  tags?: string[];
  startedAt: string;
};

type ManagementInterest = {
  id: string;
  profileId?: string;
  playerName: string;
  gameId: string;
  status: PlayerSyncInterestStatus;
  interestedAt?: string;
  timestamp?: string;
  notes?: string;
  expectedArrivalTime?: string;
  availabilityStartTime?: string;
  availabilityEndTime?: string;
  tableId?: string;
  confirmedAt?: string;
  arrivedAt?: string;
};

type ManagementProfile = {
  id: string;
  name: string;
  orbitPlayerId?: string;
  email?: string;
  phone?: string;
  birthday?: string;
  membershipStartDate?: string;
  membershipExpirationDate?: string;
  membershipExpiresAt?: string;
  membershipPlan?: 'day' | 'monthly';
  membershipPlanId?: string;
  membershipPaymentMethod?: 'app' | 'in-person' | 'core';
  membershipStatus?: 'Requested' | 'Approved' | 'Active' | 'Expired';
  membershipRequestedAt?: string;
  membershipPriceLabel?: string;
  membershipPlanName?: string;
  membershipDurationDays?: number;
  membershipPaymentStatus?: 'Not required' | 'Pending' | 'Paid' | 'Failed' | 'Refunded';
  membershipPaymentTransactionId?: string;
  membershipPaymentAmountCents?: number;
  address?: string;
  identityReviewStatus?: 'Pending' | 'Approved' | 'Rejected' | 'Not required';
  identityCaptureMethod?: 'id-barcode' | 'id-image-pdf417' | 'id-image-ocr' | 'player-camera-pdf417';
  identityCapturedAt?: string;
  identityReviewedAt?: string;
  identityReviewedByStaffId?: string;
  totalTimePlayedHours?: number;
  lastSessionTimePlayedHours?: number;
  commonlyPlaysWithProfileIds?: string[];
  preferredGameId?: string;
  preferredGameIds?: string[];
  preferredStakes?: string;
  typicalBuyInMin?: number;
  typicalBuyInMax?: number;
  willingnessToMove?: boolean;
  typicalAvailability?: string;
  preferredTags?: string[];
  usualCompanions?: string[];
  notes?: string;
  savedTimeCreditMinutes?: number;
};

type ManagementPlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  seatedAt?: string;
  leftAt?: string;
  timePurchasedMinutes?: number;
  timeRemainingMinutes?: number;
  lastTimeTickAt?: string;
  timeFeeEnabled?: boolean;
};

type ManagementStaffAccount = {
  id: string;
  active?: boolean;
};

export type ManagementClubState = {
  games: ManagementGame[];
  sessions: ManagementSession[];
  playerSessions?: ManagementPlayerSession[];
  interests: ManagementInterest[];
  profiles: ManagementProfile[];
  inAppNotifications?: PlayerInAppNotification[];
  settings?: {
    defaultCollectionMode?: 'Time' | 'Drop';
    defaultHourlyFee?: number;
    collectionProfiles?: Array<{ gameId: string; collectionMode: 'Time' | 'Drop' }>;
    clubAccount?: {
      clubName?: string;
      phone?: string;
      address?: string;
      email?: string;
      minimumPlayerAge?: 18 | 21;
    };
    pilotAccess?: {
      licenseId?: string;
      issuedTo?: string;
      authorizationCode?: string;
    };
    staffAccounts?: ManagementStaffAccount[];
    membershipPlans?: Array<PlayerMembershipOption & { active?: boolean }>;
  };
};

const activeWaitlistStatuses: PlayerSyncInterestStatus[] = ['Interested', 'Confirmed Coming', 'Arrived'];
const playerVisibleWaitlistStatuses: PlayerSyncInterestStatus[] = [
  ...activeWaitlistStatuses,
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated'
];
const visibleTableStatuses: PlayerSyncGameStatus[] = ['Running', 'Forming', 'Paused'];

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'club';

const requestId = (prefix: string) => {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('Secure request ID generation is unavailable.');
  return `${prefix}_${value}`;
};
const addDays = (date: string, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};
const parseMembershipAmountCents = (value?: string) => {
  const match = value?.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};
const matchesPlayerProfile = (
  profile: Pick<ManagementProfile, 'id' | 'orbitPlayerId' | 'name' | 'email' | 'phone'>,
  player?: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>
) => {
  if (!player) return false;
  const playerId = player.id?.trim();
  return Boolean(playerId && (profile.id === playerId || profile.orbitPlayerId === playerId));
};

export function getClubIdFromState(state: ManagementClubState) {
  const account = state.settings?.clubAccount;
  const access = state.settings?.pilotAccess;
  return slug(access?.licenseId || account?.email || account?.clubName || access?.issuedTo || access?.authorizationCode || 'local-club');
}

export function buildPlayerClubSnapshot(
  state: ManagementClubState,
  player?: Pick<PlayerAccount, 'id' | 'name' | 'email' | 'phone'>
): PlayerClubSnapshot {
  const clubId = getClubIdFromState(state);
  const account = state.settings?.clubAccount;
  const activePlayerSessions = (state.playerSessions ?? []).filter((session) => !session.leftAt);
  const activeAdminCount = (state.settings?.staffAccounts ?? []).filter((staff) => staff.active !== false).length;
  const requestingProfile = getRequestingProfile(state.profiles, player);
  const publishedPlayerId = (profileId?: string) => {
    const profile = state.profiles.find((candidate) => candidate.id === profileId);
    return profile?.orbitPlayerId ?? profileId ?? '';
  };
  const knownProfileIds = new Set(requestingProfile?.commonlyPlaysWithProfileIds ?? []);
  const isKnownPlayerSession = (session: ManagementPlayerSession) =>
    Boolean(session.profileId && knownProfileIds.has(session.profileId));
  const tables = state.sessions
    .filter((session) => visibleTableStatuses.includes(session.status))
    .map<PlayerSyncTable>((session) => {
      const seatedSessions = activePlayerSessions.filter((playerSession) => playerSession.tableId === session.id);
      const configuredGameMode = state.settings?.collectionProfiles
        ?.find((profile) => profile.gameId === session.gameId)?.collectionMode;
      const collectionMode = session.collectionMode === 'Time' || session.collectionMode === 'Drop'
        ? session.collectionMode
        : session.timeFeeBased === true
          ? 'Time'
          : configuredGameMode === 'Time' || configuredGameMode === 'Drop'
            ? configuredGameMode
            : state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
              ? state.settings.defaultCollectionMode
              : undefined;
      return {
        id: session.id,
        gameId: session.gameId,
        label: session.label,
        status: session.status as PlayerSyncTable['status'],
        seatsFilled: Math.min(session.seatsFilled, session.maxSeats),
        maxSeats: session.maxSeats,
        availableSeats: Math.max(0, session.maxSeats - session.seatsFilled),
        ...(collectionMode ? { collectionMode } : {}),
        tags: session.tags ?? [],
        startedAt: session.startedAt,
        social: {
          seatedPlayerCount: seatedSessions.length || Math.min(session.seatsFilled, session.maxSeats),
          adminCount: activeAdminCount,
          knownPlayersCount: seatedSessions.filter(isKnownPlayerSession).length
        }
      };
    });
  const runningTables = tables.filter((table) => table.status === 'Running');
  const runningTableIds = new Set(runningTables.map((table) => table.id));
  const activeRunningPlayerSessions = activePlayerSessions.filter((session) => runningTableIds.has(session.tableId));
  const allWaitlists = state.games
    .flatMap((game) => getWaitlistEntriesForGame(state.interests, clubId, game.id))
    .map((entry) => ({ ...entry, playerId: publishedPlayerId(entry.playerId) }));
  const authorizedPlayerIds = new Set([
    player?.id,
    requestingProfile?.id,
    requestingProfile?.orbitPlayerId
  ].filter((value): value is string => Boolean(value)));
  const waitlists = player?.id
    ? allWaitlists.filter((entry) => Boolean(entry.playerId && authorizedPlayerIds.has(entry.playerId)))
    : allWaitlists;
  const memberships = state.profiles
    .filter((profile) => {
      if (!player) return true;
      return matchesPlayerProfile(profile, player);
    })
    .map<PlayerMembership>((profile) => ({
      id: `${clubId}:${publishedPlayerId(profile.id)}`,
      clubId,
      playerId: publishedPlayerId(profile.id),
      playerName: profile.name,
      status: profile.membershipStatus === 'Requested' || profile.membershipStatus === 'Approved'
        ? profile.membershipStatus
        : isFutureDate(profile.membershipExpiresAt ?? profile.membershipExpirationDate)
          ? 'Active'
          : 'Expired',
      ...(profile.membershipStartDate ? { joinedAt: profile.membershipStartDate } : {}),
      expiresAt: profile.membershipStatus === 'Requested' || profile.membershipStatus === 'Approved'
        ? undefined
        : profile.membershipExpiresAt || profile.membershipExpirationDate,
      plan: profile.membershipPlan,
      planId: profile.membershipPlanId,
      planName: profile.membershipPlanName,
      membershipDurationDays: profile.membershipDurationDays,
      paymentMethod: profile.membershipPaymentMethod,
      paymentStatus: profile.membershipPaymentStatus,
      identityReviewStatus: profile.identityReviewStatus,
      requestedAt: profile.membershipRequestedAt,
      preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : profile.preferredGameId ? [profile.preferredGameId] : [],
      preferredStakes: profile.preferredStakes,
      clubNote: profile.typicalAvailability
    }));
  const timeCollectionEnabled = state.settings?.defaultCollectionMode === 'Time' ||
    (state.settings?.collectionProfiles ?? []).some((profile) => profile.collectionMode === 'Time') ||
    tables.some((table) => table.collectionMode === 'Time');
  const linkedPlayerSession = requestingProfile
    ? activePlayerSessions.find((playerSession) => {
        if (playerSession.profileId !== requestingProfile.id) return false;
        const table = tables.find((candidate) => candidate.id === playerSession.tableId);
        return table?.collectionMode === 'Time';
      })
    : undefined;
  const linkedTable = linkedPlayerSession ? tables.find((table) => table.id === linkedPlayerSession.tableId) : undefined;
  const linkedGame = linkedPlayerSession ? state.games.find((game) => game.id === linkedPlayerSession.gameId) : undefined;
  const elapsedMinutes = linkedPlayerSession?.timeFeeEnabled && linkedPlayerSession.lastTimeTickAt
    ? Math.max(0, (Date.now() - Date.parse(linkedPlayerSession.lastTimeTickAt)) / 60_000)
    : 0;
  const timeAccess: PlayerTimeAccess | undefined = timeCollectionEnabled ? {
    enabled: timeCollectionEnabled,
    ...(typeof state.settings?.defaultHourlyFee === 'number' && Number.isFinite(state.settings.defaultHourlyFee)
      ? { hourlyFeeCents: Math.max(0, Math.round(state.settings.defaultHourlyFee * 100)) }
      : {}),
    linked: Boolean(requestingProfile),
    profileId: requestingProfile?.id,
    savedMinutes: Math.max(0, Math.floor(Number(requestingProfile?.savedTimeCreditMinutes ?? 0))),
    ...(linkedPlayerSession && linkedTable && linkedGame ? {
      activeSession: {
        id: linkedPlayerSession.id,
        tableId: linkedPlayerSession.tableId,
        tableLabel: linkedTable.label,
        gameId: linkedPlayerSession.gameId,
        gameName: linkedGame.name,
        purchasedMinutes: Math.max(0, Math.floor(Number(linkedPlayerSession.timePurchasedMinutes ?? 0))),
        remainingMinutes: Math.max(0, Math.ceil(Number(linkedPlayerSession.timeRemainingMinutes ?? 0) - elapsedMinutes))
      }
    } : {})
  } : undefined;

  return {
    club: {
      id: clubId,
      name: account?.clubName || '',
      address: account?.address,
      phone: account?.phone,
      ...(account?.minimumPlayerAge === 18 || account?.minimumPlayerAge === 21
        ? { minimumAge: account.minimumPlayerAge }
        : {}),
      membershipOptions: (state.settings?.membershipPlans ?? [])
        .filter((plan) => plan.active === true
          && plan.id.trim()
          && plan.name.trim()
          && typeof plan.priceLabel === 'string'
          && plan.priceLabel.trim()
          && Number.isInteger(plan.durationDays)
          && plan.durationDays >= 1
          && plan.durationDays <= 3660)
        .map(({ id, name, priceLabel, durationDays, description }) => ({ id, name, priceLabel, durationDays, description }))
    },
    games: state.games.map((game) => {
      const openTables = tables.filter((table) => table.gameId === game.id);
      const runningGameTables = openTables.filter((table) => table.status === 'Running');
      const gameWaitlist = waitlists.filter(
        (entry) => entry.gameId === game.id && activeWaitlistStatuses.includes(entry.status)
      );
      const collectionMode = state.settings?.collectionProfiles?.find((profile) => profile.gameId === game.id)?.collectionMode ??
        openTables[0]?.collectionMode ??
        (state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
          ? state.settings.defaultCollectionMode
          : undefined);
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        ...(collectionMode ? { collectionMode } : {}),
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: runningGameTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: runningGameTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    notifications: (state.inAppNotifications ?? [])
      .filter((notification) => {
        if (!Array.isArray(notification.targetPlayerIds) || notification.targetPlayerIds.length !== 1) return false;
        if (!player) return true;
        return (notification.targetPlayerIds ?? []).some((target) => authorizedPlayerIds.has(target));
      })
      .map((notification) => {
        const { targetPlayerNames: _privateTargetNames, ...publishedNotification } = notification;
        return {
          ...publishedNotification,
          targetPlayerIds: (notification.targetPlayerIds ?? []).map(publishedPlayerId).filter(Boolean)
        };
      }),
    social: {
      activePlayerCount: activeRunningPlayerSessions.length || runningTables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.filter((entry) => activeWaitlistStatuses.includes(entry.status)).length
    },
    ...(timeAccess ? { timeAccess } : {}),
    generatedAt: new Date().toISOString()
  };
}

export function createMembershipRequest(
  player: PlayerAccount,
  clubId: string,
  requestedAt = new Date().toISOString(),
  options: {
    plan?: 'day' | 'monthly';
    paymentMethod?: 'app' | 'in-person';
    priceLabel?: string;
    id?: string;
    name?: string;
    durationDays?: number;
    active?: boolean;
    identitySummary?: PlayerMembershipRequest['identitySummary'];
  } = {}
): PlayerMembershipRequest {
  const configuredPlan = options.id
    ? {
        planId: options.id,
        planName: options.name,
        planPriceLabel: options.priceLabel,
        ...(Number.isInteger(options.durationDays) && Number(options.durationDays) >= 1 && Number(options.durationDays) <= 3660
          ? { membershipDurationDays: Number(options.durationDays) }
          : {})
      }
    : {};
  return {
    id: requestId('join'),
    type: 'membership-request',
    clubId,
    player,
    ...(options.plan ? { plan: options.plan } : {}),
    paymentMethod: options.paymentMethod ?? 'in-person',
    priceLabel: options.priceLabel,
    identitySummary: options.identitySummary,
    ...configuredPlan,
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
    requestedAt?: string;
  } = {}
): PlayerWaitlistRequest {
  const requestedAt = options.requestedAt ?? new Date().toISOString();
  return {
    id: requestId('wait'),
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

export function applyMembershipRequestToClubState(
  state: ManagementClubState,
  request: PlayerMembershipRequest,
  _options: { membershipDurationDays?: number } = {}
): ManagementClubState {
  const clubId = getClubIdFromState(state);
  if (request.clubId !== clubId) return state;

  const existingProfile = state.profiles.find((profile) => matchesPlayerProfile(profile, request.player));
  const preferredGameIds = request.player.preferredGameIds ?? [];
  const identitySummary = request.identitySummary?.captureMethod === 'player-camera-pdf417'
    ? request.identitySummary
    : undefined;
  const identityAlreadyApproved = existingProfile?.identityReviewStatus === 'Approved';
  const identityReviewStatus: ManagementProfile['identityReviewStatus'] = identityAlreadyApproved ? 'Approved' : 'Pending';
  const priceLabel = request.planPriceLabel ?? request.priceLabel;
  const amountCents = parseMembershipAmountCents(priceLabel);
  const hasExplicitZeroPrice = Boolean(priceLabel && (/\bfree\b/i.test(priceLabel) || /(?:^|\D)0(?:\.0+)?(?:\D|$)/.test(priceLabel)));
  const membershipPaymentStatus = hasExplicitZeroPrice ? 'Not required' : 'Pending';
  const preserveCurrentActiveWindow = Boolean(
    existingProfile?.membershipStatus === 'Active' &&
    isFutureDate(existingProfile.membershipExpiresAt ?? existingProfile.membershipExpirationDate)
  );
  const preserveAuthoritativePayment = Boolean(
    existingProfile?.membershipPaymentStatus === 'Paid' && existingProfile.membershipPaymentTransactionId
  );
  const requestNote = 'Player app membership request received';
  const identityPatch = identityAlreadyApproved
    ? { identityReviewStatus: 'Approved' as const }
    : identitySummary
      ? {
        name: identitySummary.fullName || request.player.name,
        birthday: identitySummary.dateOfBirth,
        address: identitySummary.address,
        identityCaptureMethod: 'player-camera-pdf417' as const,
        identityCapturedAt: identitySummary.capturedAt,
        identityReviewStatus
      }
      : { identityReviewStatus };

  const withProfile: ManagementClubState = existingProfile
    ? {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              orbitPlayerId: request.player.id,
              ...identityPatch,
              membershipStartDate: preserveCurrentActiveWindow ? profile.membershipStartDate : '',
              membershipExpirationDate: preserveCurrentActiveWindow ? profile.membershipExpirationDate : '',
              membershipExpiresAt: preserveCurrentActiveWindow ? profile.membershipExpiresAt : undefined,
              membershipPlan: request.plan ?? profile.membershipPlan,
              membershipPlanId: request.planId,
              membershipPaymentMethod: request.paymentMethod,
              membershipStatus: preserveCurrentActiveWindow ? 'Active' : 'Requested',
              membershipRequestedAt: request.requestedAt,
              membershipPriceLabel: request.priceLabel,
              membershipPlanName: request.planName,
              membershipDurationDays: request.membershipDurationDays,
              membershipPaymentStatus: preserveAuthoritativePayment ? 'Paid' : membershipPaymentStatus,
              membershipPaymentTransactionId: preserveAuthoritativePayment ? profile.membershipPaymentTransactionId : undefined,
              membershipPaymentAmountCents: preserveAuthoritativePayment ? profile.membershipPaymentAmountCents : amountCents,
              preferredGameId: profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds ?? []), ...preferredGameIds]),
              preferredStakes: request.player.preferredStakes ?? profile.preferredStakes,
              typicalAvailability: request.player.typicalAvailability ?? profile.typicalAvailability,
              email: request.player.email || profile.email,
              phone: request.player.phone ?? profile.phone,
              notes: appendSyncNote(profile.notes, requestNote)
            }
          : profile
      )
    }
    : {
    ...state,
    profiles: [
      ...state.profiles,
      {
        id: request.player.id,
        orbitPlayerId: request.player.id,
        name: identitySummary?.fullName || request.player.name,
        email: request.player.email,
        phone: request.player.phone ?? '',
        address: identitySummary?.address ?? '',
        birthday: identitySummary?.dateOfBirth ?? '',
        identityCaptureMethod: identitySummary?.captureMethod,
        identityCapturedAt: identitySummary?.capturedAt,
        identityReviewStatus,
        membershipStartDate: '',
        membershipExpirationDate: '',
        ...(request.plan ? { membershipPlan: request.plan } : {}),
        membershipPlanId: request.planId,
        membershipPaymentMethod: request.paymentMethod,
        membershipStatus: 'Requested',
        membershipRequestedAt: request.requestedAt,
        membershipPriceLabel: request.priceLabel,
        membershipPlanName: request.planName,
        membershipDurationDays: request.membershipDurationDays,
        membershipPaymentStatus,
        membershipPaymentAmountCents: amountCents,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: '',
        preferredGameIds,
        preferredStakes: request.player.preferredStakes ?? '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: request.player.typicalAvailability ?? '',
        preferredTags: [],
        usualCompanions: [],
        notes: requestNote
      }
    ]
  };

  return withProfile;
}

export function applyPlayerProfileDocumentToClubState(
  state: ManagementClubState,
  player: PlayerProfileDocument,
  clubId = getClubIdFromState(state)
): ManagementClubState {
  const membership = player.clubMemberships?.[clubId];
  if (!membership || membership.status === 'Denied') return state;
  const membershipStatus: Exclude<PlayerClubMembershipRecord['status'], 'Denied'> = membership.status;

  const stablePlayerId = player.uid?.trim() || player.id?.trim();
  if (!stablePlayerId) return state;
  const existingProfile = state.profiles.find((profile) =>
    profile.id === stablePlayerId || profile.orbitPlayerId === stablePlayerId
  );
  const membershipStartDate = membership.joinedAt ?? '';
  const membershipExpirationDate = membership.expiresAt ?? '';
  const preferredGameIds = membership.preferredGameIds?.length
    ? membership.preferredGameIds
    : player.preferredGameIds?.length
      ? player.preferredGameIds
      : [];

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              orbitPlayerId: stablePlayerId,
              name: player.name || profile.name,
              membershipStartDate: profile.membershipStartDate || membershipStartDate,
              membershipExpirationDate: membershipStatus === 'Active' ? membershipExpirationDate : profile.membershipExpirationDate || membershipExpirationDate,
              membershipExpiresAt: membershipStatus === 'Active' ? membership.expiresAt ?? profile.membershipExpiresAt : profile.membershipExpiresAt,
              membershipPlan: membership.plan ?? profile.membershipPlan,
              membershipPaymentMethod: membership.paymentMethod ?? profile.membershipPaymentMethod,
              membershipStatus: membershipStatus === 'Active' ? 'Active' : profile.membershipStatus ?? membershipStatus,
              membershipRequestedAt: membership.requestedAt ?? profile.membershipRequestedAt,
              preferredGameId: profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds ?? []), ...preferredGameIds]),
              preferredStakes: membership.preferredStakes ?? player.preferredStakes ?? profile.preferredStakes,
              typicalAvailability: player.typicalAvailability ?? profile.typicalAvailability,
              notes: appendSyncNote(profile.notes, 'Player profile synchronized')
            }
          : profile
      )
    };
  }

  return {
    ...state,
    profiles: [
      ...state.profiles,
      {
        id: player.uid || player.id,
        orbitPlayerId: stablePlayerId,
        name: player.name,
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        membershipExpiresAt: membershipStatus === 'Active' ? membership.expiresAt : undefined,
        membershipPlan: membership.plan,
        membershipPaymentMethod: membership.paymentMethod,
        membershipStatus,
        membershipRequestedAt: membership.requestedAt,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: '',
        preferredGameIds,
        preferredStakes: membership.preferredStakes ?? player.preferredStakes ?? '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability ?? '',
        preferredTags: [],
        usualCompanions: [],
        notes: 'Player profile synchronized'
      }
    ]
  };
}

export function applyWaitlistRequestToClubState(state: ManagementClubState, request: PlayerWaitlistRequest): ManagementClubState {
  const clubId = getClubIdFromState(state);
  if (request.clubId !== clubId) return state;

  const profile = state.profiles.find((candidate) => matchesPlayerProfile(candidate, request.player));
  const immutablePlayerIds = new Set([request.player.id, profile?.id, profile?.orbitPlayerId]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value)));
  const matchesPlayer = (interest: ManagementInterest) => Boolean(
    interest.profileId && immutablePlayerIds.has(interest.profileId)
  );

  if (request.action === 'cancel') {
    return {
      ...state,
      interests: state.interests.map((interest) =>
        interest.gameId === request.gameId && activeWaitlistStatuses.includes(interest.status) && matchesPlayer(interest)
          ? {
              ...interest,
              status: 'Removed',
              notes: appendSyncNote(interest.notes, `Seat request cancelled in Player app at ${request.requestedAt}`)
            }
          : interest
      )
    };
  }

  const authoritativeGame = state.games.find((game) => game.id === request.gameId);
  if (!authoritativeGame) return state;
  const attendance = request.attendance ?? (!request.tableId ? 'interested' : undefined);
  const requestedTable = request.tableId
    ? state.sessions.find((session) =>
        session.id === request.tableId &&
        session.gameId === request.gameId &&
        session.status === 'Running'
      )
    : undefined;
  const hasValidIntent = attendance === 'interested'
    ? !request.tableId
    : (attendance === 'arrived' || attendance === 'confirmed') && Boolean(requestedTable);
  if (!hasValidIntent) return state;
  const status: PlayerSyncInterestStatus = attendance === 'arrived'
    ? 'Arrived'
    : attendance === 'confirmed'
      ? 'Confirmed Coming'
      : 'Interested';
  const alreadyWaiting = state.interests.some(
    (interest) =>
      interest.gameId === request.gameId &&
      activeWaitlistStatuses.includes(interest.status) &&
      matchesPlayer(interest)
  );
  if (alreadyWaiting) return state;

  const syncedProfile: ManagementProfile = profile ?? {
    id: request.player.id,
    orbitPlayerId: request.player.id,
    name: request.player.name,
    email: request.player.email,
    phone: request.player.phone ?? '',
    birthday: '',
    membershipStartDate: '',
    membershipExpirationDate: '',
    totalTimePlayedHours: 0,
    lastSessionTimePlayedHours: 0,
    commonlyPlaysWithProfileIds: [],
    preferredGameId: request.gameId,
    preferredGameIds: [request.gameId],
    preferredStakes: '',
    typicalBuyInMin: 0,
    typicalBuyInMax: 0,
    willingnessToMove: false,
    typicalAvailability: '',
    preferredTags: [],
    usualCompanions: [],
    notes: 'Player app game request received'
  };

  const profiles = profile
    ? state.profiles.map((candidate) =>
        candidate.id === profile.id
          ? {
              ...candidate,
              email: request.player.email || candidate.email,
              phone: request.player.phone || candidate.phone,
              preferredGameId: candidate.preferredGameId || request.gameId,
              preferredGameIds: mergeUnique([...(candidate.preferredGameIds ?? []), request.gameId]),
              notes: appendSyncNote(candidate.notes, 'Player app game request received')
            }
          : candidate
      )
    : [...state.profiles, syncedProfile];

  return {
    ...state,
    profiles,
    interests: [
      ...state.interests,
      {
        id: request.id,
        profileId: syncedProfile.id,
        playerName: syncedProfile.name,
        gameId: request.gameId,
        status,
        timestamp: request.requestedAt,
        interestedAt: request.requestedAt,
        confirmedAt: status === 'Confirmed Coming' ? request.requestedAt : undefined,
        arrivedAt: status === 'Arrived' ? request.requestedAt : undefined,
        expectedArrivalTime: request.expectedArrivalTime,
        availabilityStartTime: request.availabilityStartTime,
        availabilityEndTime: request.availabilityEndTime,
        tableId: requestedTable?.id,
        notes: [
          status === 'Arrived'
            ? `At club now - seat requested for ${requestedTable?.label ?? 'open table'}`
            : status === 'Confirmed Coming'
              ? `Confirmed coming${request.expectedArrivalTime ? ` at ${request.expectedArrivalTime}` : ''}${requestedTable ? ` for ${requestedTable.label}` : ''}`
              : `Interested${request.availabilityStartTime ? ` from ${request.availabilityStartTime}` : ''}${request.availabilityEndTime ? ` to ${request.availabilityEndTime}` : ''}`,
        ].filter(Boolean).join(' | ')
      }
    ]
  };
}

export function getWaitlistEntriesForGame(interests: ManagementInterest[], clubId: string, gameId: string): PlayerWaitlistEntry[] {
  let activePosition = 0;
  return interests
    .filter((interest) => interest.gameId === gameId && playerVisibleWaitlistStatuses.includes(interest.status))
    .sort((left, right) => getInterestTime(left).localeCompare(getInterestTime(right)))
    .map((interest) => {
      const isActive = activeWaitlistStatuses.includes(interest.status);
      if (isActive) activePosition += 1;
      return {
        id: interest.id,
        clubId,
        gameId,
        playerId: interest.profileId,
        playerName: interest.playerName,
        status: interest.status,
        position: isActive ? activePosition : 0,
        requestedAt: getInterestTime(interest),
        tableId: interest.tableId
      };
    });
}

function isFutureDate(value?: string) {
  if (!value) return false;
  const timestamp = value.includes('T') ? Date.parse(value) : new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(timestamp) && timestamp >= Date.now();
}

function getInterestTime(interest: ManagementInterest) {
  return interest.interestedAt ?? interest.timestamp ?? '';
}

function mergeUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getRequestingProfile(profiles: ManagementProfile[], player?: Pick<PlayerAccount, 'id' | 'name' | 'email'>) {
  if (!player) return undefined;
  return profiles.find((profile) => matchesPlayerProfile(profile, player));
}

function appendSyncNote(existing: string | undefined, note: string) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}
