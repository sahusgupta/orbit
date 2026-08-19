import type {
  AppState,
  CollectionProfile,
  GameSession,
  GameStatus,
  PlayerSession,
  ReportPeriod,
  RevenueTransaction,
  TimeFeeLog
} from './types';

const toLocalDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export type ReportWindow = { startMs: number; endMs: number; label: string };

const parseLocalDateValue = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, Math.max(0, month - 1), day || 1, 12, 0, 0, 0);
};

export const getReportWindow = (period: ReportPeriod, anchorValue: string): ReportWindow => {
  const anchor = parseLocalDateValue(anchorValue);
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (period === 'all') {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    return { startMs: 0, endMs: tomorrow.getTime(), label: 'All recorded history' };
  }

  if (period === 'week') {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - mondayOffset);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else if (period === 'month') {
    start.setDate(1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 1);
  } else if (period === 'year') {
    start.setMonth(0, 1);
    end.setTime(start.getTime());
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setDate(end.getDate() + 1);
  }

  const inclusiveEnd = new Date(end.getTime() - 1);
  const shortDate = (date: Date, includeYear = true) => date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {})
  });
  const label = period === 'day'
    ? shortDate(start)
    : period === 'month'
      ? start.toLocaleDateString([], { month: 'long', year: 'numeric' })
      : period === 'year'
        ? String(start.getFullYear())
        : `${shortDate(start, start.getFullYear() !== inclusiveEnd.getFullYear())} – ${shortDate(inclusiveEnd)}`;
  return { startMs: start.getTime(), endMs: end.getTime(), label };
};

export const shiftReportAnchor = (anchorValue: string, period: ReportPeriod, direction: -1 | 1) => {
  if (period === 'all') return anchorValue;
  const date = parseLocalDateValue(anchorValue);
  if (period === 'day') date.setDate(date.getDate() + direction);
  if (period === 'week') date.setDate(date.getDate() + direction * 7);
  if (period === 'month') date.setMonth(date.getMonth() + direction);
  if (period === 'year') date.setFullYear(date.getFullYear() + direction);
  return toLocalDateValue(date);
};

export const timestampInReportWindow = (timestamp: string | undefined, window: ReportWindow) => {
  if (!timestamp) return false;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value >= window.startMs && value < window.endMs;
};

export const getReportState = (state: AppState, window: ReportWindow): AppState => {
  const now = Date.now();
  const sessions = state.sessions
    .filter((session) => {
      const start = new Date(session.startedAt).getTime();
      const end = session.endedAt ? new Date(session.endedAt).getTime() : now;
      return start < window.endMs && end >= window.startMs;
    })
    .map((session) => {
      const continuesThroughCurrentWindow = !session.endedAt && window.endMs > now;
      const effectiveEnd = Math.min(session.endedAt ? new Date(session.endedAt).getTime() : now, window.endMs - 1);
      return {
        ...session,
        startedAt: new Date(Math.max(new Date(session.startedAt).getTime(), window.startMs)).toISOString(),
        endedAt: continuesThroughCurrentWindow ? undefined : new Date(effectiveEnd).toISOString(),
        status: (continuesThroughCurrentWindow || session.status === 'Failed to Start') ? session.status : 'Closed' as GameStatus
      };
    });
  const playerSessions = state.playerSessions
    .filter((session) => {
      const start = new Date(session.seatedAt).getTime();
      const end = session.leftAt ? new Date(session.leftAt).getTime() : now;
      return start < window.endMs && end >= window.startMs;
    })
    .map((session) => {
      const continuesThroughCurrentWindow = !session.leftAt && window.endMs > now;
      const effectiveEnd = Math.min(session.leftAt ? new Date(session.leftAt).getTime() : now, window.endMs - 1);
      return {
        ...session,
        seatedAt: new Date(Math.max(new Date(session.seatedAt).getTime(), window.startMs)).toISOString(),
        leftAt: continuesThroughCurrentWindow ? undefined : new Date(effectiveEnd).toISOString()
      };
    });
  return {
    ...state,
    sessions,
    playerSessions,
    interests: state.interests.filter((interest) =>
      [interest.interestedAt, interest.arrivedAt, interest.seatedAt, interest.closedAt].some((timestamp) => timestampInReportWindow(timestamp, window))
    ),
    dropLogs: state.dropLogs.filter((entry) => timestampInReportWindow(entry.timestamp, window)),
    dealerAssignments: state.dealerAssignments.filter((assignment) => {
      const start = new Date(assignment.startedAt).getTime();
      const end = assignment.endedAt ? new Date(assignment.endedAt).getTime() : now;
      return start < window.endMs && end >= window.startMs;
    }),
    handCountLogs: state.handCountLogs.filter((entry) => timestampInReportWindow(entry.timestamp, window)),
    timeFeeLogs: state.timeFeeLogs.filter((entry) => timestampInReportWindow(entry.timestamp, window)),
    revenueTransactions: state.revenueTransactions.filter((entry) => timestampInReportWindow(entry.occurredAt, window)),
    tableEvents: state.tableEvents.filter((entry) => timestampInReportWindow(entry.timestamp, window)),
    history: state.history.filter((night) => timestampInReportWindow(`${night.date}T12:00:00`, window))
  };
};

export function getCollectionProfile(state: AppState, gameId: string): CollectionProfile {
  const configuredProfile = state.settings.collectionProfiles.find((profile) => profile.gameId === gameId);
  return {
    ...configuredProfile,
    gameId,
    collectionMode: configuredProfile?.collectionMode ?? state.settings.defaultCollectionMode,
    hourlyFee: state.settings.defaultHourlyFee,
    estimatedDropPerSeatHour:
      configuredProfile?.estimatedDropPerSeatHour ?? state.settings.defaultEstimatedDropPerSeatHour
  };
}

export type ProjectedTimeFeeEntry = TimeFeeLog & {
  source: 'logged' | 'legacy';
};

type TimeFeeProjectionState = {
  playerSessions: PlayerSession[];
  timeFeeLogs: TimeFeeLog[];
  settings: { defaultHourlyFee: number };
};

export const getProjectedTimeFeeEntries = (
  state: TimeFeeProjectionState
): ProjectedTimeFeeEntry[] => {
  const loggedEntries = state.timeFeeLogs.map((entry) => ({
    ...entry,
    source: 'logged' as const
  }));
  const loggedMinutesByPlayerSession = state.timeFeeLogs.reduce<Map<string, number>>(
    (minutesBySession, entry) => {
      minutesBySession.set(
        entry.playerSessionId,
        (minutesBySession.get(entry.playerSessionId) ?? 0) + Math.max(0, Number(entry.minutes) || 0)
      );
      return minutesBySession;
    },
    new Map()
  );
  const playerSessionsWithLogs = new Set(state.timeFeeLogs.map((entry) => entry.playerSessionId));
  const legacyEntries = state.playerSessions.flatMap((playerSession): ProjectedTimeFeeEntry[] => {
    const purchasedMinutes = Math.max(0, Number(playerSession.timePurchasedMinutes) || 0);
    const unloggedMinutes = Math.max(
      0,
      purchasedMinutes - (loggedMinutesByPlayerSession.get(playerSession.id) ?? 0)
    );
    if (!unloggedMinutes) return [];
    return [{
      id: `legacy-time-${playerSession.id}`,
      playerSessionId: playerSession.id,
      tableId: playerSession.tableId,
      gameId: playerSession.gameId,
      playerName: playerSession.playerName,
      minutes: unloggedMinutes,
      amount: (unloggedMinutes / 60) * state.settings.defaultHourlyFee,
      timestamp: playerSessionsWithLogs.has(playerSession.id)
        ? playerSession.seatedAt
        : playerSession.lastTimeTickAt || playerSession.seatedAt,
      source: 'legacy'
    }];
  });

  return [...loggedEntries, ...legacyEntries];
};

export const getReportFinancials = (state: AppState, window: ReportWindow) => {
  const recordedDrop = state.dropLogs
    .filter((entry) => timestampInReportWindow(entry.timestamp, window))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const timeFeeEntries = getProjectedTimeFeeEntries(state)
    .filter((entry) => {
      const table = state.sessions.find((session) => session.id === entry.tableId);
      return table &&
        (table.collectionMode === 'Time' || table.timeFeeBased) &&
        timestampInReportWindow(entry.timestamp, window);
    })
    .map((entry) => ({
      gameId: entry.gameId,
      tableId: entry.tableId,
      amount: entry.amount,
      timestamp: entry.timestamp
    }));
  const timeFees = timeFeeEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const paidRevenue = state.revenueTransactions.filter((entry) =>
    (entry.paymentStatus === 'paid' || entry.paymentStatus === 'partially_refunded') && timestampInReportWindow(entry.occurredAt, window)
  );
  const revenueAmount = (entry: RevenueTransaction) => (entry.type === 'refund' ? -Math.abs(entry.amountCents) : entry.amountCents) / 100;
  const membershipRevenue = paidRevenue.filter((entry) => entry.type === 'membership').reduce((sum, entry) => sum + revenueAmount(entry), 0);
  const tournamentRevenue = paidRevenue.filter((entry) => ['tournament_entry', 'rebuy', 'add_on'].includes(entry.type)).reduce((sum, entry) => sum + revenueAmount(entry), 0);
  const otherRevenue = paidRevenue.filter((entry) => !['membership', 'tournament_entry', 'rebuy', 'add_on'].includes(entry.type)).reduce((sum, entry) => sum + revenueAmount(entry), 0);
  const collectionByGame = state.games.map((game) => ({
    game: game.name,
    recordedDrop: state.dropLogs
      .filter((entry) => entry.gameId === game.id && timestampInReportWindow(entry.timestamp, window))
      .reduce((sum, entry) => sum + entry.amount, 0),
    timeFees: timeFeeEntries
      .filter((entry) => entry.gameId === game.id)
      .reduce((sum, entry) => sum + entry.amount, 0)
  }));
  return {
    recordedDrop,
    timeFees,
    membershipRevenue,
    tournamentRevenue,
    otherRevenue,
    totalProfit: recordedDrop + timeFees + membershipRevenue + tournamentRevenue + otherRevenue,
    collectionByGame,
    timeFeeEntries,
    paidRevenue
  };
};

export const getTableFinancialOverview = (state: AppState, session: GameSession) => {
  const totalBuyIns = state.buyIns
    .filter((entry) => entry.tableId === session.id)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalCashOuts = state.playerLedger
    .filter((entry) => entry.tableId === session.id && entry.type === 'Cash-Out')
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const totalDrop = state.dropLogs
    .filter((entry) => entry.tableId === session.id)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalTimeFees = session.collectionMode === 'Time' || session.timeFeeBased
    ? getProjectedTimeFeeEntries(state)
        .filter((entry) => entry.tableId === session.id)
        .reduce((sum, entry) => sum + entry.amount, 0)
    : 0;
  const tableProfit = totalDrop + totalTimeFees;

  return {
    totalBuyIns,
    totalCashOuts,
    totalDrop,
    totalTimeFees,
    tableProfit,
    cashInPlay: totalBuyIns - totalCashOuts - totalDrop
  };
};

export const getTablePlayerFinancialOverview = (state: AppState, session: GameSession, playerSession: PlayerSession) => {
  const normalizedPlayerName = playerSession.playerName.trim().toLowerCase();
  const belongsToPlayer = (profileId: string | undefined, playerName: string) =>
    playerSession.profileId && profileId
      ? playerSession.profileId === profileId
      : playerName.trim().toLowerCase() === normalizedPlayerName;
  const totalBuyIns = state.buyIns
    .filter((entry) => entry.tableId === session.id && belongsToPlayer(entry.profileId, entry.playerName))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalCashOuts = state.playerLedger
    .filter((entry) =>
      entry.tableId === session.id &&
      entry.type === 'Cash-Out' &&
      belongsToPlayer(entry.profileId, entry.playerName)
    )
    .reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const totalTimeFees = session.collectionMode === 'Time' || session.timeFeeBased
    ? getProjectedTimeFeeEntries(state)
        .filter((entry) => entry.playerSessionId === playerSession.id)
        .reduce((sum, entry) => sum + entry.amount, 0)
    : 0;

  return {
    totalBuyIns,
    totalCashOuts,
    totalTimeFees
  };
};

export const getReportHourlyBreakdown = (state: AppState, window: ReportWindow, financials: ReturnType<typeof getReportFinancials>) => {
  const buckets = new Map<number, { startMs: number; drop: number; timeFees: number; otherRevenue: number }>();
  const add = (timestamp: string, amount: number, kind: 'drop' | 'timeFees' | 'otherRevenue') => {
    const date = new Date(timestamp);
    date.setMinutes(0, 0, 0);
    const startMs = date.getTime();
    const bucket = buckets.get(startMs) ?? { startMs, drop: 0, timeFees: 0, otherRevenue: 0 };
    bucket[kind] += amount;
    buckets.set(startMs, bucket);
  };
  state.dropLogs
    .filter((entry) => timestampInReportWindow(entry.timestamp, window))
    .forEach((entry) => add(entry.timestamp, entry.amount, 'drop'));
  financials.timeFeeEntries.forEach((entry) => add(entry.timestamp, entry.amount, 'timeFees'));
  financials.paidRevenue.forEach((entry) => add(entry.occurredAt, (entry.type === 'refund' ? -Math.abs(entry.amountCents) : entry.amountCents) / 100, 'otherRevenue'));
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, total: bucket.drop + bucket.timeFees + bucket.otherRevenue }))
    .sort((left, right) => left.startMs - right.startMs);
};

export const getDealerReport = (state: AppState, window: ReportWindow) => {
  const now = Date.now();
  const assignments = state.dealerAssignments.filter((assignment) => {
    const start = new Date(assignment.startedAt).getTime();
    const end = assignment.endedAt ? new Date(assignment.endedAt).getTime() : now;
    return start < window.endMs && end >= window.startMs;
  });
  const dealerMap = new Map<string, { dealerName: string; milliseconds: number; tableIds: Set<string>; hands: number }>();
  assignments.forEach((assignment) => {
    const start = Math.max(new Date(assignment.startedAt).getTime(), window.startMs);
    const end = Math.min(assignment.endedAt ? new Date(assignment.endedAt).getTime() : now, window.endMs);
    const entry = dealerMap.get(assignment.dealerName) ?? { dealerName: assignment.dealerName, milliseconds: 0, tableIds: new Set<string>(), hands: 0 };
    entry.milliseconds += Math.max(0, end - start);
    entry.tableIds.add(assignment.tableId);
    entry.hands += state.handCountLogs
      .filter((log) => log.tableId === assignment.tableId && timestampInReportWindow(log.timestamp, window))
      .filter((log) => {
        const timestamp = new Date(log.timestamp).getTime();
        return timestamp >= new Date(assignment.startedAt).getTime() && timestamp < (assignment.endedAt ? new Date(assignment.endedAt).getTime() : now);
      })
      .reduce((sum, log) => sum + log.hands, 0);
    dealerMap.set(assignment.dealerName, entry);
  });
  return [...dealerMap.values()]
    .map((entry) => ({
      dealerName: entry.dealerName,
      hours: entry.milliseconds / 36e5,
      tables: entry.tableIds.size,
      hands: entry.hands,
      handsPerHour: entry.milliseconds > 0 ? entry.hands / (entry.milliseconds / 36e5) : 0
    }))
    .sort((left, right) => right.hours - left.hours);
};
