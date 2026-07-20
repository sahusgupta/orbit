import { describe, expect, it } from 'vitest';
import { buildNightCloseTables } from './nightClose';

const state = {
  games: [{ id: 'game-1', name: '1/2 NLH' }],
  sessions: [{ id: 'table-1', gameId: 'game-1', label: 'Main Table', status: 'Running', collectionMode: 'Time' as const, startedAt: '2026-07-19T01:00:00Z' }],
  playerSessions: [
    { playerName: 'Alex', profileId: 'alex', tableId: 'table-1', seatedAt: '2026-07-19T01:05:00Z', timePurchasedMinutes: 60 },
    { playerName: 'Sam', profileId: 'sam', tableId: 'table-1', seatedAt: '2026-07-19T01:10:00Z', timePurchasedMinutes: 0 }
  ],
  buyIns: [
    { tableId: 'table-1', amount: 500, timestamp: '2026-07-19T01:05:00Z' },
    { tableId: 'table-1', amount: 200, timestamp: '2026-07-19T02:00:00Z' }
  ],
  dropLogs: [{ tableId: 'table-1', amount: 20, timestamp: '2026-07-19T02:30:00Z' }],
  playerLedger: [{ tableId: 'table-1', type: 'Cash-Out', profileId: 'alex', playerName: 'Alex', amount: 400, timestamp: '2026-07-19T03:00:00Z' }],
  nightCloses: [],
  settings: { defaultHourlyFee: 10, collectionProfiles: [{ gameId: 'game-1', hourlyFee: 12 }] }
};

describe('buildNightCloseTables', () => {
  it('reconciles raw transactions without combining buy-in events', () => {
    const [table] = buildNightCloseTables(state, { 'table-1': '268' });
    expect(table.buyIns).toBe(700);
    expect(table.cashOuts).toBe(400);
    expect(table.drop).toBe(20);
    expect(table.timeFees).toBe(12);
    expect(table.expectedCash).toBe(268);
    expect(table.discrepancy).toBe(0);
  });

  it('reports unresolved cash-out, time, actual-count, and open-table exceptions', () => {
    const [table] = buildNightCloseTables(state, {});
    expect(table.warnings).toEqual(expect.arrayContaining([
      'Table is still open',
      '1 player missing cash-out',
      '1 player missing time collection',
      'Actual cash count required'
    ]));
  });

  it('excludes transactions at or before the previous locked close', () => {
    const [table] = buildNightCloseTables({
      ...state,
      nightCloses: [{ status: 'Locked', lockedAt: '2026-07-19T02:15:00Z' }],
      sessions: [{ ...state.sessions[0], status: 'Closed', startedAt: '2026-07-19T01:00:00Z' }]
    }, {});
    expect(table).toBeUndefined();
  });
});
