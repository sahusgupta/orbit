import type {
  AppState,
  PlayerLedgerEntry,
  TableEventType
} from '../../domain/types';
import {
  filterRecentActivityAfterClose,
  getLatestLockedNightCloseAt
} from '../../lib/appCore';

export type FloorActivitySourceType = PlayerLedgerEntry['type'] | TableEventType | 'Drop';
export type FloorActivityEventType =
  | FloorActivitySourceType
  | 'Seated'
  | 'Time added'
  | 'Player moved'
  | 'Game switched';
export type FloorActivityScope = 'room' | 'table' | 'unassigned-table';

export type FloorActivityItem = {
  id: string;
  timestamp: string;
  label: string;
  actor: string;
  detail: string;
  kind: string;
  eventType: FloorActivityEventType;
  sourceType: FloorActivitySourceType;
  scope: FloorActivityScope;
  tableId?: string;
  tableLabel?: string;
};

export type FloorActivityFilters = {
  tableId?: string;
  eventType?: FloorActivityEventType;
};

export type FloorActivityState = Pick<
  AppState,
  'games' | 'sessions' | 'playerLedger' | 'tableEvents' | 'dropLogs' | 'nightCloses'
>;

type TableScope = Pick<FloorActivityItem, 'tableId' | 'tableLabel'>;

const getTableEventType = (
  type: TableEventType,
  reason?: string
): FloorActivityEventType => {
  if (type !== 'Merged') return type;
  if (reason === 'time added') return 'Time added';
  if (reason === 'player moved') return 'Player moved';
  if (reason === 'game switched') return 'Game switched';
  return type;
};

export function buildFloorActivityItems(state: FloorActivityState): FloorActivityItem[] {
  const gameNames = new Map(state.games.map((game) => [game.id, game.name]));
  const tableLabels = new Map(state.sessions.map((session) => [session.id, session.label]));
  const tableScope = (tableId?: string): TableScope => {
    if (!tableId) return {};
    const tableLabel = tableLabels.get(tableId);
    return tableLabel === undefined ? { tableId } : { tableId, tableLabel };
  };

  const activityItems: FloorActivityItem[] = [
    ...state.playerLedger.map((entry): FloorActivityItem => {
      const amount = entry.amount ? ` $${entry.amount.toLocaleString()}` : '';
      const eventType = entry.type === 'Check-In' && entry.tableId ? 'Seated' : entry.type;
      return {
        id: `ledger-${entry.id}`,
        timestamp: entry.timestamp,
        label: eventType,
        actor: entry.playerName,
        detail: `${gameNames.get(entry.gameId ?? '') ?? 'Floor'}${amount}${entry.note ? ` - ${entry.note}` : ''}`,
        kind: entry.type.toLowerCase().replace(/\s+/g, '-'),
        eventType,
        sourceType: entry.type,
        scope: entry.tableId ? 'table' : 'room',
        ...tableScope(entry.tableId)
      };
    }),
    ...state.tableEvents.map((event): FloorActivityItem => {
      const eventType = getTableEventType(event.type, event.reason);
      return {
        id: `table-${event.id}`,
        timestamp: event.timestamp,
        label: eventType,
        actor: gameNames.get(event.gameId) ?? 'Table',
        detail: [
          event.note,
          event.reason,
          event.playerCount ? `${event.playerCount} players` : ''
        ].filter(Boolean).join(' - '),
        kind: 'table',
        eventType,
        sourceType: event.type,
        scope: event.tableId ? 'table' : 'unassigned-table',
        ...tableScope(event.tableId)
      };
    }),
    ...state.dropLogs.map((drop): FloorActivityItem => ({
      id: `drop-${drop.id}`,
      timestamp: drop.timestamp,
      label: 'Drop',
      actor: gameNames.get(drop.gameId) ?? 'Table',
      detail: `$${drop.amount.toLocaleString()}${drop.note ? ` - ${drop.note}` : ''}`,
      kind: 'drop',
      eventType: 'Drop',
      sourceType: 'Drop',
      scope: drop.tableId ? 'table' : 'unassigned-table',
      ...tableScope(drop.tableId)
    }))
  ];

  return filterRecentActivityAfterClose(
    activityItems,
    getLatestLockedNightCloseAt(state.nightCloses)
  ).sort((left, right) => right.timestamp.localeCompare(left.timestamp));
}

export function filterFloorActivityItems(
  items: readonly FloorActivityItem[],
  filters: FloorActivityFilters = {}
): FloorActivityItem[] {
  return items.filter((item) =>
    (filters.tableId === undefined || item.tableId === filters.tableId) &&
    (filters.eventType === undefined || item.eventType === filters.eventType)
  );
}
