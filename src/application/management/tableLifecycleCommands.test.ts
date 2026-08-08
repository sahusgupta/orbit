import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, TableEventType } from '../../domain/types';
import {
  correctTableTimestamp,
  recordTableLifecycleEvent,
  updateTableSession
} from './tableLifecycleCommands';

const now = '2026-08-08T23:00:00.000Z';
const game = {
  id: 'game-lifecycle',
  name: 'Lifecycle Holdem',
  maxSeats: 8,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};
const table: GameSession = {
  id: 'table-lifecycle',
  gameId: game.id,
  label: 'Lifecycle Table',
  status: 'Forming',
  seatsFilled: 1,
  maxSeats: 8,
  tags: [],
  startedAt: '2026-08-08T20:00:00.000Z'
};
const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [game],
  sessions: [table],
  playerSessions: [],
  dealerAssignments: [],
  tableEvents: [],
  correctionLog: [],
  ...overrides
});
const dependencies = () => {
  let nextId = 0;
  return { createId: () => `created-${++nextId}`, nowIso: () => now };
};

describe('management table-lifecycle commands', () => {
  it('patches, reopens, and closes tables with established manual edits and derived events', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const renamed = updateTableSession(source, table.id, { label: 'Renamed' }, dependencies());
    const reopened = updateTableSession(state({ sessions: [{ ...table, status: 'Closed', endedAt: '2026-08-08T22:00:00.000Z' }] }), table.id, { status: 'Running' }, dependencies());
    const closed = updateTableSession(source, table.id, { status: 'Closed' }, dependencies());

    expect(renamed.sessions[0]).toEqual({ ...table, label: 'Renamed', endedAt: undefined, manualEdits: { label: now } });
    expect(renamed.tableEvents).toBe(source.tableEvents);
    expect(reopened.sessions[0]).toMatchObject({ status: 'Running', endedAt: undefined, manualEdits: { status: now } });
    expect(reopened.tableEvents[0]).toMatchObject({ id: 'created-1', type: 'Started', timestamp: now });
    expect(closed.sessions[0]).toMatchObject({ status: 'Closed', endedAt: now, manualEdits: { status: now } });
    expect(closed.tableEvents[0]).toMatchObject({ id: 'created-1', type: 'Failed to Start', timestamp: now });
    expect(source).toEqual(snapshot);
  });

  it('corrects existing and missing table timestamps with a capped audit log', () => {
    const source = state({ correctionLog: Array.from({ length: 50 }, (_, index) => ({
      id: `old-${index}`,
      entity: 'old',
      field: 'old',
      note: 'old',
      timestamp: now
    })) });
    const corrected = correctTableTimestamp(source, table.id, 'endedAt', undefined, dependencies());
    const missing = correctTableTimestamp(source, 'missing-table', 'startedAt', now, dependencies());

    expect(corrected.sessions[0]).toEqual({ ...table, endedAt: undefined, manualEdits: { endedAt: now } });
    expect(corrected.correctionLog).toHaveLength(50);
    expect(corrected.correctionLog[0]).toMatchObject({ id: 'created-1', entity: table.id, field: 'endedAt' });
    expect(missing.sessions[0]).toBe(source.sessions[0]);
    expect(missing.correctionLog[0]).toMatchObject({ entity: 'missing-table', field: 'startedAt' });
  });

  it.each([
    ['Started', 'Running', false, false],
    ['Failed to Start', 'Failed to Start', false, true],
    ['Broke', 'Closed', true, true],
    ['Closed', 'Closed', true, true],
    ['Merged', 'Forming', false, false],
    ['Created', 'Forming', false, false]
  ] as const)(
    'records %s with canonical table, player, and dealer propagation',
    (type, expectedStatus, closesPlayers, closesDealer) => {
      const openPlayer = {
        id: 'player-open',
        playerName: 'Open Player',
        gameId: game.id,
        tableId: table.id,
        seatedAt: '2026-08-08T21:00:00.000Z'
      };
      const openDealer = {
        id: 'dealer-open',
        tableId: table.id,
        gameId: game.id,
        dealerName: 'Dealer',
        startedAt: '2026-08-08T21:00:00.000Z'
      };
      const source = state({ playerSessions: [openPlayer], dealerAssignments: [openDealer] });

      const result = recordTableLifecycleEvent(
        source,
        table,
        type as TableEventType,
        'Lifecycle reason',
        'Lifecycle note',
        dependencies()
      );

      expect(result.sessions[0].status).toBe(expectedStatus);
      expect(result.sessions[0].endedAt).toBe(
        type === 'Failed to Start' || type === 'Broke' || type === 'Closed' ? now : undefined
      );
      expect(result.playerSessions[0]).toEqual(closesPlayers ? { ...openPlayer, leftAt: now } : openPlayer);
      expect(result.dealerAssignments[0]).toEqual(closesDealer ? { ...openDealer, endedAt: now } : openDealer);
      expect(result.tableEvents[0]).toEqual({
        id: 'created-1',
        type,
        gameId: game.id,
        tableId: table.id,
        timestamp: now,
        playerCount: table.seatsFilled,
        reason: 'Lifecycle reason',
        note: 'Lifecycle note'
      });
    }
  );
});
