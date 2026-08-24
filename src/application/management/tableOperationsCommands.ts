import type {
  AppState,
  BuyInLog,
  GameSession,
  PhysicalTable,
  PlayerLedgerEntry,
  PlayerSession
} from '../../domain/types';
import { markPlayerSessionLeft } from './playerSessionCommands';

export type TableOperationDependencies = {
  createId: () => string;
  nowIso: () => string;
};

type TableOperationResult =
  | { ok: true; state: AppState; movedPlayerCount?: number }
  | { ok: false; state: AppState; error: string };

const isOpenSession = (session: GameSession) =>
  session.status !== 'Closed' && session.status !== 'Failed to Start';

const getCollectionMode = (session: GameSession) =>
  session.collectionMode === 'Time' || session.timeFeeBased ? 'Time' : 'Drop';

const activePlayersAtTable = (state: AppState, tableId: string) =>
  state.playerSessions.filter((playerSession) => playerSession.tableId === tableId && !playerSession.leftAt);

const markManualEdit = (
  edits: Record<string, string> | undefined,
  key: string,
  timestamp: string
) => ({ ...(edits ?? {}), [key]: timestamp });

const closePlayersAtTable = (
  state: AppState,
  tableId: string,
  dependencies: TableOperationDependencies
) => activePlayersAtTable(state, tableId).reduce(
  (nextState, playerSession) => markPlayerSessionLeft(
    nextState,
    playerSession,
    undefined,
    'Table cleared by staff',
    dependencies
  ).state,
  state
);

export function clearTableInState(
  state: AppState,
  sessionId: string,
  dependencies: TableOperationDependencies
): TableOperationResult {
  const session = state.sessions.find((item) => item.id === sessionId && isOpenSession(item));
  if (!session) return { ok: false, state, error: 'This table is no longer open.' };

  const timestamp = dependencies.nowIso();
  const clearedState = closePlayersAtTable(state, session.id, {
    ...dependencies,
    nowIso: () => timestamp
  });

  return {
    ok: true,
    state: {
      ...clearedState,
      sessions: clearedState.sessions.map((item) =>
        item.id === session.id
          ? { ...item, status: 'Closed', seatsFilled: 0, endedAt: item.endedAt ?? timestamp }
          : item
      ),
      dealerAssignments: clearedState.dealerAssignments.map((assignment) =>
        assignment.tableId === session.id && !assignment.endedAt
          ? { ...assignment, endedAt: timestamp }
          : assignment
      ),
      tableEvents: [
        ...clearedState.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Closed',
          gameId: session.gameId,
          tableId: session.id,
          timestamp,
          playerCount: activePlayersAtTable(state, session.id).length,
          reason: 'table cleared',
          note: `${session.label} cleared by staff; session history retained`
        }
      ]
    }
  };
}

export function deleteTableInState(
  state: AppState,
  target: Pick<PhysicalTable, 'id'> | Pick<GameSession, 'id'>,
  dependencies: TableOperationDependencies
): TableOperationResult {
  const physicalTable = (state.physicalTables ?? []).find((table) => table.id === target.id);
  const session = state.sessions.find((item) =>
    isOpenSession(item) && (item.id === target.id || item.physicalTableId === target.id)
  );
  if (!physicalTable && !session) {
    return { ok: false, state, error: 'This table no longer exists.' };
  }

  const timestamp = dependencies.nowIso();
  const playerCount = session ? activePlayersAtTable(state, session.id).length : 0;
  const clearedState = session
    ? closePlayersAtTable(state, session.id, { ...dependencies, nowIso: () => timestamp })
    : state;

  return {
    ok: true,
    state: {
      ...clearedState,
      physicalTables: (clearedState.physicalTables ?? []).filter((table) =>
        table.id !== (physicalTable?.id ?? session?.physicalTableId)
      ),
      sessions: clearedState.sessions.map((item) =>
        session && item.id === session.id
          ? { ...item, status: 'Closed', seatsFilled: 0, endedAt: item.endedAt ?? timestamp }
          : item
      ),
      dealerAssignments: clearedState.dealerAssignments.map((assignment) =>
        session && assignment.tableId === session.id && !assignment.endedAt
          ? { ...assignment, endedAt: timestamp }
          : assignment
      ),
      tableEvents: session
        ? [
            ...clearedState.tableEvents,
            {
              id: dependencies.createId(),
              type: 'Closed',
              gameId: session.gameId,
              tableId: session.id,
              timestamp,
              playerCount,
              reason: 'table deleted',
              note: `${session.label} deleted by staff; session history retained`
            }
          ]
        : clearedState.tableEvents
    }
  };
}

const assignMergeSeats = (
  players: PlayerSession[],
  occupiedSeats: Set<number>,
  maximumSeats: number
) => {
  const availableSeats = Array.from({ length: maximumSeats }, (_, index) => index + 1)
    .filter((seatNumber) => !occupiedSeats.has(seatNumber));
  const assignedSeats = new Map<string, number>();

  players.forEach((playerSession) => {
    const preferredSeat = playerSession.seatNumber;
    const availableIndex = typeof preferredSeat === 'number' && availableSeats.includes(preferredSeat)
      ? availableSeats.indexOf(preferredSeat)
      : 0;
    const [seatNumber] = availableSeats.splice(Math.max(0, availableIndex), 1);
    if (seatNumber !== undefined) assignedSeats.set(playerSession.id, seatNumber);
  });

  return assignedSeats;
};

const timestampsOverlapActiveSession = (
  recordedAt: string,
  seatedAt: string,
  mergedAt: string
) => {
  const recordedAtMs = Date.parse(recordedAt);
  const seatedAtMs = Date.parse(seatedAt);
  const mergedAtMs = Date.parse(mergedAt);
  return Number.isFinite(recordedAtMs) &&
    Number.isFinite(seatedAtMs) &&
    Number.isFinite(mergedAtMs) &&
    recordedAtMs >= seatedAtMs &&
    recordedAtMs <= mergedAtMs;
};

const recordBelongsToPlayer = (
  record: Pick<BuyInLog | PlayerLedgerEntry, 'profileId' | 'playerName'>,
  playerSession: PlayerSession
) => playerSession.profileId
  ? record.profileId === playerSession.profileId
  : !record.profileId &&
    record.playerName.trim().toLowerCase() === playerSession.playerName.trim().toLowerCase();

const recordBelongsToMergedSession = (
  record: Pick<BuyInLog | PlayerLedgerEntry, 'profileId' | 'playerName' | 'timestamp'>,
  sourcePlayers: PlayerSession[],
  mergedAt: string
) => sourcePlayers.some((playerSession) =>
  recordBelongsToPlayer(record, playerSession) &&
  timestampsOverlapActiveSession(record.timestamp, playerSession.seatedAt, mergedAt)
);

export function mergeTableInState(
  state: AppState,
  sourceSessionId: string,
  targetSessionId: string,
  dependencies: TableOperationDependencies
): TableOperationResult {
  if (sourceSessionId === targetSessionId) {
    return { ok: false, state, error: 'Choose a different table to merge into.' };
  }
  const source = state.sessions.find((session) => session.id === sourceSessionId && isOpenSession(session));
  const target = state.sessions.find((session) => session.id === targetSessionId && isOpenSession(session));
  if (!source || !target) return { ok: false, state, error: 'Both tables must still be open.' };
  if (source.gameId !== target.gameId) {
    return { ok: false, state, error: 'Only tables running the same game can be merged.' };
  }
  if (getCollectionMode(source) !== getCollectionMode(target)) {
    return { ok: false, state, error: 'Only tables using the same collection mode can be merged.' };
  }

  const sourcePlayers = activePlayersAtTable(state, source.id)
    .sort((left, right) => (left.seatNumber ?? 99) - (right.seatNumber ?? 99));
  const targetPlayers = activePlayersAtTable(state, target.id);
  if (sourcePlayers.length + targetPlayers.length > target.maxSeats) {
    return { ok: false, state, error: `${target.label} does not have enough open seats.` };
  }

  const occupiedSeats = new Set(
    targetPlayers
      .map((playerSession) => playerSession.seatNumber)
      .filter((seatNumber): seatNumber is number => typeof seatNumber === 'number')
  );
  const assignedSeats = assignMergeSeats(sourcePlayers, occupiedSeats, target.maxSeats);
  const timestamp = dependencies.nowIso();
  const movedPlayerSessionIds = new Set(sourcePlayers.map((playerSession) => playerSession.id));

  return {
    ok: true,
    movedPlayerCount: sourcePlayers.length,
    state: {
      ...state,
      sessions: state.sessions.map((session) => {
        if (session.id === source.id) {
          return { ...session, status: 'Closed', seatsFilled: 0, endedAt: session.endedAt ?? timestamp };
        }
        if (session.id === target.id) {
          return { ...session, seatsFilled: targetPlayers.length + sourcePlayers.length };
        }
        return session;
      }),
      playerSessions: state.playerSessions.map((playerSession) => {
        const seatNumber = assignedSeats.get(playerSession.id);
        if (seatNumber === undefined) return playerSession;
        return {
          ...playerSession,
          tableId: target.id,
          seatNumber,
          manualEdits: markManualEdit(
            markManualEdit(playerSession.manualEdits, 'tableId', timestamp),
            'seatNumber',
            timestamp
          )
        };
      }),
      buyIns: state.buyIns.map((buyIn) =>
        buyIn.tableId === source.id &&
        buyIn.gameId === source.gameId &&
        recordBelongsToMergedSession(buyIn, sourcePlayers, timestamp)
          ? { ...buyIn, tableId: target.id }
          : buyIn
      ),
      playerLedger: state.playerLedger.map((entry) =>
        entry.tableId === source.id &&
        (!entry.gameId || entry.gameId === source.gameId) &&
        recordBelongsToMergedSession(entry, sourcePlayers, timestamp)
          ? { ...entry, tableId: target.id }
          : entry
      ),
      timeFeeLogs: state.timeFeeLogs.map((entry) =>
        movedPlayerSessionIds.has(entry.playerSessionId)
          ? { ...entry, tableId: target.id }
          : entry
      ),
      dealerAssignments: state.dealerAssignments.map((assignment) =>
        assignment.tableId === source.id && !assignment.endedAt
          ? { ...assignment, endedAt: timestamp }
          : assignment
      ),
      tableEvents: [
        ...state.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Merged',
          gameId: source.gameId,
          tableId: source.id,
          timestamp,
          playerCount: sourcePlayers.length,
          reason: 'table merged',
          note: `${source.label} merged into ${target.label}`
        }
      ]
    }
  };
}
