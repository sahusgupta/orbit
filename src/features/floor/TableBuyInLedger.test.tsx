/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, GameSession, PlayerSession } from '../../domain/types';
import TableBuyInLedger from './TableBuyInLedger';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

describe('table buy-in ledger', () => {
  it('shows exact initial and add-on time purchases without repricing either one', () => {
    const session: GameSession = {
      id: 'table-1',
      gameId: 'game-1',
      label: 'Table 1',
      status: 'Running',
      seatsFilled: 1,
      maxSeats: 8,
      collectionMode: 'Time',
      tags: [],
      startedAt: '2026-08-19T18:00:00.000Z'
    };
    const playerSession: PlayerSession = {
      id: 'player-session-1',
      playerName: 'Alex',
      gameId: session.gameId,
      tableId: session.id,
      seatNumber: 1,
      seatedAt: '2026-08-19T18:00:00.000Z',
      timePurchasedMinutes: 90
    };
    const state: AppState = {
      ...structuredClone(seedState),
      games: [{
        id: session.gameId,
        name: 'Holdem',
        maxSeats: 8,
        minInRoomForLikely: 4,
        minFlexibleForLikely: 2,
        minTotalForViable: 6
      }],
      sessions: [session],
      playerSessions: [playerSession],
      timeFeeLogs: [{
        id: 'initial-time',
        playerSessionId: playerSession.id,
        tableId: session.id,
        gameId: session.gameId,
        playerName: playerSession.playerName,
        minutes: 60,
        amount: 10,
        timestamp: playerSession.seatedAt
      }, {
        id: 'added-time',
        playerSessionId: playerSession.id,
        tableId: session.id,
        gameId: session.gameId,
        playerName: playerSession.playerName,
        minutes: 30,
        amount: 6,
        timestamp: '2026-08-19T18:45:00.000Z'
      }],
      settings: { ...structuredClone(seedState.settings), defaultHourlyFee: 12 }
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(
      <TableBuyInLedger state={state} session={session} formatClock={(timestamp) => timestamp ?? ''} />
    ));

    expect(container.textContent).toContain('House revenue$16');
    expect(container.textContent).toContain('60 minutes purchased');
    expect(container.textContent).toContain('30 minutes purchased');
    expect(container.querySelectorAll('.cash-ledger-entry.in')).toHaveLength(2);
  });

  it('shows an omitted cash-out as not recorded while preserving an explicit zero', () => {
    const session: GameSession = {
      id: 'table-cash-out',
      gameId: 'game-cash-out',
      label: 'Cash-out Table',
      status: 'Running',
      seatsFilled: 0,
      maxSeats: 8,
      collectionMode: 'Drop',
      tags: [],
      startedAt: '2026-08-19T18:00:00.000Z'
    };
    const state: AppState = {
      ...structuredClone(seedState),
      sessions: [session],
      playerLedger: [{
        id: 'cash-out-omitted',
        type: 'Cash-Out',
        playerName: 'Amount Missing',
        tableId: session.id,
        gameId: session.gameId,
        timestamp: '2026-08-19T19:00:00.000Z'
      }, {
        id: 'cash-out-zero',
        type: 'Cash-Out',
        playerName: 'Zero Recorded',
        tableId: session.id,
        gameId: session.gameId,
        amount: 0,
        timestamp: '2026-08-19T18:55:00.000Z'
      }]
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(
      <TableBuyInLedger state={state} session={session} formatClock={(timestamp) => timestamp ?? ''} />
    ));

    const cashOutRows = Array.from(container.querySelectorAll('.cash-ledger-entry.out'));
    expect(cashOutRows).toHaveLength(2);
    expect(cashOutRows[0]?.querySelector('em')?.textContent).toBe('Not recorded');
    expect(cashOutRows[1]?.querySelector('em')?.textContent).toBe('−$0');
    expect(container.querySelector('.cash-ledger-summary')?.textContent).toContain('Cash-outs$0 + 1 not recorded');
    expect(container.querySelector('.cash-ledger-balance strong')?.textContent).toBe('Incomplete');
    expect(container.querySelector('.cash-ledger-reconcile')?.textContent).toContain(
      '1 cash-out amount not recorded; cash in play cannot be reconciled.'
    );
  });
});
