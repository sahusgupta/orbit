/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTimerStatusFromSeconds } from '../lib/appCore';
import type { BuyInLog, GameConfig, GameSession, PlayerSession } from '../domain/types';
import TableView from './TableView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];

const tableGame: GameConfig = {
  id: 'game-1',
  name: 'No Limit Holdem',
  maxSeats: 8,
  minInRoomForLikely: 4,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};

const tableSession: GameSession = {
  id: 'table-1',
  gameId: tableGame.id,
  label: 'Main Table',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: 8,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-18T18:00:00.000Z'
};

const playerSession: PlayerSession = {
  id: 'player-session-1',
  playerName: 'Alex Rivera',
  profileId: 'member-1',
  gameId: tableGame.id,
  tableId: tableSession.id,
  seatNumber: 3,
  seatedAt: '2026-08-18T18:00:00.000Z',
  timeFeeEnabled: true,
  timeRemainingMinutes: 4
};

const buyIn: BuyInLog = {
  id: 'buy-in-1',
  playerName: playerSession.playerName,
  profileId: playerSession.profileId,
  tableId: tableSession.id,
  gameId: tableGame.id,
  amount: 500,
  timestamp: '2026-08-18T18:05:00.000Z'
};

const formatTimeLeft = (seconds: number) => {
  if (seconds <= 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

type HarnessProps = {
  isTimeCollection: boolean;
  onAddPlayerTime?: (session: PlayerSession, minutes: number) => void;
  onOpenSeatPicker?: (session: GameSession, requestedSeatNumber?: number) => void;
  timePlayers: Array<{
    playerSession: PlayerSession;
    remainingSeconds: number;
    elapsedSeconds: number;
    hasTimer: boolean;
  }>;
};

function Harness({ isTimeCollection, onAddPlayerTime = vi.fn(), onOpenSeatPicker = vi.fn(), timePlayers }: HarnessProps) {
  const [eventLogSessionId, setEventLogSessionId] = useState<string | null>(null);
  const [ledgerSessionId, setLedgerSessionId] = useState<string | null>(null);

  return (
    <TableView
      tableGame={tableGame}
      tableSession={{ ...tableSession, collectionMode: isTimeCollection ? 'Time' : 'Drop' }}
      seatedPlayers={timePlayers.map((item) => item.playerSession)}
      tableAverageStack={500}
      isTimeCollection={isTimeCollection}
      seatPickerModal={null}
      cashOutModal={null}
      tableLedgerModal={ledgerSessionId ? <div data-ledger-session={ledgerSessionId}>Ledger open</div> : null}
      tableActivity={[{
        id: 'activity-1',
        timestamp: buyIn.timestamp,
        type: 'Buy-in',
        text: 'Alex Rivera bought in for $500'
      }]}
      tableBuyInRows={[{ entry: buyIn, seatNumber: 3 }]}
      tableTimePlayers={timePlayers}
      pokerTablePlayers={timePlayers.map((item) => ({
        id: item.playerSession.id,
        name: item.playerSession.playerName,
        seatNumber: item.playerSession.seatNumber,
        membershipId: item.playerSession.profileId ?? item.playerSession.id,
        joinedAt: new Date(item.playerSession.seatedAt).getTime(),
        timeRemainingSeconds: item.remainingSeconds,
        buyInTotal: 500
      }))}
      tableEventLogSessionId={eventLogSessionId}
      seatPicker={null}
      closeRoute={vi.fn()}
      formatClock={() => '6:05 PM'}
      formatTimeLeft={formatTimeLeft}
      getTimerStatusFromSeconds={getTimerStatusFromSeconds}
      getMoveTargets={() => []}
      openSeatPicker={onOpenSeatPicker}
      addPlayerTime={onAddPlayerTime}
      addBuyIn={vi.fn()}
      requestPlayerCashOut={vi.fn()}
      changePlayerSeat={vi.fn()}
      movePlayerToTable={vi.fn()}
      setTableEventLogSessionId={setEventLogSessionId}
      setTableLedgerSessionId={setLedgerSessionId}
    />
  );
}

function renderHarness(props: HarnessProps) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(<Harness {...props} />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.innerHTML = '';
});

describe('TableView progressive disclosure', () => {
  it('replaces permanent rails with compact, dismissible table utilities', () => {
    const openSeatPicker = vi.fn();
    const container = renderHarness({
      isTimeCollection: true,
      onOpenSeatPicker: openSeatPicker,
      timePlayers: [{
        playerSession,
        remainingSeconds: 240,
        elapsedSeconds: 3600,
        hasTimer: true
      }]
    });

    expect(container.querySelector('.table-live-feed-overlay')).toBeNull();
    expect(container.querySelector('.table-buyin-float')).toBeNull();
    expect(container.querySelector('.table-view-time-overview')).toBeNull();
    expect(container.querySelector('button[aria-label="Activity, 1 event"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Ledger, 1 buy-in"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Timers, 1 due"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('.table-view-seat-player-button')?.click();
    });
    expect(openSeatPicker).toHaveBeenCalledWith(expect.objectContaining({ id: tableSession.id }));

    const activityButton = container.querySelector<HTMLButtonElement>('button[aria-label="Activity, 1 event"]');
    act(() => {
      activityButton?.click();
    });
    const activityDrawer = document.querySelector('.table-activity-drawer');
    expect(activityDrawer?.textContent).toContain('Alex Rivera bought in for $500');
    expect(activityDrawer?.classList.contains('is-expanded')).toBe(false);

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Expand table activity"]')?.click();
    });
    expect(activityDrawer?.classList.contains('is-expanded')).toBe(true);
    expect(document.querySelector('button[aria-label="Restore compact table activity"]')).not.toBeNull();

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Restore compact table activity"]')?.click();
    });
    expect(activityDrawer?.classList.contains('is-expanded')).toBe(false);

    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close table activity"]')?.click();
    });
    expect(document.querySelector('.table-activity-drawer')).toBeNull();
    expect(activityButton?.getAttribute('aria-expanded')).toBe('false');

    const timerButton = container.querySelector<HTMLButtonElement>('button[aria-label="Timers, 1 due"]');
    act(() => {
      timerButton?.click();
    });
    const timerDrawer = document.querySelector('.table-time-drawer');
    expect(timerDrawer?.querySelector('article.red strong')?.textContent).toBe('Alex Rivera');
    expect(timerDrawer?.querySelector('article.red em')?.textContent).toBe('4:00');
    expect(timerDrawer?.textContent).toContain('Needs attention');
    expect(timerDrawer?.querySelector('.table-time-expired-actions')).toBeNull();
    expect(timerDrawer?.querySelector<HTMLElement>('.table-utility-list')?.tabIndex).toBe(0);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(document.querySelector('.table-time-drawer')).toBeNull();
    expect(timerButton?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Ledger, 1 buy-in"]')?.click();
    });
    expect(container.querySelector('[data-ledger-session="table-1"]')?.textContent).toBe('Ledger open');
  });

  it('shows elapsed sessions in Drop mode while preserving active legacy countdowns', () => {
    const untimedPlayer = { ...playerSession, id: 'untimed-player', playerName: 'Casey', timeFeeEnabled: false };
    const legacyTimedPlayer = { ...playerSession, id: 'legacy-player', playerName: 'Morgan', seatNumber: 4 };
    const container = renderHarness({
      isTimeCollection: false,
      timePlayers: [
        { playerSession: untimedPlayer, remainingSeconds: 0, elapsedSeconds: 3661, hasTimer: false },
        { playerSession: legacyTimedPlayer, remainingSeconds: 600, elapsedSeconds: 1800, hasTimer: true }
      ]
    });

    const sessionsButton = container.querySelector<HTMLButtonElement>('button[aria-label="Sessions, 1 soon"]');
    expect(sessionsButton).not.toBeNull();
    act(() => {
      sessionsButton?.click();
    });

    const sessionDrawer = document.querySelector('.table-time-drawer');
    expect(sessionDrawer?.querySelector('article.neutral em')?.textContent).toBe('1:01:01');
    expect(sessionDrawer?.querySelector('article.neutral small')?.textContent).toBe('At table');
    expect(sessionDrawer?.querySelector('article.yellow em')?.textContent).toBe('10:00');
    expect(sessionDrawer?.querySelector('article.yellow small')?.textContent).toBe('Approaching');
  });

  it('offers inline time extensions only after a timer has expired', () => {
    const onAddPlayerTime = vi.fn();
    const expiredPlayer = {
      ...playerSession,
      id: 'expired-player',
      playerName: 'Expired Player'
    };
    const urgentPlayer = {
      ...playerSession,
      id: 'urgent-player',
      playerName: 'Urgent Player',
      seatNumber: 4
    };
    const container = renderHarness({
      isTimeCollection: true,
      onAddPlayerTime,
      timePlayers: [
        { playerSession: expiredPlayer, remainingSeconds: 0, elapsedSeconds: 3600, hasTimer: true },
        { playerSession: urgentPlayer, remainingSeconds: 240, elapsedSeconds: 3600, hasTimer: true }
      ]
    });

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Timers, 2 due"]')?.click();
    });

    const expiredRow = document.querySelector('article.expired');
    const urgentRow = Array.from(document.querySelectorAll<HTMLElement>('.table-time-list article'))
      .find((row) => row.textContent?.includes('Urgent Player'));
    expect(expiredRow?.textContent).toContain('Expired');
    expect(expiredRow?.querySelectorAll('.table-time-expired-actions button')).toHaveLength(2);
    expect(urgentRow?.textContent).toContain('Needs attention');
    expect(urgentRow?.querySelector('.table-time-expired-actions')).toBeNull();

    act(() => {
      expiredRow?.querySelector<HTMLButtonElement>('button[aria-label="Add 30 minutes to Expired Player"]')?.click();
      expiredRow?.querySelector<HTMLButtonElement>('button[aria-label="Add 60 minutes to Expired Player"]')?.click();
    });

    expect(onAddPlayerTime).toHaveBeenNthCalledWith(1, expiredPlayer, 30);
    expect(onAddPlayerTime).toHaveBeenNthCalledWith(2, expiredPlayer, 60);
  });
});
