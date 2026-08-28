import { getTimeRemainingMinutes, hoursBetween } from '../../domain/operations';
import { getCollectionProfile } from '../../domain/reporting';
import type { AppState, GameSession, Interest, PlayerProfile, PlayerSession } from '../../domain/types';
import { syncSessionSeatCount } from './seatingCommands';

export type PlayerSessionCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
  nowMs: () => number;
};

export type PlayerSessionCommandResult =
  | { ok: true; state: AppState }
  | { ok: false; error?: string };

type ResolvedTimeProfile =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; error: string };

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

const findCurrentPlayerSession = (state: AppState, playerSessionId: string) => {
  const playerSession = state.playerSessions.find((session) => session.id === playerSessionId);
  if (!playerSession) return { ok: false as const, error: 'This player session no longer exists.' };
  if (playerSession.leftAt) return { ok: false as const, error: 'This player session is already closed.' };
  return { ok: true as const, playerSession };
};

const resolveTimeProfile = (state: AppState, playerSession: PlayerSession): ResolvedTimeProfile => {
  if (playerSession.profileId) {
    const profile = state.profiles.find((candidate) => candidate.id === playerSession.profileId);
    return profile
      ? { ok: true, profile }
      : { ok: false, error: 'The player session is linked to a profile that no longer exists.' };
  }

  const normalizedName = playerSession.playerName.trim().toLowerCase();
  const legacyMatches = state.profiles.filter(
    (profile) => profile.name.trim().toLowerCase() === normalizedName
  );
  if (legacyMatches.length === 1) return { ok: true, profile: legacyMatches[0] };
  if (legacyMatches.length > 1) {
    return {
      ok: false,
      error: 'Multiple player profiles match this legacy session. Link the correct profile before moving saved time.'
    };
  }
  return {
    ok: false,
    error: 'Link this player session to a profile before moving saved time.'
  };
};

const getCurrentRemainingMinutes = (playerSession: PlayerSession, nowMs: number) =>
  playerSession.timeFeeEnabled
    ? getTimeRemainingMinutes(playerSession, nowMs)
    : Math.max(0, Number(playerSession.timeRemainingMinutes) || 0);

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

export function deductUnconsumedPlayerTime(
  state: AppState,
  playerSessionId: string,
  minutes: number,
  reason: string,
  dependencies: PlayerSessionCommandDependencies
): PlayerSessionCommandResult {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, error: 'Enter a whole number of minutes to deduct.' };
  }
  const normalizedReason = reason.trim();
  if (!normalizedReason) return { ok: false, error: 'Enter a reason for the time correction.' };

  const currentResult = findCurrentPlayerSession(state, playerSessionId);
  if (!currentResult.ok) return currentResult;
  const current = currentResult.playerSession;
  const purchasedMinutes = Math.max(0, Number(current.timePurchasedMinutes) || 0);
  const remainingMinutes = getCurrentRemainingMinutes(current, dependencies.nowMs());
  const appliedCreditMinutes = Math.max(0, Number(current.timeCreditAppliedMinutes) || 0);
  // Treat paid minutes as consumed before reusable credit so a correction can
  // never refund time that remains only because saved credit was applied.
  const consumedMinutes = Math.max(0, purchasedMinutes + appliedCreditMinutes - remainingMinutes);
  const deductibleMinutes = Math.max(0, purchasedMinutes - consumedMinutes);
  if (minutes > deductibleMinutes) {
    return {
      ok: false,
      error: `Only ${deductibleMinutes} unconsumed purchased minute${deductibleMinutes === 1 ? '' : 's'} can be deducted.`
    };
  }

  const timestamp = dependencies.nowIso();
  const correctionAmount = (minutes / 60) * getCollectionProfile(state, current.gameId).hourlyFee;
  const correctedState: AppState = {
    ...state,
    playerSessions: state.playerSessions.map((session) =>
      session.id === current.id
        ? {
            ...session,
            timePurchasedMinutes: purchasedMinutes - minutes,
            timeRemainingMinutes: remainingMinutes - minutes,
            lastTimeTickAt: timestamp,
            timeFeeEnabled: Boolean(session.timeFeeEnabled && remainingMinutes - minutes > 0)
          }
        : session
    ),
    timeFeeLogs: [
      ...state.timeFeeLogs,
      {
        id: dependencies.createId(),
        playerSessionId: current.id,
        tableId: current.tableId,
        gameId: current.gameId,
        playerName: current.playerName,
        minutes: -minutes,
        amount: correctionAmount === 0 ? 0 : -correctionAmount,
        timestamp
      }
    ]
  };

  return {
    ok: true,
    state: withCorrectionLog(
      correctedState,
      current.id,
      'timePurchasedMinutes',
      `Deducted ${minutes} unconsumed purchased minute${minutes === 1 ? '' : 's'}: ${normalizedReason}`,
      { createId: dependencies.createId, nowIso: () => timestamp }
    )
  };
}

export function pauseAndStorePlayerTimeCredit(
  state: AppState,
  playerSessionId: string,
  dependencies: Pick<PlayerSessionCommandDependencies, 'nowIso' | 'nowMs'>
): PlayerSessionCommandResult {
  const currentResult = findCurrentPlayerSession(state, playerSessionId);
  if (!currentResult.ok) return currentResult;
  const current = currentResult.playerSession;
  const profileResult = resolveTimeProfile(state, current);
  if (!profileResult.ok) return profileResult;

  const remainingMinutes = getCurrentRemainingMinutes(current, dependencies.nowMs());
  if (remainingMinutes <= 0) return { ok: false, error: 'This player has no remaining time to save.' };
  const timestamp = dependencies.nowIso();
  return {
    ok: true,
    state: {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === profileResult.profile.id
          ? {
              ...profile,
              savedTimeCreditMinutes: Math.max(0, Number(profile.savedTimeCreditMinutes) || 0) + remainingMinutes
            }
          : profile
      ),
      playerSessions: state.playerSessions.map((session) =>
        session.id === current.id
          ? {
              ...session,
              timeRemainingMinutes: 0,
              lastTimeTickAt: timestamp,
              timeFeeEnabled: false
            }
          : session
      )
    }
  };
}

export function applySavedPlayerTimeCredit(
  state: AppState,
  playerSessionId: string,
  minutes: number,
  dependencies: Pick<PlayerSessionCommandDependencies, 'nowIso' | 'nowMs'>
): PlayerSessionCommandResult {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, error: 'Enter a whole number of saved minutes to apply.' };
  }
  const currentResult = findCurrentPlayerSession(state, playerSessionId);
  if (!currentResult.ok) return currentResult;
  const current = currentResult.playerSession;
  const table = state.sessions.find((session) => session.id === current.tableId);
  if (!table || table.status === 'Closed' || table.status === 'Failed to Start') {
    return { ok: false, error: 'Saved time can only be applied at an open table.' };
  }
  if (table.collectionMode !== 'Time' && !table.timeFeeBased) {
    return { ok: false, error: 'Saved time can only be applied at a time-collection table.' };
  }

  const profileResult = resolveTimeProfile(state, current);
  if (!profileResult.ok) return profileResult;
  const availableMinutes = Math.max(0, Number(profileResult.profile.savedTimeCreditMinutes) || 0);
  if (minutes > availableMinutes) {
    return {
      ok: false,
      error: `Only ${availableMinutes} saved minute${availableMinutes === 1 ? '' : 's'} are available.`
    };
  }

  const remainingMinutes = getCurrentRemainingMinutes(current, dependencies.nowMs());
  const timestamp = dependencies.nowIso();
  return {
    ok: true,
    state: {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === profileResult.profile.id
          ? { ...profile, savedTimeCreditMinutes: availableMinutes - minutes }
          : profile
      ),
      playerSessions: state.playerSessions.map((session) =>
        session.id === current.id
          ? {
              ...session,
              timeCreditAppliedMinutes: Math.max(0, Number(session.timeCreditAppliedMinutes) || 0) + minutes,
              timeRemainingMinutes: remainingMinutes + minutes,
              lastTimeTickAt: timestamp,
              timeFeeEnabled: true
            }
          : session
      )
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
  const hasProfileId = interest.profileId !== undefined;
  const normalizedPlayerName = interest.playerName.trim().toLowerCase();
  const activeGameSessions = state.playerSessions.filter(
    (session) => session.gameId === interest.gameId && !session.leftAt
  );
  const fallbackNameMatches = hasProfileId
    ? []
    : activeGameSessions.filter(
        (session) => session.playerName.trim().toLowerCase() === normalizedPlayerName
      );
  const openSession = hasProfileId
    ? activeGameSessions.find((session) => session.profileId === interest.profileId)
    : fallbackNameMatches.length === 1
      ? fallbackNameMatches[0]
      : undefined;
  const timestamp = dependencies.nowIso();
  const nextState: AppState = {
    ...state,
    interests: state.interests.map((item) =>
      item.id === interest.id
        ? { ...item, status: 'Removed', closedAt: timestamp, timestamp }
        : item
    ),
    playerSessions: state.playerSessions.map((session) =>
      session.id === openSession?.id ? { ...session, leftAt: timestamp } : session
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
  cashOutAmount: number | undefined,
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
        ...(cashOutAmount !== undefined ? { amount: cashOutAmount } : {}),
        timestamp: leftAt,
        note: cashOutNote.trim() ||
          (cashOutAmount === undefined
            ? 'Player left table without a recorded cash-out amount'
            : cashOutAmount === 0
              ? 'Player left table with no cash out'
              : 'Player left table')
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
