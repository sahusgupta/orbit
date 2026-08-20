import { describe, expect, it } from 'vitest';
import type {
  GameConfig,
  GameSession,
  NightCloseRecord,
  PlayerLedgerEntry
} from '../../domain/types';
import {
  buildFloorActivityItems,
  filterFloorActivityItems,
  type FloorActivityState
} from './floorActivity';

const games: GameConfig[] = [
  {
    id: 'game-holdem',
    name: '$1/$2 Holdem',
    maxSeats: 8,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  },
  {
    id: 'game-plo',
    name: '$2/$5 PLO',
    maxSeats: 8,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  }
];

const tables: GameSession[] = [
  {
    id: 'table-a',
    gameId: 'game-holdem',
    label: 'Table 1',
    status: 'Running',
    seatsFilled: 2,
    maxSeats: 8,
    collectionMode: 'Drop',
    tags: [],
    startedAt: '2026-08-18T15:00:00.000Z'
  },
  {
    id: 'table-b',
    gameId: 'game-plo',
    label: 'Table 2',
    status: 'Running',
    seatsFilled: 3,
    maxSeats: 8,
    collectionMode: 'Time',
    tags: [],
    startedAt: '2026-08-18T15:00:00.000Z'
  }
];

const lockedNightClose = (lockedAt: string): NightCloseRecord => ({
  id: `close-${lockedAt}`,
  date: lockedAt.slice(0, 10),
  status: 'Locked',
  createdAt: lockedAt,
  updatedAt: lockedAt,
  lockedAt,
  notes: '',
  tables: [],
  warnings: [],
  audit: []
});

const state = (overrides: Partial<FloorActivityState> = {}): FloorActivityState => ({
  games,
  sessions: tables,
  playerLedger: [],
  tableEvents: [],
  dropLogs: [],
  nightCloses: [],
  ...overrides
});

describe('floor activity presentation projection', () => {
  it('maps current activity sources with exact event and direct table scope fields', () => {
    const items = buildFloorActivityItems(state({
      playerLedger: [
        {
          id: 'room-check-in',
          type: 'Check-In',
          playerName: 'Room Player',
          gameId: 'game-holdem',
          timestamp: '2026-08-18T16:04:00.000Z',
          note: 'Checked in at club entry'
        },
        {
          id: 'table-buy-in',
          type: 'Buy-In',
          playerName: 'Table Player',
          tableId: 'table-a',
          gameId: 'game-holdem',
          amount: 500,
          timestamp: '2026-08-18T16:03:00.000Z',
          note: 'Top-up'
        },
        {
          id: 'unknown-table-cash-out',
          type: 'Cash-Out',
          playerName: 'Former Player',
          tableId: 'table-not-loaded',
          gameId: 'game-holdem',
          amount: 400,
          timestamp: '2026-08-18T15:59:00.000Z'
        }
      ],
      tableEvents: [
        {
          id: 'started',
          type: 'Started',
          gameId: 'game-plo',
          tableId: 'table-b',
          timestamp: '2026-08-18T16:05:00.000Z',
          playerCount: 3,
          reason: 'Players ready',
          note: 'Table opened'
        },
        {
          id: 'unscoped-created',
          type: 'Created',
          gameId: 'game-plo',
          timestamp: '2026-08-18T16:02:00.000Z',
          playerCount: 0,
          note: 'Table forming'
        }
      ],
      dropLogs: [{
        id: 'drop',
        tableId: 'table-a',
        gameId: 'game-holdem',
        amount: 75,
        timestamp: '2026-08-18T16:01:00.000Z',
        note: 'Scheduled pull'
      }]
    }));

    expect(items.map((item) => item.id)).toEqual([
      'table-started',
      'ledger-room-check-in',
      'ledger-table-buy-in',
      'table-unscoped-created',
      'drop-drop',
      'ledger-unknown-table-cash-out'
    ]);
    expect(items[0]).toMatchObject({
      eventType: 'Started',
      sourceType: 'Started',
      scope: 'table',
      tableId: 'table-b',
      tableLabel: 'Table 2',
      actor: '$2/$5 PLO',
      detail: 'Table opened - Players ready - 3 players'
    });
    expect(items[1]).toMatchObject({
      eventType: 'Check-In',
      sourceType: 'Check-In',
      scope: 'room',
      actor: 'Room Player',
      detail: '$1/$2 Holdem - Checked in at club entry'
    });
    expect(items[1]).not.toHaveProperty('tableId');
    expect(items[1]).not.toHaveProperty('tableLabel');
    expect(items[2]).toMatchObject({
      eventType: 'Buy-In',
      sourceType: 'Buy-In',
      scope: 'table',
      tableId: 'table-a',
      tableLabel: 'Table 1',
      detail: '$1/$2 Holdem $500 - Top-up'
    });
    expect(items[3]).toMatchObject({
      eventType: 'Created',
      sourceType: 'Created',
      scope: 'unassigned-table'
    });
    expect(items[3]).not.toHaveProperty('tableId');
    expect(items[3]).not.toHaveProperty('tableLabel');
    expect(items[4]).toMatchObject({
      eventType: 'Drop',
      sourceType: 'Drop',
      scope: 'table',
      tableId: 'table-a',
      tableLabel: 'Table 1',
      detail: '$75 - Scheduled pull'
    });
    expect(items[5]).toMatchObject({
      tableId: 'table-not-loaded',
      eventType: 'Cash-Out',
      sourceType: 'Cash-Out',
      scope: 'table'
    });
    expect(items[5]).not.toHaveProperty('tableLabel');
  });

  it('classifies only authoritative table-scoped seating and exact Merged reasons', () => {
    const items = buildFloorActivityItems(state({
      playerLedger: [
        {
          id: 'room-check-in',
          type: 'Check-In',
          playerName: 'Room Player',
          timestamp: '2026-08-18T16:06:00.000Z'
        },
        {
          id: 'seated-check-in',
          type: 'Check-In',
          playerName: 'Seated Player',
          tableId: 'table-a',
          gameId: 'game-holdem',
          timestamp: '2026-08-18T16:05:00.000Z'
        }
      ],
      tableEvents: [
        {
          id: 'time-added',
          type: 'Merged',
          gameId: 'game-holdem',
          tableId: 'table-a',
          timestamp: '2026-08-18T16:04:00.000Z',
          playerCount: 2,
          reason: 'time added',
          note: '30 minutes added for Seated Player'
        },
        {
          id: 'player-moved',
          type: 'Merged',
          gameId: 'game-plo',
          tableId: 'table-b',
          timestamp: '2026-08-18T16:03:00.000Z',
          playerCount: 3,
          reason: 'player moved',
          note: 'Player moved from Table 1 to Table 2'
        },
        {
          id: 'game-switched',
          type: 'Merged',
          gameId: 'game-plo',
          tableId: 'table-b',
          timestamp: '2026-08-18T16:02:00.000Z',
          playerCount: 3,
          reason: 'game switched',
          note: 'Table 2 switched to PLO'
        },
        {
          id: 'other-merged',
          type: 'Merged',
          gameId: 'game-plo',
          tableId: 'table-b',
          timestamp: '2026-08-18T16:01:00.000Z',
          playerCount: 3,
          reason: 'other exact value',
          note: 'Legacy event'
        }
      ]
    }));

    expect(items.map(({ id, label, eventType, sourceType, scope }) => ({
      id,
      label,
      eventType,
      sourceType,
      scope
    }))).toEqual([
      { id: 'ledger-room-check-in', label: 'Check-In', eventType: 'Check-In', sourceType: 'Check-In', scope: 'room' },
      { id: 'ledger-seated-check-in', label: 'Seated', eventType: 'Seated', sourceType: 'Check-In', scope: 'table' },
      { id: 'table-time-added', label: 'Time added', eventType: 'Time added', sourceType: 'Merged', scope: 'table' },
      { id: 'table-player-moved', label: 'Player moved', eventType: 'Player moved', sourceType: 'Merged', scope: 'table' },
      { id: 'table-game-switched', label: 'Game switched', eventType: 'Game switched', sourceType: 'Merged', scope: 'table' },
      { id: 'table-other-merged', label: 'Merged', eventType: 'Merged', sourceType: 'Merged', scope: 'table' }
    ]);
    expect(filterFloorActivityItems(items, { eventType: 'Seated' }).map((item) => item.id)).toEqual([
      'ledger-seated-check-in'
    ]);
    expect(filterFloorActivityItems(items, { eventType: 'Merged' }).map((item) => item.id)).toEqual([
      'table-other-merged'
    ]);
  });

  it('uses the newest locked night close as an exclusive activity boundary', () => {
    const draftClose: NightCloseRecord = {
      ...lockedNightClose('2026-08-18T15:30:00.000Z'),
      id: 'draft-close',
      status: 'Draft',
      lockedAt: '2026-08-18T17:00:00.000Z'
    };
    const entries: PlayerLedgerEntry[] = [
      {
        id: 'before',
        type: 'Check-In',
        playerName: 'Before',
        timestamp: '2026-08-18T15:59:59.000Z'
      },
      {
        id: 'at-close',
        type: 'Check-In',
        playerName: 'At close',
        timestamp: '2026-08-18T16:00:00.000Z'
      },
      {
        id: 'after',
        type: 'Check-In',
        playerName: 'After',
        timestamp: '2026-08-18T16:00:01.000Z'
      }
    ];

    const items = buildFloorActivityItems(state({
      playerLedger: entries,
      nightCloses: [
        lockedNightClose('2026-08-18T15:00:00.000Z'),
        draftClose,
        lockedNightClose('2026-08-18T16:00:00.000Z')
      ]
    }));

    expect(items.map((item) => item.id)).toEqual(['ledger-after']);
    expect(entries.map((entry) => entry.id)).toEqual(['before', 'at-close', 'after']);
  });

  it('filters the complete projection by exact table and event type without a global cap', () => {
    const recentOtherTableEntries: PlayerLedgerEntry[] = Array.from({ length: 24 }, (_, index) => ({
      id: `recent-${index}`,
      type: 'Check-In',
      playerName: `Recent ${index}`,
      tableId: 'table-b',
      gameId: 'game-plo',
      timestamp: new Date(Date.UTC(2026, 7, 18, 18, 0, 59 - index)).toISOString()
    }));
    const scopedEntries: PlayerLedgerEntry[] = [
      {
        id: 'older-cash-out',
        type: 'Cash-Out',
        playerName: 'Cash Player',
        tableId: 'table-a',
        gameId: 'game-holdem',
        amount: 300,
        timestamp: '2026-08-18T17:00:01.000Z'
      },
      {
        id: 'older-buy-in',
        type: 'Buy-In',
        playerName: 'Buy-in Player',
        tableId: 'table-a',
        gameId: 'game-holdem',
        amount: 200,
        timestamp: '2026-08-18T17:00:00.000Z'
      },
      {
        id: 'room-buy-in',
        type: 'Buy-In',
        playerName: 'Unscoped Player',
        gameId: 'game-holdem',
        amount: 100,
        timestamp: '2026-08-18T16:59:59.000Z'
      }
    ];
    const sourceEntries = [...recentOtherTableEntries, ...scopedEntries];
    const sourceOrder = sourceEntries.map((entry) => entry.id);
    const items = buildFloorActivityItems(state({ playerLedger: sourceEntries }));

    expect(items).toHaveLength(27);
    expect(filterFloorActivityItems(items, { tableId: 'table-a' }).map((item) => item.id)).toEqual([
      'ledger-older-cash-out',
      'ledger-older-buy-in'
    ]);
    expect(filterFloorActivityItems(items, { eventType: 'Buy-In' }).map((item) => item.id)).toEqual([
      'ledger-older-buy-in',
      'ledger-room-buy-in'
    ]);
    expect(filterFloorActivityItems(items, {
      tableId: 'table-a',
      eventType: 'Buy-In'
    }).map((item) => item.id)).toEqual(['ledger-older-buy-in']);
    expect(filterFloorActivityItems(items, {
      tableId: 'table-b',
      eventType: 'Drop'
    })).toEqual([]);
    expect(sourceEntries.map((entry) => entry.id)).toEqual(sourceOrder);
  });
});
