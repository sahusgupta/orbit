import type {
  AppState,
  GameSession,
  GameStatus,
  InterestStatus,
  PlayerSession
} from '../../domain/types';
import { getCollectionProfile } from '../../domain/reporting';

export type SeatingCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
};

export type SeatPlayerPayload = {
  playerName?: string;
  profileId?: string;
  interestId?: string;
  requestedSeatNumber?: number;
  initialTimeMinutes?: number;
  initialBuyIn?: number;
  note?: string;
};

export type SeatPlayerResult =
  | {
      ok: true;
      state: AppState;
      seatNumber: number;
      playerName: string;
      profileId?: string;
      tableId: string;
      gameId: string;
    }
  | { ok: false; error: string };

export type MovePlayerResult =
  | { ok: true; state: AppState; sourceTableId: string; targetTableId: string; seatNumber: number }
  | { ok: false; reason: 'same-table' | 'missing-target' | 'full-target'; error?: string };

const unavailableInterestStatuses: InterestStatus[] = [
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated',
  'Removed'
];

const markManualEdit = (
  edits: Record<string, string> | undefined,
  key: string,
  nowIso: () => string
) => ({ ...(edits ?? {}), [key]: nowIso() });

export const getActivePlayerSessionsForTable = (state: AppState, tableId: string) =>
  state.playerSessions.filter((playerSession) => playerSession.tableId === tableId && !playerSession.leftAt);

export function getAvailableSeatNumber(
  state: AppState,
  session: GameSession,
  requestedSeat?: number
) {
  const occupiedSeats = new Set(
    state.playerSessions
      .filter((playerSession) => playerSession.tableId === session.id && !playerSession.leftAt)
      .map((playerSession) => playerSession.seatNumber)
      .filter((seat): seat is number => Number.isInteger(seat))
  );
  const seats = Array.from({ length: session.maxSeats }, (_, index) => index + 1);
  if (requestedSeat !== undefined) {
    return seats.includes(requestedSeat) && !occupiedSeats.has(requestedSeat) ? requestedSeat : undefined;
  }
  return seats.find((seat) => !occupiedSeats.has(seat));
}

export function syncSessionSeatCount(
  state: AppState,
  tableId: string,
  patch: Partial<GameSession> = {}
): AppState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === tableId
        ? {
            ...session,
            ...patch,
            seatsFilled: Math.min(session.maxSeats, getActivePlayerSessionsForTable(state, tableId).length)
          }
        : session
    )
  };
}

const withProfileGameLogged = (
  state: AppState,
  profileId: string | undefined,
  playerName: string,
  gameId: string
): AppState => ({
  ...state,
  profiles: state.profiles.map((profile) => {
    const sameProfile = profileId
      ? profile.id === profileId
      : profile.name.toLowerCase() === playerName.toLowerCase();
    if (!sameProfile) return profile;
    const gamePlayCounts = {
      ...(profile.gamePlayCounts ?? {}),
      [gameId]: (profile.gamePlayCounts?.[gameId] ?? 0) + 1
    };
    const getGameName = (candidateGameId: string) =>
      state.games.find((game) => game.id === candidateGameId)?.name ?? candidateGameId;
    const mostPlayedGameId =
      Object.entries(gamePlayCounts)
        .sort((left, right) => right[1] - left[1] || getGameName(left[0]).localeCompare(getGameName(right[0])))[0]?.[0] ?? gameId;
    return {
      ...profile,
      gamePlayCounts,
      mostPlayedGameId,
      preferredGameIds: Array.from(new Set([...(profile.preferredGameIds ?? []), gameId]))
    };
  })
});

export function seatPlayerInState(
  state: AppState,
  tableId: string,
  payload: SeatPlayerPayload,
  dependencies: SeatingCommandDependencies
): SeatPlayerResult {
  const session = state.sessions.find(
    (item) => item.id === tableId && item.status !== 'Closed' && item.status !== 'Failed to Start'
  );
  if (!session) return { ok: false, error: 'This table is no longer open.' };

  const timestamp = dependencies.nowIso();
  const profile = payload.profileId
    ? state.profiles.find((item) => item.id === payload.profileId)
    : payload.playerName
      ? state.profiles.find((item) => item.name.toLowerCase() === payload.playerName?.trim().toLowerCase())
      : undefined;
  const interest = payload.interestId
    ? state.interests.find((item) => item.id === payload.interestId)
    : payload.playerName
      ? state.interests.find(
          (item) =>
            item.gameId === session.gameId &&
            item.playerName.toLowerCase() === payload.playerName?.trim().toLowerCase() &&
            !unavailableInterestStatuses.includes(item.status)
        )
      : undefined;
  const playerName = (payload.playerName || profile?.name || interest?.playerName || '').trim();
  if (!playerName) return { ok: false, error: 'Choose a player or enter a player name.' };

  const profileId = profile?.id ?? payload.profileId ?? interest?.profileId;
  const duplicate = state.playerSessions.find((playerSession) => {
    const samePlayer = profileId
      ? playerSession.profileId === profileId
      : playerSession.playerName.toLowerCase() === playerName.toLowerCase();
    return samePlayer && !playerSession.leftAt;
  });
  if (duplicate) return { ok: false, error: `${playerName} is already seated.` };

  const seatNumber = getAvailableSeatNumber(state, session, payload.requestedSeatNumber);
  if (!seatNumber) return { ok: false, error: 'Table full. No open seats remain.' };

  const isTimeCollection = session.timeFeeBased || session.collectionMode === 'Time';
  const timeMinutes = isTimeCollection ? Math.max(0, Number(payload.initialTimeMinutes ?? 0)) : 0;
  const hasInitialTime = Number.isFinite(timeMinutes) && timeMinutes > 0;
  const initialBuyInAmount = Number(payload.initialBuyIn ?? 0);
  const hasInitialBuyIn = Number.isFinite(initialBuyInAmount) && initialBuyInAmount > 0;
  const matchingInterest = interest ?? state.interests.find(
    (item) =>
      item.gameId === session.gameId &&
      !unavailableInterestStatuses.includes(item.status) &&
      (profileId ? item.profileId === profileId : item.playerName.toLowerCase() === playerName.toLowerCase())
  );
  const interests = state.interests.map((item) =>
    matchingInterest && item.id === matchingInterest.id
      ? {
          ...item,
          status: 'Seated' as InterestStatus,
          profileId: profileId ?? item.profileId,
          seatedAt: item.seatedAt ?? timestamp,
          timestamp
        }
      : item
  );
  const playerSessionId = dependencies.createId();
  const seatedState: AppState = withProfileGameLogged({
    ...state,
    interests,
    playerSessions: [
      ...state.playerSessions,
      {
        id: playerSessionId,
        playerName,
        profileId,
        gameId: session.gameId,
        tableId: session.id,
        seatNumber,
        seatedAt: timestamp,
        timePurchasedMinutes: timeMinutes,
        timeRemainingMinutes: timeMinutes,
        lastTimeTickAt: timestamp,
        timeFeeEnabled: isTimeCollection && timeMinutes > 0
      }
    ],
    buyIns: hasInitialBuyIn
      ? [
          {
            id: dependencies.createId(),
            profileId,
            playerName,
            tableId: session.id,
            gameId: session.gameId,
            amount: initialBuyInAmount,
            timestamp,
            note: 'Initial buy-in'
          },
          ...state.buyIns
        ]
      : state.buyIns,
    playerLedger: [
      ...(hasInitialBuyIn
        ? [
            {
              id: dependencies.createId(),
              type: 'Buy-In' as const,
              profileId,
              playerName,
              tableId: session.id,
              gameId: session.gameId,
              amount: initialBuyInAmount,
              timestamp,
              note: 'Initial buy-in'
            }
          ]
        : []),
      {
        id: dependencies.createId(),
        type: 'Check-In' as const,
        profileId,
        playerName,
        tableId: session.id,
        gameId: session.gameId,
        timestamp,
        note: `${payload.note ?? 'Seated'}: seat ${seatNumber}`
      },
      ...state.playerLedger
    ],
    timeFeeLogs: hasInitialTime
      ? [
          ...state.timeFeeLogs,
          {
            id: dependencies.createId(),
            playerSessionId,
            tableId: session.id,
            gameId: session.gameId,
            playerName,
            minutes: timeMinutes,
            amount: (timeMinutes / 60) * getCollectionProfile(state, session.gameId).hourlyFee,
            timestamp
          }
        ]
      : state.timeFeeLogs
  }, profileId, playerName, session.gameId);
  const nextStatus = session.status === 'Forming' ? 'Running' as GameStatus : session.status;
  return {
    ok: true,
    state: syncSessionSeatCount(seatedState, session.id, {
      status: nextStatus,
      startedAt: nextStatus === 'Running' ? session.startedAt || timestamp : session.startedAt
    }),
    seatNumber,
    playerName,
    profileId,
    tableId: session.id,
    gameId: session.gameId
  };
}

export function movePlayerToTable(
  state: AppState,
  playerSession: PlayerSession,
  targetTableId: string,
  dependencies: SeatingCommandDependencies
): MovePlayerResult {
  if (playerSession.tableId === targetTableId) return { ok: false, reason: 'same-table' };
  const sourceTable = state.sessions.find((session) => session.id === playerSession.tableId);
  const targetTable = state.sessions.find((session) => session.id === targetTableId);
  if (!targetTable) return { ok: false, reason: 'missing-target' };
  const targetSeatNumber =
    getAvailableSeatNumber(state, targetTable, playerSession.seatNumber) ??
    getAvailableSeatNumber(state, targetTable);
  if (!targetSeatNumber) {
    return { ok: false, reason: 'full-target', error: 'No open seats on the target table.' };
  }
  const movedState: AppState = {
    ...state,
    playerSessions: state.playerSessions.map((session) =>
      session.id === playerSession.id
        ? {
            ...session,
            tableId: targetTableId,
            seatNumber: targetSeatNumber,
            manualEdits: markManualEdit(
              markManualEdit(session.manualEdits, 'tableId', dependencies.nowIso),
              'seatNumber',
              dependencies.nowIso
            )
          }
        : session
    ),
    tableEvents: [
      ...state.tableEvents,
      {
        id: dependencies.createId(),
        type: 'Merged',
        gameId: targetTable.gameId,
        tableId: targetTable.id,
        timestamp: dependencies.nowIso(),
        playerCount: targetTable.seatsFilled + 1,
        reason: 'player moved',
        note: `${playerSession.playerName} moved from ${sourceTable?.label ?? 'unknown table'} to ${targetTable.label}`
      }
    ]
  };
  return {
    ok: true,
    state: syncSessionSeatCount(syncSessionSeatCount(movedState, playerSession.tableId), targetTableId),
    sourceTableId: playerSession.tableId,
    targetTableId,
    seatNumber: targetSeatNumber
  };
}
