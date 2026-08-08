import type { AppState, GameSession, TableEventType } from '../../domain/types';
import type { TableCommandDependencies } from './tableCommands';

const markManualEdit = (
  edits: Record<string, string> | undefined,
  key: string,
  nowIso: () => string
) => ({ ...(edits ?? {}), [key]: nowIso() });

export function updateTableSession(
  state: AppState,
  id: string,
  patch: Partial<GameSession>,
  dependencies: TableCommandDependencies
) {
  const current = state.sessions.find((session) => session.id === id);
  const eventType: TableEventType | undefined =
    patch.status === 'Running'
      ? 'Started'
      : patch.status === 'Closed'
        ? current?.status === 'Forming'
          ? 'Failed to Start'
          : 'Closed'
        : undefined;
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== id) return session;
      const closed = patch.status === 'Closed' && !session.endedAt;
      return {
        ...session,
        ...patch,
        endedAt: closed ? dependencies.nowIso() : patch.status === 'Running' ? undefined : session.endedAt,
        manualEdits: Object.keys(patch).reduce(
          (edits, key) => markManualEdit(edits, key, dependencies.nowIso),
          session.manualEdits
        )
      };
    }),
    tableEvents: eventType && current
      ? [
          ...state.tableEvents,
          {
            id: dependencies.createId(),
            type: eventType,
            gameId: current.gameId,
            tableId: current.id,
            timestamp: dependencies.nowIso(),
            playerCount: current.seatsFilled,
            note: ''
          }
        ]
      : state.tableEvents
  };
}

export function correctTableTimestamp(
  state: AppState,
  id: string,
  key: 'startedAt' | 'endedAt',
  nextValue: string | undefined,
  dependencies: TableCommandDependencies
): AppState {
  const nextState = {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === id
        ? { ...session, [key]: nextValue, manualEdits: markManualEdit(session.manualEdits, key, dependencies.nowIso) }
        : session
    )
  };
  return {
    ...nextState,
    correctionLog: [
      {
        id: dependencies.createId(),
        entity: id,
        field: key,
        note: 'Table timestamp corrected',
        timestamp: dependencies.nowIso()
      },
      ...nextState.correctionLog
    ].slice(0, 50)
  };
}

export function recordTableLifecycleEvent(
  state: AppState,
  session: GameSession,
  type: TableEventType,
  reason: string,
  note: string,
  dependencies: TableCommandDependencies
): AppState {
  const timestamp = dependencies.nowIso();
  return {
    ...state,
    sessions: state.sessions.map((item) =>
      item.id === session.id
        ? {
            ...item,
            status: type === 'Started'
              ? 'Running'
              : type === 'Failed to Start'
                ? 'Failed to Start'
                : type === 'Broke' || type === 'Closed'
                  ? 'Closed'
                  : item.status,
            endedAt: type === 'Failed to Start' || type === 'Broke' || type === 'Closed'
              ? item.endedAt ?? timestamp
              : item.endedAt
          }
        : item
    ),
    playerSessions: type === 'Broke' || type === 'Closed'
      ? state.playerSessions.map((playerSession) =>
          playerSession.tableId === session.id && !playerSession.leftAt
            ? { ...playerSession, leftAt: timestamp }
            : playerSession
        )
      : state.playerSessions,
    dealerAssignments: type === 'Broke' || type === 'Closed' || type === 'Failed to Start'
      ? state.dealerAssignments.map((assignment) =>
          assignment.tableId === session.id && !assignment.endedAt
            ? { ...assignment, endedAt: timestamp }
            : assignment
        )
      : state.dealerAssignments,
    tableEvents: [
      ...state.tableEvents,
      {
        id: dependencies.createId(),
        type,
        gameId: session.gameId,
        tableId: session.id,
        timestamp,
        playerCount: session.seatsFilled,
        reason,
        note
      }
    ]
  };
}
