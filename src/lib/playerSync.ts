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
  collectionMode: 'Time' | 'Drop';
  tags: string[];
  startedAt: string;
  social: PlayerTableSocialSummary;
};

export type PlayerSyncGame = {
  id: string;
  name: string;
  maxSeats: number;
  collectionMode: 'Time' | 'Drop';
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
  updatedAt?: string;
};

export type PlayerClubSnapshot = {
  club: PlayerSyncClub;
  games: PlayerSyncGame[];
  memberships: PlayerMembership[];
  waitlists: PlayerWaitlistEntry[];
  notifications: PlayerInAppNotification[];
  generatedAt: string;
};

export type PlayerMembershipRequest = {
  id: string;
  type: 'membership-request';
  clubId: string;
  player: PlayerAccount;
  plan: 'day' | 'monthly';
  paymentMethod: 'app' | 'in-person';
  priceLabel?: string;
  planId?: string;
  planName?: string;
  planPriceLabel?: string;
  membershipDurationDays?: number;
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
  phone?: string;
  birthday?: string;
  membershipStartDate?: string;
  membershipExpirationDate?: string;
  membershipExpiresAt?: string;
  membershipPlan?: 'day' | 'monthly';
  membershipPaymentMethod?: 'app' | 'in-person' | 'core';
  membershipStatus?: 'Requested' | 'Active' | 'Expired';
  membershipRequestedAt?: string;
  membershipPriceLabel?: string;
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
};

type ManagementPlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  leftAt?: string;
};

type ManagementStaffAccount = {
  id: string;
  active?: boolean;
};

type ManagementClubState = {
  games: ManagementGame[];
  sessions: ManagementSession[];
  playerSessions?: ManagementPlayerSession[];
  interests: ManagementInterest[];
  profiles: ManagementProfile[];
  inAppNotifications?: PlayerInAppNotification[];
  settings?: {
    defaultCollectionMode?: 'Time' | 'Drop';
    collectionProfiles?: Array<{ gameId: string; collectionMode: 'Time' | 'Drop' }>;
    clubAccount?: {
      clubName?: string;
      phone?: string;
      address?: string;
      email?: string;
    };
    pilotAccess?: {
      licenseId?: string;
      issuedTo?: string;
      authorizationCode?: string;
    };
    staffAccounts?: ManagementStaffAccount[];
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

const requestId = (prefix: string, seed: string, at: string) => `${prefix}_${slug(seed)}_${Date.parse(at) || Date.now()}`;
const addDays = (date: string, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
};

export function getClubIdFromState(state: ManagementClubState) {
  const account = state.settings?.clubAccount;
  const access = state.settings?.pilotAccess;
  return slug(access?.licenseId || account?.email || account?.clubName || access?.issuedTo || access?.authorizationCode || 'local-club');
}

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

export function buildPlayerClubSnapshot(
  state: ManagementClubState,
  player?: Pick<PlayerAccount, 'id' | 'name' | 'email'>
): PlayerClubSnapshot {
  const clubId = getClubIdFromState(state);
  const account = state.settings?.clubAccount;
  const activePlayerSessions = (state.playerSessions ?? []).filter((session) => !session.leftAt);
  const activeAdminCount = (state.settings?.staffAccounts ?? []).filter((staff) => staff.active !== false).length;
  const requestingProfile = getRequestingProfile(state.profiles, player);
  const knownProfileIds = new Set(requestingProfile?.commonlyPlaysWithProfileIds ?? []);
  const knownPlayerNames = new Set(
    (requestingProfile?.usualCompanions ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const isKnownPlayerSession = (session: ManagementPlayerSession) =>
    Boolean((session.profileId && knownProfileIds.has(session.profileId)) || knownPlayerNames.has(session.playerName.trim().toLowerCase()));
  const tables = state.sessions
    .filter((session) => visibleTableStatuses.includes(session.status))
    .map<PlayerSyncTable>((session) => {
      const seatedSessions = activePlayerSessions.filter((playerSession) => playerSession.tableId === session.id);
      return {
        id: session.id,
        gameId: session.gameId,
        label: session.label,
        status: session.status as PlayerSyncTable['status'],
        seatsFilled: Math.min(session.seatsFilled, session.maxSeats),
        maxSeats: session.maxSeats,
        availableSeats: Math.max(0, session.maxSeats - session.seatsFilled),
        collectionMode: session.collectionMode ?? (session.timeFeeBased ? 'Time' : 'Drop'),
        tags: session.tags ?? [],
        startedAt: session.startedAt,
        social: {
          seatedPlayerCount: seatedSessions.length || Math.min(session.seatsFilled, session.maxSeats),
          adminCount: activeAdminCount,
          knownPlayersCount: seatedSessions.filter(isKnownPlayerSession).length
        }
      };
    });
  const waitlists = state.games.flatMap((game) => getWaitlistEntriesForGame(state.interests, clubId, game.id));
  const memberships = state.profiles
    .filter((profile) => {
      if (!player) return true;
      return profile.id === player.id || profile.name.toLowerCase() === player.name.toLowerCase();
    })
    .map<PlayerMembership>((profile) => ({
      id: `${clubId}:${profile.id}`,
      clubId,
      playerId: profile.id,
      playerName: profile.name,
      status: profile.membershipStatus === 'Requested'
        ? 'Requested'
        : isFutureDate(profile.membershipExpiresAt ?? profile.membershipExpirationDate)
          ? 'Active'
          : 'Expired',
      joinedAt: profile.membershipStartDate ?? profile.membershipRequestedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      expiresAt: profile.membershipExpiresAt ?? profile.membershipExpirationDate,
      plan: profile.membershipPlan,
      paymentMethod: profile.membershipPaymentMethod,
      requestedAt: profile.membershipRequestedAt,
      loyalty: getPlayerLoyalty(clubId, profile.totalTimePlayedHours ?? 0),
      preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : profile.preferredGameId ? [profile.preferredGameId] : [],
      preferredStakes: profile.preferredStakes,
      clubNote: profile.typicalAvailability
    }));

  return {
    club: {
      id: clubId,
      name: account?.clubName || 'Local Poker Club',
      address: account?.address,
      phone: account?.phone
    },
    games: state.games.map((game) => {
      const openTables = tables.filter((table) => table.gameId === game.id);
      const gameWaitlist = waitlists.filter(
        (entry) => entry.gameId === game.id && activeWaitlistStatuses.includes(entry.status)
      );
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        collectionMode:
          state.settings?.collectionProfiles?.find((profile) => profile.gameId === game.id)?.collectionMode ??
          openTables[0]?.collectionMode ??
          state.settings?.defaultCollectionMode ??
          'Drop',
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: openTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: openTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    notifications: (state.inAppNotifications ?? []).filter((notification) => {
      if (!player) return true;
      const playerId = player.id?.trim().toLowerCase();
      const playerName = player.name?.trim().toLowerCase();
      const targetIds = (notification.targetPlayerIds ?? []).map((target) => target.trim().toLowerCase());
      const targetNames = (notification.targetPlayerNames ?? []).map((target) => target.trim().toLowerCase());
      return Boolean(playerId && targetIds.includes(playerId)) || Boolean(playerName && targetNames.includes(playerName));
    }),
    social: {
      activePlayerCount: activePlayerSessions.length || tables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.filter((entry) => activeWaitlistStatuses.includes(entry.status)).length
    },
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
  } = {}
): PlayerMembershipRequest {
  const configuredPlan = options.id
    ? {
        planId: options.id,
        planName: options.name,
        planPriceLabel: options.priceLabel,
        membershipDurationDays: Math.max(1, Number(options.durationDays) || 30)
      }
    : {};
  return {
    id: requestId('join', `${clubId}-${player.email || player.id}`, requestedAt),
    type: 'membership-request',
    clubId,
    player,
    plan: options.plan ?? (options.durationDays === 1 ? 'day' : 'monthly'),
    paymentMethod: options.paymentMethod ?? 'app',
    priceLabel: options.priceLabel,
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

export function applyMembershipRequestToClubState(
  state: ManagementClubState,
  request: PlayerMembershipRequest,
  options: { membershipDurationDays?: number } = {}
): ManagementClubState {
  const clubId = getClubIdFromState(state);
  if (request.clubId !== clubId) return state;

  const existingProfile = state.profiles.find(
    (profile) => profile.id === request.player.id || profile.name.toLowerCase() === request.player.name.toLowerCase()
  );
  const preferredGameIds = request.player.preferredGameIds ?? [];
  const activatesImmediately = request.paymentMethod !== 'in-person';
  const membershipStartDate = request.requestedAt.slice(0, 10);
  const durationDays = options.membershipDurationDays ?? request.membershipDurationDays ?? (request.plan === 'day' ? 1 : 30);
  const membershipExpiresAt = new Date(Date.parse(request.requestedAt) + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const membershipExpirationDate = membershipExpiresAt.slice(0, 10);
  const requestNote = `${request.planName ?? (request.plan === 'day' ? 'Day pass' : 'Monthly membership')} - ${request.paymentMethod === 'in-person' ? 'pay in person requested' : 'paid in app'}${request.priceLabel ? ` (${request.priceLabel})` : ''}`;

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              membershipStartDate: activatesImmediately ? membershipStartDate : profile.membershipStartDate,
              membershipExpirationDate: activatesImmediately ? membershipExpirationDate : profile.membershipExpirationDate,
              membershipExpiresAt: activatesImmediately ? membershipExpiresAt : profile.membershipExpiresAt,
              membershipPlan: request.plan,
              membershipPaymentMethod: request.paymentMethod,
              membershipStatus: activatesImmediately ? 'Active' : 'Requested',
              membershipRequestedAt: request.requestedAt,
              membershipPriceLabel: request.priceLabel,
              preferredGameId: preferredGameIds[0] ?? profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds ?? []), ...preferredGameIds]),
              preferredStakes: request.player.preferredStakes ?? profile.preferredStakes,
              typicalAvailability: request.player.typicalAvailability ?? profile.typicalAvailability,
              phone: request.player.phone ?? profile.phone,
              notes: appendSyncNote(appendSyncNote(profile.notes, `Player app: ${request.player.email}`), requestNote)
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
        id: request.player.id,
        name: request.player.name,
        phone: request.player.phone ?? '',
        birthday: '',
        membershipStartDate: activatesImmediately ? membershipStartDate : '',
        membershipExpirationDate: activatesImmediately ? membershipExpirationDate : '',
        membershipExpiresAt: activatesImmediately ? membershipExpiresAt : undefined,
        membershipPlan: request.plan,
        membershipPaymentMethod: request.paymentMethod,
        membershipStatus: activatesImmediately ? 'Active' : 'Requested',
        membershipRequestedAt: request.requestedAt,
        membershipPriceLabel: request.priceLabel,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: preferredGameIds[0] ?? state.games[0]?.id ?? '',
        preferredGameIds,
        preferredStakes: request.player.preferredStakes ?? '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: request.player.typicalAvailability ?? '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Player app: ${request.player.email}${request.player.phone ? `, ${request.player.phone}` : ''} | ${requestNote}`
      }
    ]
  };
}

export function applyPlayerProfileDocumentToClubState(
  state: ManagementClubState,
  player: PlayerProfileDocument,
  clubId = getClubIdFromState(state)
): ManagementClubState {
  const membership = player.clubMemberships?.[clubId];
  if (!membership || membership.status === 'Denied') return state;

  const existingProfile = state.profiles.find(
    (profile) => profile.id === player.uid || profile.id === player.id || profile.name.toLowerCase() === player.name.toLowerCase()
  );
  const membershipStartDate = membership.joinedAt ?? membership.requestedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const membershipExpirationDate = membership.expiresAt ?? addDays(membershipStartDate, 365);
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
              id: player.uid || profile.id,
              name: player.name || profile.name,
              membershipStartDate: profile.membershipStartDate || membershipStartDate,
              membershipExpirationDate: membership.status === 'Active' ? membershipExpirationDate : profile.membershipExpirationDate || membershipExpirationDate,
              preferredGameId: preferredGameIds[0] ?? profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds ?? []), ...preferredGameIds]),
              preferredStakes: membership.preferredStakes ?? player.preferredStakes ?? profile.preferredStakes,
              typicalAvailability: player.typicalAvailability ?? profile.typicalAvailability,
              notes: appendSyncNote(profile.notes, `Player app: ${player.email}`)
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
        name: player.name,
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: preferredGameIds[0] ?? state.games[0]?.id ?? '',
        preferredGameIds,
        preferredStakes: membership.preferredStakes ?? player.preferredStakes ?? '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability ?? '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Player app: ${player.email}${membership.status === 'Requested' ? ' | Membership requested' : ''}`
      }
    ]
  };
}

export function applyWaitlistRequestToClubState(state: ManagementClubState, request: PlayerWaitlistRequest): ManagementClubState {
  const clubId = getClubIdFromState(state);
  if (request.clubId !== clubId) return state;

  const profile = state.profiles.find(
    (candidate) => candidate.id === request.player.id || candidate.name.toLowerCase() === request.player.name.toLowerCase()
  );
  const matchesPlayer = (interest: ManagementInterest) =>
    Boolean((profile && interest.profileId === profile.id) || interest.playerName.toLowerCase() === request.player.name.toLowerCase());

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

  const requestedTable = request.tableId
    ? state.sessions.find((session) => session.id === request.tableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
    : undefined;
  const requestedTableHasSeat = Boolean(requestedTable && requestedTable.seatsFilled < requestedTable.maxSeats);
  const attendance = request.attendance ?? (requestedTableHasSeat ? 'arrived' : 'interested');
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
    name: request.player.name,
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
    notes: `Player app: ${request.player.email}${request.player.phone ? `, ${request.player.phone}` : ''}`
  };

  const profiles = profile
    ? state.profiles.map((candidate) =>
        candidate.id === profile.id
          ? {
              ...candidate,
              phone: request.player.phone || candidate.phone,
              preferredGameId: candidate.preferredGameId || request.gameId,
              preferredGameIds: mergeUnique([...(candidate.preferredGameIds ?? []), request.gameId]),
              notes: appendSyncNote(candidate.notes, `Player app: ${request.player.email}`)
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
        playerName: request.player.name,
        gameId: request.gameId,
        status,
        timestamp: request.requestedAt,
        interestedAt: request.requestedAt,
        confirmedAt: status === 'Confirmed Coming' ? request.requestedAt : undefined,
        arrivedAt: status === 'Arrived' ? request.requestedAt : undefined,
        expectedArrivalTime: request.expectedArrivalTime,
        availabilityStartTime: request.availabilityStartTime,
        availabilityEndTime: request.availabilityEndTime,
        tableId: request.tableId,
        notes: [
          status === 'Arrived'
            ? `At club now - seat requested for ${requestedTable?.label ?? 'open table'}`
            : status === 'Confirmed Coming'
              ? `Confirmed coming${request.expectedArrivalTime ? ` at ${request.expectedArrivalTime}` : ''}${requestedTable ? ` for ${requestedTable.label}` : ''}`
              : `Interested${request.availabilityStartTime ? ` from ${request.availabilityStartTime}` : ''}${request.availabilityEndTime ? ` to ${request.availabilityEndTime}` : ''}`,
          request.note
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
  const playerName = player.name.trim().toLowerCase();
  return profiles.find((profile) => profile.id === player.id || profile.name.trim().toLowerCase() === playerName);
}

function appendSyncNote(existing: string | undefined, note: string) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}
