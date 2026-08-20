export type TimeFeeProjectionEntry = {
  id: string;
  playerSessionId: string;
  tableId: string;
  gameId: string;
  playerName: string;
  minutes: number;
  amount: number;
  timestamp: string;
  source: 'logged' | 'legacy';
};

type TimeFeeProjectionState = {
  playerSessions: Array<{
    id: string;
    playerName: string;
    gameId: string;
    tableId: string;
    seatedAt: string;
    timePurchasedMinutes?: number;
    lastTimeTickAt?: string;
  }>;
  timeFeeLogs: Array<{
    id: string;
    playerSessionId: string;
    tableId: string;
    gameId: string;
    playerName: string;
    minutes: number;
    amount: number;
    timestamp: string;
  }>;
  settings: { defaultHourlyFee: number };
};

export const getProjectedTimeFeeEntries = (
  state: TimeFeeProjectionState
): TimeFeeProjectionEntry[] => {
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
  const legacyEntries = state.playerSessions.flatMap((playerSession): TimeFeeProjectionEntry[] => {
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
