import { resolveGameId } from '../lib/appCore';
import { normalizePlayerSessionSeats } from '../lib/seatNormalization';
import type {
  AppState,
  CollectionProfile,
  InterestStatus,
  PersistedAppState,
  PlayerProfile,
  TableCap,
  Tournament,
  TournamentLevel,
  TournamentPayout
} from './types';

export const defaultScriptTemplates = [
  'Current {game} has {inRoom} in the room, {coming} coming, and {waiting} waiting or interested.',
  'Current {game} is full, but overflow is building with {waiting} waiting or interested.',
  "We're building {game}, but need {needs} more player(s) before it is realistic.",
  '{game} is close to forming if arrivals hold. We can add you to the interest list.'
];

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export const todayDate = () => new Date().toISOString().slice(0, 10);
export const nextYearDate = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
};

export const defaultTournamentLevels = (): TournamentLevel[] => [
  { id: uid(), level: 1, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 2, smallBlind: 200, bigBlind: 400, ante: 400, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 3, smallBlind: 300, bigBlind: 600, ante: 600, durationMinutes: 20, breakAfter: true, breakMinutes: 10 },
  { id: uid(), level: 4, smallBlind: 500, bigBlind: 1000, ante: 1000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 5, smallBlind: 1000, bigBlind: 2000, ante: 2000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 6, smallBlind: 1500, bigBlind: 3000, ante: 3000, durationMinutes: 20, breakAfter: true, breakMinutes: 10 },
  { id: uid(), level: 7, smallBlind: 2000, bigBlind: 4000, ante: 4000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 },
  { id: uid(), level: 8, smallBlind: 3000, bigBlind: 6000, ante: 6000, durationMinutes: 20, breakAfter: false, breakMinutes: 0 }
];

export const defaultTournamentPayouts = (): TournamentPayout[] => [
  { place: 1, percent: 50 },
  { place: 2, percent: 30 },
  { place: 3, percent: 20 }
];

export const normalizeTableCap = (value?: number): TableCap => {
  if (value === 6 || value === 8 || value === 10) return value;
  if (!value || value <= 6) return 6;
  if (value <= 8) return 8;
  return 10;
};

const legacyStatusMap: Record<string, InterestStatus> = {
  'In Room': 'Arrived',
  Waiting: 'Interested',
  'Interested / Maybe': 'Interested',
  Coming: 'Confirmed Coming'
};

const orbitLaunchTournament = (): Tournament => ({
  id: 'orbit-launch-championship-2026',
  name: 'Orbit Launch Championship',
  status: 'Draft',
  createdAt: nowIso(),
  currentLevelIndex: 0,
  buyIn: 0,
  startingStack: 25000,
  rebuyPrizePercent: 100,
  rebuyPrice: 20,
  addOnPrice: 10,
  lateRegistrationThroughLevel: 8,
  registrationClosesAt: '2026-08-01T20:00:00-05:00',
  tableSize: 9,
  levels: defaultTournamentLevels().map((level) => ({ ...level, durationMinutes: 15 })),
  players: [],
  payouts: defaultTournamentPayouts()
});

export const seedState: AppState = {
  games: [],
  physicalTables: [],
  profiles: [],
  tournaments: [orbitLaunchTournament()],
  interests: [],
  sessions: [],
  playerSessions: [],
  buyIns: [],
  dropLogs: [],
  dealerAssignments: [],
  handCountLogs: [],
  timeFeeLogs: [],
  revenueTransactions: [],
  playerLedger: [],
  tableEvents: [],
  inAppNotifications: [],
  staffRequests: [],
  history: [],
  nightCloses: [],
  feedback: [],
  scriptTemplates: defaultScriptTemplates,
  correctionLog: [],
  usageEvents: [],
  settings: {
    lowLight: false,
    defaultCollectionMode: 'Drop',
    defaultTableCap: 10,
    defaultHourlyFee: 0,
    defaultEstimatedDropPerSeatHour: 0,
    collectionProfiles: [],
    membershipPlans: [],
    showPlayerGrid: true,
    showDashboardKpis: false,
    showRecentPlayers: true,
    pilotAccess: undefined,
    clubAccount: undefined,
    staffAccounts: [],
    activeStaffId: undefined
  }
};

export function normalizeState(parsed: PersistedAppState): AppState {
  const defaultTableCap = normalizeTableCap(parsed.settings?.defaultTableCap);
  const legacyDefaultCollectionMode = parsed.settings?.defaultRakeMode;
  const configuredCollectionProfiles =
    parsed.settings?.collectionProfiles ??
    ((parsed.settings as Record<string, CollectionProfile[]> | undefined)?.[`ra${'ke'}Profiles`] ?? []);
  const legacyTimeProfile = configuredCollectionProfiles.find((profile) => {
    const legacyMode = (profile as Record<string, unknown>)[`ra${'ke'}Mode`];
    return profile.collectionMode === 'Time' || legacyMode === 'Time';
  });
  const defaultHourlyFee =
    parsed.settings?.defaultHourlyFee ??
    legacyTimeProfile?.hourlyFee ??
    configuredCollectionProfiles[0]?.hourlyFee ??
    0;
  const games = (parsed.games ?? seedState.games).map((game) =>
    ({ ...game, maxSeats: normalizeTableCap(game.maxSeats ?? defaultTableCap) })
  );
  const physicalTables = (parsed.physicalTables ?? []).map((table) => ({
    ...table,
    label: table.label.trim() || 'Table',
    maxSeats: normalizeTableCap(table.maxSeats),
    createdAt: table.createdAt || nowIso()
  }));
  const sessions = (parsed.sessions ?? []).map((session) => {
    const legacySession = session as Record<string, unknown>;
    const legacyMode = legacySession[`ra${'ke'}Mode`];
    const legacyTimeFlag = legacySession[`time${'Ra'}ked`];
    const collectionMode =
      session.collectionMode ??
      (legacyMode === 'Time' || legacyMode === 'Drop' ? legacyMode : undefined) ??
      (session.timeFeeBased || legacyTimeFlag ? 'Time' : 'Drop');
    const gameId = resolveGameId(games, session.gameId, session.gameId);
    const game = games.find((item) => item.id === gameId);
    const gameSessionCap = normalizeTableCap(game?.maxSeats ?? session.maxSeats ?? defaultTableCap);
    const physicalTable = physicalTables.find((table) => table.id === session.physicalTableId);
    return {
      ...session,
      gameId,
      maxSeats: normalizeTableCap(Math.min(gameSessionCap, physicalTable?.maxSeats ?? gameSessionCap)),
      collectionMode,
      timeFeeBased: collectionMode === 'Time',
      manualEdits: session.manualEdits ?? {}
    };
  });
  const fallbackGameId = games[0]?.id ?? 'nlh-1-2';
  const normalizeGameIds = (values?: Array<string | undefined>, fallback = fallbackGameId) => {
    const resolved = (values ?? [])
      .map((value) => resolveGameId(games, value, ''))
      .filter(Boolean);
    return resolved.length ? Array.from(new Set(resolved)) : [fallback];
  };
  const profiles: PlayerProfile[] =
    parsed.profiles ??
    (parsed.interests ?? []).map((interest) => ({
      id: uid(),
      name: interest.playerName,
      phone: '',
      address: '',
      birthday: '',
      membershipStartDate: todayDate(),
      membershipExpirationDate: nextYearDate(),
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: interest.gameId,
      preferredGameIds: [interest.gameId],
      gamePlayCounts: {},
      mostPlayedGameId: interest.gameId,
      preferredStakes: '',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      willingnessToMove: false,
      typicalAvailability: '',
      preferredTags: [],
      usualCompanions: [],
      notes: ''
    }));
  const interests = (parsed.interests ?? []).map((interest) => {
    const status = legacyStatusMap[interest.status] ?? (interest.status as InterestStatus);
    return {
      ...interest,
      status,
      interestedAt: interest.interestedAt ?? interest.timestamp ?? nowIso(),
      confirmedAt: interest.confirmedAt ?? (status === 'Confirmed Coming' ? interest.timestamp : undefined),
      arrivedAt: interest.arrivedAt ?? (status === 'Arrived' ? interest.timestamp : undefined),
      seatedAt: interest.seatedAt ?? (status === 'Seated' ? interest.timestamp : undefined),
      closedAt:
        interest.closedAt ??
        (['Declined', 'No-Show', 'Left Before Seated', 'Removed'].includes(status) ? interest.timestamp : undefined),
      manualEdits: interest.manualEdits ?? {}
    };
  });

  const getNormalizedGameCounts = (counts?: Record<string, number>) =>
    Object.entries(counts ?? {}).reduce<Record<string, number>>((record, [gameId, count]) => {
      const resolvedGameId = resolveGameId(games, gameId, '');
      const normalizedCount = Number(count);
      if (resolvedGameId && Number.isFinite(normalizedCount) && normalizedCount > 0) {
        record[resolvedGameId] = (record[resolvedGameId] ?? 0) + normalizedCount;
      }
      return record;
    }, {});
  const getMostPlayedGameIdFromCounts = (counts: Record<string, number>, fallback: string) => {
    const [topGameId] =
      Object.entries(counts)
        .filter(([, count]) => count > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [];
    return topGameId ?? fallback;
  };

  return {
    games,
    physicalTables,
    profiles: profiles.map((profile) => {
      const preferredGameIds = normalizeGameIds([profile.preferredGameId, ...(profile.preferredGameIds ?? []), profile.preferredStakes]);
      const gamePlayCounts = getNormalizedGameCounts(profile.gamePlayCounts);
      return {
        ...profile,
        phone: profile.phone ?? '',
        address: profile.address ?? '',
        birthday: profile.birthday ?? '',
        identityReviewStatus:
          profile.identityReviewStatus ??
          (profile.identityCaptureMethod === 'player-camera-pdf417' || profile.identityCaptureMethod === 'id-image-pdf417' || profile.identityCaptureMethod === 'id-image-ocr'
            ? 'Pending'
            : profile.identityCaptureMethod === 'id-barcode'
              ? 'Approved'
              : 'Not required'),
        membershipPaymentStatus:
          profile.membershipPaymentStatus ??
          (profile.membershipStatus === 'Active'
            ? 'Paid'
            : profile.membershipPaymentMethod === 'in-person' &&
                (profile.membershipStatus === 'Requested' || profile.membershipStatus === 'Approved')
              ? 'Pending'
              : 'Not required'),
        membershipStartDate: profile.membershipStartDate ?? todayDate(),
        membershipExpirationDate: profile.membershipExpirationDate ?? nextYearDate(),
        savedTimeCreditMinutes: Math.max(0, Number(profile.savedTimeCreditMinutes) || 0),
        totalTimePlayedHours: profile.totalTimePlayedHours ?? 0,
        lastSessionTimePlayedHours: profile.lastSessionTimePlayedHours ?? 0,
        commonlyPlaysWithProfileIds:
          profile.commonlyPlaysWithProfileIds ??
          (profile.usualCompanions ?? [])
            .map((name) => profiles.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.id)
            .filter((id): id is string => Boolean(id)),
        preferredGameId: preferredGameIds[0],
        preferredGameIds,
        gamePlayCounts,
        mostPlayedGameId: resolveGameId(
          games,
          profile.mostPlayedGameId,
          getMostPlayedGameIdFromCounts(gamePlayCounts, preferredGameIds[0])
        ),
        willingnessToMove: profile.willingnessToMove ?? false,
        typicalAvailability: profile.typicalAvailability ?? '',
        preferredTags: profile.preferredTags ?? []
      };
    }),
    tournaments: ([...(parsed.tournaments ?? []), ...((parsed.tournaments ?? []).some((tournament) => tournament.id === 'orbit-launch-championship-2026') ? [] : [orbitLaunchTournament()])]).map((tournament) => ({
      ...tournament,
      status: tournament.status ?? 'Draft',
      currentLevelIndex: tournament.currentLevelIndex ?? 0,
      buyIn: tournament.buyIn ?? 0,
      startingStack: tournament.startingStack ?? 10000,
      rebuyPrizePercent: Number(tournament.rebuyPrizePercent ?? 100),
      tableSize: Number(tournament.tableSize ?? 9),
      levels: (tournament.levels ?? []).map((level, index) => ({
        ...level,
        id: level.id ?? uid(),
        level: level.level ?? index + 1,
        smallBlind: Number(level.smallBlind ?? 0),
        bigBlind: Number(level.bigBlind ?? 0),
        ante: Number(level.ante ?? 0),
        durationMinutes: Number(level.durationMinutes ?? 20),
        breakAfter: Boolean(level.breakAfter),
        breakMinutes: Number(level.breakMinutes ?? 0)
      })),
      players: (tournament.players ?? []).map((player) => ({
        ...player,
        id: player.id ?? uid(),
        buyIn: Number(player.buyIn ?? tournament.buyIn ?? 0),
        rebuys: Number(player.rebuys ?? 0),
        addOns: Number(player.addOns ?? 0),
        startingStack: Number(player.startingStack ?? tournament.startingStack ?? 10000),
        status: player.status ?? 'Registered',
        registeredAt: player.registeredAt ?? nowIso()
      })),
      payouts: (tournament.payouts ?? []).map((payout, index) => ({
        place: Number(payout.place ?? index + 1),
        percent: Number(payout.percent ?? 0)
      }))
    })),
    interests: interests.map((interest) => ({
      ...interest,
      gameId: resolveGameId(games, interest.gameId, fallbackGameId)
    })),
    sessions,
    playerSessions: normalizePlayerSessionSeats(parsed.playerSessions ?? [], (session) => {
      const gameId = resolveGameId(games, session.gameId, fallbackGameId);
      const table = sessions.find((item) => item.id === session.tableId);
      return normalizeTableCap(table?.maxSeats ?? games.find((game) => game.id === gameId)?.maxSeats ?? defaultTableCap);
    }).map((session) => {
      const gameId = resolveGameId(games, session.gameId, fallbackGameId);
      return {
        ...session,
        gameId,
        timePurchasedMinutes: session.timePurchasedMinutes ?? 0,
        timeCreditAppliedMinutes: Math.max(0, Number(session.timeCreditAppliedMinutes) || 0),
        timeRemainingMinutes: session.timeRemainingMinutes ?? 0,
        lastTimeTickAt: session.lastTimeTickAt ?? session.seatedAt,
        timeFeeEnabled: session.timeFeeEnabled ?? Boolean((session as Record<string, unknown>)[`time${'Ra'}keEnabled`]),
        manualEdits: session.manualEdits ?? {}
      };
    }),
    buyIns: parsed.buyIns ?? [],
    dropLogs: parsed.dropLogs ?? [],
    dealerAssignments: parsed.dealerAssignments ?? [],
    handCountLogs: parsed.handCountLogs ?? [],
    timeFeeLogs: parsed.timeFeeLogs ?? [],
    revenueTransactions: parsed.revenueTransactions ?? [],
    playerLedger: parsed.playerLedger ?? [
      ...(parsed.playerSessions ?? []).map((session) => ({
        id: uid(),
        type: 'Check-In' as const,
        profileId: session.profileId,
        playerName: session.playerName,
        tableId: session.tableId,
        gameId: session.gameId,
        timestamp: session.seatedAt,
        note: 'Imported from seated player history'
      })),
      ...(parsed.buyIns ?? []).map((buyIn) => ({
        id: uid(),
        type: 'Buy-In' as const,
        profileId: buyIn.profileId,
        playerName: buyIn.playerName,
        tableId: buyIn.tableId,
        gameId: buyIn.gameId,
        amount: buyIn.amount,
        timestamp: buyIn.timestamp,
        note: buyIn.note
      })),
      ...(parsed.playerSessions ?? [])
        .filter((session) => session.leftAt)
        .map((session) => ({
          id: uid(),
          type: 'Cash-Out' as const,
          profileId: session.profileId,
          playerName: session.playerName,
          tableId: session.tableId,
          gameId: session.gameId,
          timestamp: session.leftAt!,
          note: 'Imported from player leave history'
        }))
    ],
    tableEvents: (parsed.tableEvents ?? []).map((event) => ({ ...event, reason: event.reason ?? '' })),
    inAppNotifications: (parsed.inAppNotifications ?? []).map((notification) => ({
      ...notification,
      targetPlayerIds: notification.targetPlayerIds ?? [],
      targetPlayerNames: notification.targetPlayerNames ?? []
    })),
    staffRequests: (parsed.staffRequests ?? [])
      .filter(
        (request) =>
          request.type === 'self-check-in-assistance' &&
          typeof request.id === 'string' &&
          typeof request.playerName === 'string' &&
          (request.reason === 'not-found' || request.reason === 'ambiguous') &&
          typeof request.createdAt === 'string'
      )
      .map((request) => ({
        ...request,
        status: request.status === 'handled' ? ('handled' as const) : ('pending' as const),
        handledAt: request.status === 'handled' ? request.handledAt : undefined,
        handledByStaffId: request.status === 'handled' ? request.handledByStaffId : undefined
      }))
      .slice(-200),
    selfCheckIn:
      typeof parsed.selfCheckIn?.capabilityGeneration === 'string' &&
      typeof parsed.selfCheckIn?.generatedAt === 'string'
        ? {
            capabilityGeneration: parsed.selfCheckIn.capabilityGeneration,
            generatedAt: parsed.selfCheckIn.generatedAt
          }
        : undefined,
    history: parsed.history ?? [],
    nightCloses: parsed.nightCloses ?? [],
    feedback: parsed.feedback ?? [],
    scriptTemplates: parsed.scriptTemplates ?? defaultScriptTemplates,
    correctionLog: parsed.correctionLog ?? [],
    usageEvents: parsed.usageEvents ?? [],
    settings: {
      lowLight: parsed.settings?.lowLight ?? false,
      defaultCollectionMode:
        parsed.settings?.defaultCollectionMode ??
        (legacyDefaultCollectionMode === 'Time' || legacyDefaultCollectionMode === 'Drop'
          ? legacyDefaultCollectionMode
          : 'Drop'),
      defaultTableCap,
      defaultHourlyFee,
      defaultEstimatedDropPerSeatHour: parsed.settings?.defaultEstimatedDropPerSeatHour ?? 0,
      collectionProfiles: configuredCollectionProfiles.map((profile) => {
        const legacyProfile = profile as Record<string, unknown>;
        const legacyMode = legacyProfile[`ra${'ke'}Mode`];
        return {
          ...profile,
          collectionMode: profile.collectionMode ?? (legacyMode === 'Time' || legacyMode === 'Drop' ? legacyMode : 'Drop'),
          hourlyFee: defaultHourlyFee
        };
      }),
      membershipPlans: (parsed.settings?.membershipPlans ?? []).map((plan) => ({
        ...plan,
        durationDays: Number.isInteger(Number(plan.durationDays)) && Number(plan.durationDays) >= 1
          ? Number(plan.durationDays)
          : 0,
        active: plan.active === true
      })),
      showPlayerGrid: parsed.settings?.showPlayerGrid ?? true,
      showDashboardKpis: parsed.settings?.showDashboardKpis ?? false,
      showRecentPlayers: parsed.settings?.showRecentPlayers ?? true,
      pilotAccess: parsed.settings?.pilotAccess,
      clubAccount: parsed.settings?.clubAccount
        ? {
            ...parsed.settings.clubAccount,
            minimumPlayerAge: parsed.settings.clubAccount.minimumPlayerAge === 18 ? 18 : 21
          }
        : undefined,
      staffAccounts: parsed.settings?.staffAccounts ?? [],
      // A staff PIN session is memory-only, so a persisted operator must be
      // selected and verified again after every state hydration.
      activeStaffId: undefined,
      accountLogin: parsed.settings?.accountLogin
        ? {
            ...parsed.settings.accountLogin,
            username: /^\S+@\S+\.\S+$/.test(parsed.settings.accountLogin.username)
              ? parsed.settings.accountLogin.username.toLowerCase()
              : parsed.settings.clubAccount?.email?.trim().toLowerCase() || parsed.settings.accountLogin.username
          }
        : undefined
    }
  };
}

export function parsePersistedAppState(serialized: string): PersistedAppState | null {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return decodePersistedAppState(parsed);
  } catch {
    return null;
  }
}

export function decodePersistedAppState(value: unknown): PersistedAppState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const settings: unknown = Reflect.get(value, 'settings');
  if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) {
    return null;
  }
  return value as PersistedAppState;
}
