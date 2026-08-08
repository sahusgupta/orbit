import { getTimeRemainingMinutes, hoursBetween } from '../../domain/operations';
import { getCollectionProfile } from '../../domain/reporting';
import type { AppState, GameSession, Interest, PlayerSession } from '../../domain/types';
import { syncSessionSeatCount } from './seatingCommands';

export type PlayerSessionCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
  nowMs: () => number;
};

export type PlayerSessionCommandResult =
  | { ok: true; state: AppState }
  | { ok: false; error?: string };

const markManualEdit = (
  edits: Record<string, string> | undefined,
  key: string,
  nowIso: () => string
) => ({ ...(edits ?? {}), [key]: nowIso() });

const withCorrectionLog = (
  state: AppState,
  entity: string,
  field: string,
  note: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): AppState => ({
  ...state,
  correctionLog: [
    {
      id: dependencies.createId(),
      entity,
      field,
      note,
      timestamp: dependencies.nowIso()
    },
    ...state.correctionLog
  ].slice(0, 50)
});

export function correctPlayerSession(
  state: AppState,
  sessionId: string,
  patch: Partial<PlayerSession>,
  editKey: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
) {
  return withCorrectionLog({
    ...state,
    playerSessions: state.playerSessions.map((session) =>
      session.id === sessionId
        ? { ...session, ...patch, manualEdits: markManualEdit(session.manualEdits, editKey, dependencies.nowIso) }
        : session
    )
  }, sessionId, editKey, 'Player session corrected', dependencies);
}

export function getPlayerSeatChangeError(
  state: AppState,
  playerSession: PlayerSession,
  seatNumber: number
) {
  const table = state.sessions.find((session) => session.id === playerSession.tableId);
  if (!table || !Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > table.maxSeats) {
    return 'Choose a valid seat number.';
  }
  const occupied = state.playerSessions.some(
    (session) =>
      session.id !== playerSession.id &&
      session.tableId === playerSession.tableId &&
      !session.leftAt &&
      session.seatNumber === seatNumber
  );
  return occupied ? `Seat ${seatNumber} is already occupied.` : null;
}

export function changePlayerSeat(
  state: AppState,
  playerSession: PlayerSession,
  seatNumber: number,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): PlayerSessionCommandResult {
  const error = getPlayerSeatChangeError(state, playerSession, seatNumber);
  if (error) return { ok: false, error };
  return {
    ok: true,
    state: correctPlayerSession(state, playerSession.id, { seatNumber }, 'seatNumber', dependencies)
  };
}

export function setTableCollectionMode(
  state: AppState,
  sessionId: string,
  collectionMode: 'Time' | 'Drop',
  dependencies: Pick<PlayerSessionCommandDependencies, 'nowIso'>
): AppState {
  const timeFeeBased = collectionMode === 'Time';
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, collectionMode, timeFeeBased } : session
    ),
    playerSessions: state.playerSessions.map((playerSession) =>
      playerSession.tableId === sessionId && !playerSession.leftAt
        ? {
            ...playerSession,
            timeFeeEnabled: timeFeeBased,
            lastTimeTickAt: playerSession.lastTimeTickAt ?? dependencies.nowIso()
          }
        : playerSession
    )
  };
}

export function addPlayerTime(
  state: AppState,
  playerSession: PlayerSession,
  minutes: number,
  dependencies: PlayerSessionCommandDependencies
): PlayerSessionCommandResult {
  if (!minutes || minutes <= 0) return { ok: false };
  const remaining = getTimeRemainingMinutes(playerSession, dependencies.nowMs());
  const timestamp = dependencies.nowIso();
  const amount = (minutes / 60) * getCollectionProfile(state, playerSession.gameId).hourlyFee;
  return {
    ok: true,
    state: {
      ...state,
      playerSessions: state.playerSessions.map((session) =>
        session.id === playerSession.id
          ? {
              ...session,
              timePurchasedMinutes: (session.timePurchasedMinutes ?? 0) + minutes,
              timeRemainingMinutes: remaining + minutes,
              lastTimeTickAt: timestamp,
              timeFeeEnabled: true
            }
          : session
      ),
      timeFeeLogs: [
        ...state.timeFeeLogs,
        {
          id: dependencies.createId(),
          playerSessionId: playerSession.id,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          playerName: playerSession.playerName,
          minutes,
          amount,
          timestamp
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Merged',
          gameId: playerSession.gameId,
          tableId: playerSession.tableId,
          timestamp,
          playerCount: state.sessions.find((session) => session.id === playerSession.tableId)?.seatsFilled ?? 0,
          reason: 'time added',
          note: `${minutes} minutes added for ${playerSession.playerName}`
        }
      ]
    }
  };
}

export function addPlayerBuyIn(
  state: AppState,
  playerSession: PlayerSession,
  amount: number,
  note: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): PlayerSessionCommandResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a buy-in amount.' };
  return {
    ok: true,
    state: {
      ...state,
      buyIns: [
        {
          id: dependencies.createId(),
          profileId: playerSession.profileId,
          playerName: playerSession.playerName,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          amount,
          timestamp: dependencies.nowIso(),
          note
        },
        ...state.buyIns
      ],
      playerLedger: [
        {
          id: dependencies.createId(),
          type: 'Buy-In',
          profileId: playerSession.profileId,
          playerName: playerSession.playerName,
          tableId: playerSession.tableId,
          gameId: playerSession.gameId,
          amount,
          timestamp: dependencies.nowIso(),
          note
        },
        ...state.playerLedger
      ]
    }
  };
}

export function recordTableDrop(
  state: AppState,
  session: GameSession,
  amount: number,
  note: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): PlayerSessionCommandResult {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Enter the amount removed from the table.' };
  }
  return {
    ok: true,
    state: {
      ...state,
      dropLogs: [
        {
          id: dependencies.createId(),
          tableId: session.id,
          gameId: session.gameId,
          amount,
          timestamp: dependencies.nowIso(),
          note: note.trim()
        },
        ...state.dropLogs
      ]
    }
  };
}

export function assignTableDealer(
  state: AppState,
  session: GameSession,
  dealerNameInput: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): PlayerSessionCommandResult {
  const dealerName = dealerNameInput.trim();
  if (!dealerName) return { ok: false, error: 'Enter or select a dealer name.' };
  const timestamp = dependencies.nowIso();
  return {
    ok: true,
    state: {
      ...state,
      dealerAssignments: [
        ...state.dealerAssignments.map((assignment) =>
          assignment.tableId === session.id && !assignment.endedAt
            ? { ...assignment, endedAt: timestamp }
            : assignment
        ),
        { id: dependencies.createId(), tableId: session.id, gameId: session.gameId, dealerName, startedAt: timestamp }
      ]
    }
  };
}

export function endTableDealerAssignment(
  state: AppState,
  session: GameSession,
  dependencies: Pick<PlayerSessionCommandDependencies, 'nowIso'>
): AppState {
  const timestamp = dependencies.nowIso();
  return {
    ...state,
    dealerAssignments: state.dealerAssignments.map((assignment) =>
      assignment.tableId === session.id && !assignment.endedAt
        ? { ...assignment, endedAt: timestamp }
        : assignment
    )
  };
}

export function recordTableHands(
  state: AppState,
  session: GameSession,
  hands: number,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
): PlayerSessionCommandResult {
  if (!Number.isInteger(hands) || hands <= 0) {
    return { ok: false, error: 'Enter the number of hands dealt since the last count.' };
  }
  return {
    ok: true,
    state: {
      ...state,
      handCountLogs: [
        ...state.handCountLogs,
        { id: dependencies.createId(), tableId: session.id, gameId: session.gameId, hands, timestamp: dependencies.nowIso() }
      ]
    }
  };
}

export function markInterestPlayerLeft(
  state: AppState,
  interest: Interest,
  dependencies: Pick<PlayerSessionCommandDependencies, 'nowIso'>
) {
  const openSession = state.playerSessions.find(
    (session) => session.playerName === interest.playerName && session.gameId === interest.gameId && !session.leftAt
  );
  const nextState: AppState = {
    ...state,
    interests: state.interests.map((item) =>
      item.id === interest.id
        ? { ...item, status: 'Removed', closedAt: dependencies.nowIso(), timestamp: dependencies.nowIso() }
        : item
    ),
    playerSessions: state.playerSessions.map((session) =>
      session.id === openSession?.id ? { ...session, leftAt: dependencies.nowIso() } : session
    )
  };
  return {
    state: openSession ? syncSessionSeatCount(nextState, openSession.tableId) : nextState,
    notification: openSession
      ? { gameId: openSession.gameId, reason: 'seat-opened' as const }
      : null
  };
}

export function markPlayerSessionLeft(
  state: AppState,
  playerSession: PlayerSession,
  cashOutAmount: number,
  cashOutNote: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'createId' | 'nowIso'>
) {
  const leftAt = dependencies.nowIso();
  const sessionHours = hoursBetween(playerSession.seatedAt, leftAt);
  const fallbackProfileMatches = playerSession.profileId
    ? []
    : state.profiles.filter((profile) => profile.name.toLowerCase() === playerSession.playerName.toLowerCase());
  const departureProfileId = playerSession.profileId ||
    (fallbackProfileMatches.length === 1 ? fallbackProfileMatches[0].id : undefined);
  const nextState: AppState = {
    ...state,
    interests: state.interests.map((interest) => {
      const samePlayer = playerSession.profileId
        ? interest.profileId === playerSession.profileId
        : interest.playerName.toLowerCase() === playerSession.playerName.toLowerCase() &&
          interest.gameId === playerSession.gameId;
      return samePlayer && interest.status === 'Seated'
        ? { ...interest, status: 'Removed', closedAt: leftAt, timestamp: leftAt }
        : interest;
    }),
    playerSessions: state.playerSessions.map((session) =>
      session.id === playerSession.id
        ? { ...session, leftAt, manualEdits: markManualEdit(session.manualEdits, 'leftAt', dependencies.nowIso) }
        : session
    ),
    playerLedger: [
      {
        id: dependencies.createId(),
        type: 'Cash-Out',
        profileId: playerSession.profileId,
        playerName: playerSession.playerName,
        tableId: playerSession.tableId,
        gameId: playerSession.gameId,
        amount: cashOutAmount,
        timestamp: leftAt,
        note: cashOutNote.trim() ||
          (cashOutAmount === 0 ? 'Player left table with no cash out' : 'Player left table')
      },
      ...state.playerLedger
    ],
    profiles: state.profiles.map((profile) =>
      profile.id === departureProfileId
        ? {
            ...profile,
            totalTimePlayedHours: (profile.totalTimePlayedHours ?? 0) + sessionHours,
            lastSessionTimePlayedHours: sessionHours
          }
        : profile
    )
  };
  return {
    state: syncSessionSeatCount(nextState, playerSession.tableId),
    notification: { gameId: playerSession.gameId, reason: 'seat-opened' as const }
  };
}
