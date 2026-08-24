import { describe, expect, it } from 'vitest';
import { buildNightCloseTables } from './nightClose';

const state = {
  games: [{ id: 'game-1', name: '1/2 NLH' }],
  sessions: [{ id: 'table-1', gameId: 'game-1', label: 'Main Table', status: 'Running', collectionMode: 'Time' as const, startedAt: '2026-07-19T01:00:00Z' }],
  playerSessions: [
    { id: 'alex-session', playerName: 'Alex', profileId: 'alex', gameId: 'game-1', tableId: 'table-1', seatedAt: '2026-07-19T01:05:00Z', timePurchasedMinutes: 60 },
    { id: 'sam-session', playerName: 'Sam', profileId: 'sam', gameId: 'game-1', tableId: 'table-1', seatedAt: '2026-07-19T01:10:00Z', timePurchasedMinutes: 0 }
  ],
  buyIns: [
    { tableId: 'table-1', amount: 500, timestamp: '2026-07-19T01:05:00Z' },
    { tableId: 'table-1', amount: 200, timestamp: '2026-07-19T02:00:00Z' }
  ],
  dropLogs: [{ tableId: 'table-1', amount: 20, timestamp: '2026-07-19T02:30:00Z' }],
  timeFeeLogs: [],
  playerLedger: [{ tableId: 'table-1', type: 'Cash-Out', profileId: 'alex', playerName: 'Alex', amount: 400, timestamp: '2026-07-19T03:00:00Z' }],
  nightCloses: [],
  settings: { defaultHourlyFee: 10, collectionProfiles: [{ gameId: 'game-1', hourlyFee: 12 }] }
};

describe('buildNightCloseTables', () => {
  it('uses the flat room time fee without counting recorded drop twice', () => {
    const [table] = buildNightCloseTables(state, { 'table-1': '310' });
    expect(table.buyIns).toBe(700);
    expect(table.cashOuts).toBe(400);
    expect(table.drop).toBe(20);
    expect(table.timeFees).toBe(10);
    expect(table.expectedCash).toBe(310);
    expect(table.discrepancy).toBe(0);
  });

  it('reconciles the house cash when buy-ins and cash-outs balance and time was paid separately', () => {
    const [table] = buildNightCloseTables({
      ...state,
      playerSessions: [
        { id: 'winner-session', playerName: 'Winner', profileId: 'winner', gameId: 'game-1', tableId: 'table-1', seatedAt: '2026-07-19T01:05:00Z', timePurchasedMinutes: 225 },
        { id: 'other-session', playerName: 'Other player', profileId: 'other', gameId: 'game-1', tableId: 'table-1', seatedAt: '2026-07-19T01:10:00Z', timePurchasedMinutes: 0 }
      ],
      buyIns: [
        { tableId: 'table-1', amount: 500, timestamp: '2026-07-19T01:05:00Z' },
        { tableId: 'table-1', amount: 300, timestamp: '2026-07-19T01:10:00Z' }
      ],
      dropLogs: [],
      playerLedger: [
        { tableId: 'table-1', type: 'Cash-Out', profileId: 'winner', playerName: 'Winner', amount: 800, timestamp: '2026-07-19T03:00:00Z' },
        { tableId: 'table-1', type: 'Cash-Out', profileId: 'other', playerName: 'Other player', amount: 0, timestamp: '2026-07-19T03:00:00Z' }
      ]
    }, { 'table-1': '37.5' });

    expect(table.buyIns).toBe(800);
    expect(table.cashOuts).toBe(800);
    expect(table.timeFees).toBe(37.5);
    expect(table.expectedCash).toBe(37.5);
    expect(table.discrepancy).toBe(0);
  });

  it('preserves logged purchase amounts across rate changes and falls back only for legacy sessions', () => {
    const [table] = buildNightCloseTables({
      ...state,
      playerSessions: [
        { ...state.playerSessions[0], timePurchasedMinutes: 120 },
        { ...state.playerSessions[1], timePurchasedMinutes: 60 }
      ],
      timeFeeLogs: [
        { id: 'time-1', playerSessionId: 'alex-session', tableId: 'table-1', gameId: 'game-1', playerName: 'Alex', minutes: 60, amount: 10, timestamp: '2026-07-19T01:30:00Z' },
        { id: 'time-2', playerSessionId: 'alex-session', tableId: 'table-1', gameId: 'game-1', playerName: 'Alex', minutes: 60, amount: 15, timestamp: '2026-07-19T02:30:00Z' }
      ],
      settings: { ...state.settings, defaultHourlyFee: 20 }
    }, {});

    expect(table.timeFees).toBe(45);
  });

  it('uses reduced cash-outs to recognize drop as house cash', () => {
    const [table] = buildNightCloseTables({
      ...state,
      sessions: [{ ...state.sessions[0], collectionMode: 'Drop' as const }],
      playerSessions: [],
      buyIns: [{ tableId: 'table-1', amount: 800, timestamp: '2026-07-19T01:05:00Z' }],
      dropLogs: [{ tableId: 'table-1', amount: 45, timestamp: '2026-07-19T02:30:00Z' }],
      playerLedger: [{ tableId: 'table-1', type: 'Cash-Out', playerName: 'Players', amount: 755, timestamp: '2026-07-19T03:00:00Z' }]
    }, { 'table-1': '45' });

    expect(table.drop).toBe(45);
    expect(table.timeFees).toBe(0);
    expect(table.expectedCash).toBe(45);
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

  it('keeps a cash-out with an omitted amount explicitly unresolved', () => {
    const [table] = buildNightCloseTables({
      ...state,
      playerSessions: [state.playerSessions[0]],
      playerLedger: [{
        tableId: 'table-1',
        type: 'Cash-Out',
        profileId: 'alex',
        playerName: 'Alex',
        timestamp: '2026-07-19T03:00:00Z'
      }]
    }, { 'table-1': '710' });

    expect(table.cashOuts).toBe(0);
    expect(table.warnings).toContain('1 player missing cash-out amount');
    expect(table.warnings).not.toContain('1 player missing cash-out');
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
