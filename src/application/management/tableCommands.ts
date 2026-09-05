import { getCollectionProfile } from '../../domain/reporting';
import { normalizeTableCap } from '../../domain/state';
import type {
  AppState,
  GameConfig,
  GameSession,
  Interest,
  InterestStatus,
  PhysicalTable,
  PlayerProfile,
  TableCap
} from '../../domain/types';
import {
  getActivePlayerSessionsForTable,
  seatPlayerInState,
  syncSessionSeatCount,
  type SeatingCommandDependencies
} from './seatingCommands';

export type TableCommandDependencies = SeatingCommandDependencies;

export type PlannedTableParticipant = {
  playerName: string;
  profile?: Pick<PlayerProfile, 'id'>;
  interest?: Interest;
};

export type BalancedTablePlan = {
  game: GameConfig;
  fromTable: GameSession;
  moveCandidates: Array<{ playerName: string; interest?: Interest }>;
  tableASeatsAfterMove: number;
  tableBProjectedSeats: number;
};

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

const buildFormingTableState = (
  state: AppState,
  game: GameConfig,
  note: string,
  sessionId: string,
  startedAt: string,
  eventId: string,
  eventTimestamp: string,
  physicalTable?: PhysicalTable
) => {
  const collectionProfile = getCollectionProfile(state, game.id);
  const currentCount = state.sessions.filter(
    (session) => session.gameId === game.id && session.status !== 'Closed'
  ).length;
  return {
    state: {
      ...state,
      sessions: [
        ...state.sessions,
        {
          id: sessionId,
          physicalTableId: physicalTable?.id,
          gameId: game.id,
          label: physicalTable?.label ?? (currentCount ? `Table ${currentCount + 1}` : 'Main Table'),
          status: 'Forming' as const,
          seatsFilled: 0,
          maxSeats: Math.min(game.maxSeats, physicalTable?.maxSeats ?? game.maxSeats),
          timeFeeBased: collectionProfile.collectionMode === 'Time',
          collectionMode: collectionProfile.collectionMode,
          tags: [],
          startedAt
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: eventId,
          type: 'Created' as const,
          gameId: game.id,
          timestamp: eventTimestamp,
          playerCount: 0,
          note
        }
      ]
    },
    sessionId
  };
};

const getAvailablePhysicalTable = (
  state: AppState,
  physicalTableId?: string,
  minimumCapacity = 0
) => {
  const physicalTables = state.physicalTables ?? [];
  if (!physicalTables.length) return undefined;
  const occupiedIds = new Set(
    state.sessions
      .filter((session) => session.status !== 'Closed' && session.status !== 'Failed to Start')
      .flatMap((session) => session.physicalTableId ? [session.physicalTableId] : [])
  );
  if (physicalTableId) {
    const physicalTable = physicalTables.find((table) => table.id === physicalTableId);
    if (!physicalTable || occupiedIds.has(physicalTableId) || physicalTable.maxSeats < minimumCapacity) {
      return null;
    }
    return physicalTable;
  }
  return physicalTables.find(
    (table) => !occupiedIds.has(table.id) && table.maxSeats >= minimumCapacity
  ) ?? null;
};

export function createPhysicalTable(
  state: AppState,
  labelInput: string,
  maxSeats: TableCap,
  dependencies: TableCommandDependencies
) {
  const label = labelInput.trim();
  if (!label) return null;
  if ((state.physicalTables ?? []).some(
    (table) => table.label.trim().toLowerCase() === label.toLowerCase()
  )) return null;
  const physicalTable: PhysicalTable = {
    id: dependencies.createId(),
    label,
    maxSeats,
    createdAt: dependencies.nowIso()
  };
  return {
    physicalTable,
    state: {
      ...state,
      physicalTables: [...(state.physicalTables ?? []), physicalTable]
    }
  };
}

export function createFormingTable(
  state: AppState,
  gameId: string,
  dependencies: TableCommandDependencies,
  physicalTableId?: string
) {
  const game = state.games.find((item) => item.id === gameId);
  if (!game) return null;
  const physicalTable = getAvailablePhysicalTable(state, physicalTableId);
  if (physicalTable === null) return null;
  const sessionId = dependencies.createId();
  const result = buildFormingTableState(
    state,
    game,
    'Table forming',
    sessionId,
    dependencies.nowIso(),
    dependencies.createId(),
    dependencies.nowIso(),
    physicalTable
  );
  return {
    ...result,
    defaultStartPlayerIds: state.interests
      .filter((interest) => interest.gameId === gameId && !unavailableInterestStatuses.includes(interest.status))
      .slice(0, Math.min(game.maxSeats, physicalTable?.maxSeats ?? game.maxSeats))
      .map((interest) => interest.id)
  };
}

export function createDemandFormingTable(
  state: AppState,
  gameId: string,
  note: string,
  dependencies: TableCommandDependencies,
  physicalTableId?: string
) {
  const game = state.games.find((item) => item.id === gameId);
  if (!game) return null;
  const physicalTable = getAvailablePhysicalTable(state, physicalTableId);
  if (physicalTable === null) return null;
  const timestamp = dependencies.nowIso();
  return buildFormingTableState(
    state,
    game,
    note,
    dependencies.createId(),
    timestamp,
    dependencies.createId(),
    timestamp,
    physicalTable
  );
}

export function switchRunningTableGame(
  state: AppState,
  targetGameId: string,
  dependencies: TableCommandDependencies
) {
  const targetGame = state.games.find((game) => game.id === targetGameId);
  const table = state.sessions.find(
    (session) => session.status === 'Running' && session.gameId !== targetGameId
  );
  if (!targetGame || !table) return { state, switchedTableId: undefined };
  const collectionProfile = getCollectionProfile(state, targetGameId);
  const physicalTable = (state.physicalTables ?? []).find(
    (candidate) => candidate.id === table.physicalTableId
  );
  const timestamp = dependencies.nowIso();
  return {
    state: {
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === table.id
          ? {
              ...session,
              gameId: targetGameId,
              maxSeats: Math.min(targetGame.maxSeats, physicalTable?.maxSeats ?? targetGame.maxSeats),
              collectionMode: collectionProfile.collectionMode,
              timeFeeBased: collectionProfile.collectionMode === 'Time',
              manualEdits: markManualEdit(session.manualEdits, 'gameId', dependencies.nowIso)
            }
          : session
      ),
      playerSessions: state.playerSessions.map((playerSession) =>
        playerSession.tableId === table.id && !playerSession.leftAt
          ? {
              ...playerSession,
              gameId: targetGameId,
              timeFeeEnabled: collectionProfile.collectionMode === 'Time',
              manualEdits: markManualEdit(playerSession.manualEdits, 'gameId', dependencies.nowIso)
            }
          : playerSession
      ),
      tableEvents: [
        ...state.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Merged' as const,
          gameId: targetGameId,
          tableId: table.id,
          timestamp,
          playerCount: table.seatsFilled,
          reason: 'game switched',
          note: `${table.label} switched to ${targetGame.name}`
        }
      ]
    },
    switchedTableId: table.id
  };
}

export function createPlannedTable(
  state: AppState,
  gameId: string,
  participants: PlannedTableParticipant[],
  dependencies: TableCommandDependencies,
  physicalTableId?: string
) {
  const game = state.games.find((item) => item.id === gameId);
  if (!game) return null;
  const physicalTable = getAvailablePhysicalTable(state, physicalTableId, participants.length);
  if (physicalTable === null) return null;
  const collectionProfile = getCollectionProfile(state, game.id);
  const currentCount = state.sessions.filter(
    (session) => session.gameId === game.id && session.status !== 'Closed'
  ).length;
  const newInterests = participants
    .filter((candidate) => !candidate.interest)
    .map((candidate): Interest => ({
      id: dependencies.createId(),
      profileId: candidate.profile?.id,
      playerName: candidate.playerName,
      gameId: game.id,
      status: 'Interested',
      notes: 'Connected participant',
      timestamp: dependencies.nowIso(),
      interestedAt: dependencies.nowIso()
    }));
  return {
    state: {
      ...state,
      interests: [...newInterests, ...state.interests],
      sessions: [
        ...state.sessions,
        {
          id: dependencies.createId(),
          physicalTableId: physicalTable?.id,
          gameId: game.id,
          label: physicalTable?.label ?? (currentCount ? `Coordinated Table ${currentCount + 1}` : 'Coordinated Table'),
          status: 'Forming' as const,
          seatsFilled: 0,
          maxSeats: Math.min(game.maxSeats, physicalTable?.maxSeats ?? game.maxSeats),
          timeFeeBased: collectionProfile.collectionMode === 'Time',
          collectionMode: collectionProfile.collectionMode,
          plannedPlayerIds: [
            ...participants.flatMap((candidate) => candidate.interest ? [candidate.interest.id] : []),
            ...newInterests.map((interest) => interest.id)
          ],
          tags: [],
          startedAt: dependencies.nowIso()
        }
      ],
      tableEvents: [
        ...state.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Created' as const,
          gameId: game.id,
          timestamp: dependencies.nowIso(),
          playerCount: participants.length,
          note: participants.length ? 'Staff-created planned table' : 'Staff-created empty table'
        }
      ]
    },
    playerCount: participants.length
  };
}

const getRequiredMoveInterestId = (candidate: BalancedTablePlan['moveCandidates'][number]) => {
  if (!candidate.interest) throw new Error('Balanced table candidates require an interest record.');
  return candidate.interest.id;
};

export function createBalancedTable(
  state: AppState,
  plan: BalancedTablePlan,
  dependencies: TableCommandDependencies,
  physicalTableId?: string
) {
  const movingInterestIds = plan.moveCandidates.map(getRequiredMoveInterestId);
  const movingProfileIds = Array.from(new Set(plan.moveCandidates
    .map((candidate) => candidate.interest?.profileId)
    .filter((profileId): profileId is string => Boolean(profileId))));
  const everyMovingPlayerIdentified = plan.moveCandidates.every(
    (candidate) => Boolean(candidate.interest?.profileId)
  );
  const physicalTable = getAvailablePhysicalTable(
    state,
    physicalTableId,
    plan.tableBProjectedSeats
  );
  if (physicalTable === null) return null;
  const currentCount = state.sessions.filter(
    (session) => session.gameId === plan.game.id && session.status !== 'Closed'
  ).length;
  return {
    ...state,
    sessions: [
      ...state.sessions.map((session) =>
        session.id === plan.fromTable.id
          ? {
              ...session,
              seatsFilled: plan.tableASeatsAfterMove,
              plannedPlayerIds: (session.plannedPlayerIds ?? []).filter(
                (id) => !movingInterestIds.includes(id)
              )
            }
          : session
      ),
      {
        id: dependencies.createId(),
        physicalTableId: physicalTable?.id,
        gameId: plan.game.id,
        label: physicalTable?.label ?? `Balanced Table ${currentCount + 1}`,
        status: 'Forming' as const,
        seatsFilled: plan.tableBProjectedSeats,
        maxSeats: Math.min(plan.game.maxSeats, physicalTable?.maxSeats ?? plan.game.maxSeats),
        timeFeeBased: plan.fromTable.timeFeeBased ?? false,
        collectionMode: plan.fromTable.collectionMode ?? (plan.fromTable.timeFeeBased ? 'Time' : 'Drop'),
        plannedPlayerIds: movingInterestIds,
        tags: [],
        startedAt: dependencies.nowIso()
      }
    ],
    tableEvents: [
      ...state.tableEvents,
      {
        id: dependencies.createId(),
        type: 'Created' as const,
        gameId: plan.game.id,
        tableId: plan.fromTable.id,
        timestamp: dependencies.nowIso(),
        playerCount: plan.tableBProjectedSeats,
        ...(movingProfileIds.length ? { profileIds: movingProfileIds } : {}),
        note: everyMovingPlayerIdentified
          ? `Table B created from Table A balance option: ${plan.moveCandidates.map((candidate) => candidate.playerName).join(', ')}`
          : `Table B created from Table A balance option with ${plan.moveCandidates.length} player${plan.moveCandidates.length === 1 ? '' : 's'}`
      }
    ]
  };
}

export function applyDefaultTableCap(state: AppState, cap: TableCap): AppState {
  return {
    ...state,
    games: state.games.map((game) => ({ ...game, maxSeats: cap })),
    sessions: state.sessions.map((session) => {
      const activeSeats = getActivePlayerSessionsForTable(state, session.id).length;
      const requestedSafeCap = Math.max(cap, normalizeTableCap(activeSeats));
      const physicalTable = (state.physicalTables ?? []).find(
        (candidate) => candidate.id === session.physicalTableId
      );
      const safeCap = Math.min(requestedSafeCap, physicalTable?.maxSeats ?? requestedSafeCap);
      return { ...session, maxSeats: safeCap, seatsFilled: Math.min(safeCap, activeSeats) };
    }),
    settings: { ...state.settings, defaultTableCap: cap }
  };
}

export function startTableWithPlayers(
  state: AppState,
  session: GameSession,
  selectedIds: string[],
  cardHouse: string,
  dependencies: TableCommandDependencies
) {
  const selectedInterests = state.interests.filter(
    (interest) => selectedIds.includes(interest.id) && !unavailableInterestStatuses.includes(interest.status)
  );
  const alreadySeated = getActivePlayerSessionsForTable(state, session.id);
  const seatedAt = dependencies.nowIso();
  let nextState = state;
  const seatedNames: string[] = [];
  const skippedErrors: string[] = [];
  selectedInterests.forEach((interest) => {
    const result = seatPlayerInState(nextState, session.id, {
      playerName: interest.playerName,
      profileId: interest.profileId,
      interestId: interest.id,
      note: 'Started table'
    }, dependencies);
    if (result.ok) {
      nextState = result.state;
      seatedNames.push(result.playerName);
    } else {
      skippedErrors.push(result.error);
    }
  });
  nextState = syncSessionSeatCount(nextState, session.id, { status: 'Running', startedAt: seatedAt });
  const table = nextState.sessions.find((item) => item.id === session.id);
  const playerCount = table?.seatsFilled ?? alreadySeated.length + seatedNames.length;
  const startedPlayers = getActivePlayerSessionsForTable(nextState, session.id);
  const startedProfileIds = Array.from(new Set(startedPlayers
    .map((playerSession) => playerSession.profileId)
    .filter((profileId): profileId is string => Boolean(profileId))));
  const everyStartedPlayerIdentified = startedPlayers.every((playerSession) => Boolean(playerSession.profileId));
  return {
    state: {
      ...nextState,
      tableEvents: [
        ...nextState.tableEvents,
        {
          id: dependencies.createId(),
          type: 'Started' as const,
          gameId: session.gameId,
          tableId: session.id,
          timestamp: seatedAt,
          playerCount,
          ...(startedProfileIds.length ? { profileIds: startedProfileIds } : {}),
          note: `${
            startedPlayers.length
              ? everyStartedPlayerIdentified
                ? `Started with ${startedPlayers.map((player) => player.playerName).join(', ')}`
                : `Started with ${startedPlayers.length} player${startedPlayers.length === 1 ? '' : 's'}`
              : 'Started empty'
          } - messaging trigger: ${cardHouse}`
        }
      ]
    },
    table,
    playerCount,
    selectedPlayerCount: selectedInterests.length,
    alreadySeatedCount: alreadySeated.length,
    skippedErrors
  };
}
