/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { GameConfig, GameSession, PlayerSession } from '../domain/types';
import FloorClassicOverview from './FloorClassicOverview';

const game: GameConfig = {
  id: 'game-1',
  name: '$1/$2 Holdem',
  maxSeats: 8,
  minInRoomForLikely: 4,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};
const session: GameSession = {
  id: 'table-1',
  physicalTableId: 'physical-table-1',
  gameId: game.id,
  label: 'Main Table',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: 8,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-22T18:00:00.000Z'
};
const playerSession: PlayerSession = {
  id: 'player-1',
  playerName: 'Alex',
  gameId: game.id,
  tableId: session.id,
  seatNumber: 3,
  seatedAt: '2026-08-22T18:05:00.000Z',
  timeFeeEnabled: true
};

describe('FloorClassicOverview', () => {
  it('restores a list-based table view with room-wide player timers and existing management entry points', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenTable = vi.fn();
    const onManageTables = vi.fn();
    act(() => {
      root.render(
        <FloorClassicOverview
          sessions={[session]}
          games={[game]}
          playerSessions={[playerSession]}
          clockNow={Date.parse('2026-08-22T18:30:00.000Z')}
          getTimeRemainingSeconds={() => 599}
          formatTimeLeft={(seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
          onOpenTable={onOpenTable}
          onManageTables={onManageTables}
          onClearTable={vi.fn()}
          onDeleteTable={vi.fn()}
          onMergeTable={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Classic floor');
    expect(container.textContent).toContain('Main Table');
    expect(container.textContent).toContain('Alex');
    expect(container.querySelector('.floor-classic-player em')?.textContent).toBe('9:59');
    expect(container.querySelector('.floor-classic-player em')?.className).toBe('yellow');
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Open Main Table"]')?.click();
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Manage tables'))?.click();
    });
    expect(onOpenTable).toHaveBeenCalledWith(session.id);
    expect(onManageTables).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it('offers clear, delete, and merge on right click while displaying only compatible merge targets', () => {
    const compatibleTarget: GameSession = {
      ...session,
      id: 'table-compatible',
      physicalTableId: 'physical-compatible',
      label: 'Compatible Table',
      seatsFilled: 0
    };
    const wrongGameTarget: GameSession = {
      ...compatibleTarget,
      id: 'table-wrong-game',
      label: 'Wrong Game Table',
      gameId: 'game-2'
    };
    const wrongModeTarget: GameSession = {
      ...compatibleTarget,
      id: 'table-wrong-mode',
      label: 'Wrong Mode Table',
      collectionMode: 'Drop'
    };
    const fullTarget: GameSession = {
      ...compatibleTarget,
      id: 'table-full',
      label: 'Full Table',
      maxSeats: 1,
      seatsFilled: 1
    };
    const fullTargetPlayer: PlayerSession = {
      ...playerSession,
      id: 'player-full-target',
      tableId: fullTarget.id,
      playerName: 'Full Seat'
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClearTable = vi.fn();
    const onDeleteTable = vi.fn();
    const onMergeTable = vi.fn();
    act(() => {
      root.render(
        <FloorClassicOverview
          sessions={[session, compatibleTarget, wrongGameTarget, wrongModeTarget, fullTarget]}
          games={[game]}
          playerSessions={[playerSession, fullTargetPlayer]}
          clockNow={Date.parse('2026-08-22T18:30:00.000Z')}
          getTimeRemainingSeconds={() => 599}
          formatTimeLeft={(seconds) => `${seconds}`}
          onOpenTable={vi.fn()}
          onManageTables={vi.fn()}
          onClearTable={onClearTable}
          onDeleteTable={onDeleteTable}
          onMergeTable={onMergeTable}
        />
      );
    });

    const sourceCard = container.querySelector<HTMLElement>('[data-session-id="table-1"]');
    const openContextMenu = () => {
      act(() => {
        sourceCard?.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          clientX: 120,
          clientY: 80
        }));
      });
      return document.querySelector<HTMLElement>('[role="menu"][aria-label="Main Table table actions"]');
    };

    let menu = openContextMenu();
    expect(Array.from(menu?.querySelectorAll('button') ?? [], (button) => button.textContent?.trim()))
      .toEqual(['Clear table', 'Delete table', 'Merge table']);
    act(() => {
      Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent?.includes('Clear table'))?.click();
    });
    expect(onClearTable).toHaveBeenCalledWith(session.id);

    menu = openContextMenu();
    act(() => {
      Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent?.includes('Delete table'))?.click();
    });
    expect(onDeleteTable).toHaveBeenCalledWith(session.physicalTableId);

    menu = openContextMenu();
    act(() => {
      Array.from(menu?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent?.includes('Merge table'))?.click();
    });
    const destination = document.querySelector<HTMLSelectElement>('select[aria-label="Merge destination table"]');
    expect(Array.from(destination?.options ?? [], (option) => option.textContent)).toEqual([
      'Compatible Table (8 open)'
    ]);
    expect(destination?.value).toBe(compatibleTarget.id);
    act(() => {
      document.querySelector<HTMLButtonElement>('.floor-map-dialog button[type="submit"]')?.click();
    });
    expect(onMergeTable).toHaveBeenCalledWith(session.id, compatibleTarget.id);

    act(() => root.unmount());
    container.remove();
  });

  it('opens table actions from the keyboard, supports menu navigation, and restores focus on Escape', () => {
    const compatibleTarget: GameSession = {
      ...session,
      id: 'table-compatible',
      label: 'Compatible Table',
      seatsFilled: 0
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <FloorClassicOverview
          sessions={[session, compatibleTarget]}
          games={[game]}
          playerSessions={[playerSession]}
          clockNow={Date.parse('2026-08-22T18:30:00.000Z')}
          getTimeRemainingSeconds={() => 599}
          formatTimeLeft={(seconds) => `${seconds}`}
          onOpenTable={vi.fn()}
          onManageTables={vi.fn()}
          onClearTable={vi.fn()}
          onDeleteTable={vi.fn()}
          onMergeTable={vi.fn()}
        />
      );
    });

    const sourceCard = container.querySelector<HTMLElement>('[data-session-id="table-1"]');
    act(() => {
      sourceCard?.focus();
      sourceCard?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'F10',
        shiftKey: true
      }));
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Main Table table actions"]');
    expect(document.activeElement?.textContent?.trim()).toBe('Clear table');
    act(() => {
      menu?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    });
    expect(document.activeElement?.textContent?.trim()).toBe('Delete table');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(document.querySelector('[role="menu"][aria-label="Main Table table actions"]')).toBeNull();
    expect(document.activeElement).toBe(sourceCard);

    act(() => root.unmount());
    container.remove();
  });
});
