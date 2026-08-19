/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameConfig, GameSession, PhysicalTable, PlayerSession, TableCap } from '../domain/types';
import FloorRoomMap from './FloorRoomMap';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const games: GameConfig[] = [{
  id: 'game-holdem',
  name: '$1/$2 Holdem',
  maxSeats: 6,
  minInRoomForLikely: 4,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
}];

const runningTable: GameSession = {
  id: 'table-running',
  gameId: 'game-holdem',
  label: 'Table 7',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: 6,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-18T18:00:00.000Z'
};

const closedTable: GameSession = {
  ...runningTable,
  id: 'table-closed',
  label: 'Table 8',
  status: 'Closed'
};

const seatedPlayer: PlayerSession = {
  id: 'player-session-1',
  playerName: 'Alex',
  gameId: 'game-holdem',
  tableId: runningTable.id,
  seatNumber: 2,
  seatedAt: '2026-08-18T18:05:00.000Z',
  timeFeeEnabled: true,
  timeRemainingMinutes: 30,
  lastTimeTickAt: '2026-08-18T18:05:00.000Z'
};

type RenderOptions = {
  sessions?: GameSession[];
  physicalTables?: PhysicalTable[];
  players?: PlayerSession[];
  storageKey?: string;
  remainingSeconds?: number;
  onOpenTable?: (sessionId: string) => void;
  onAddPhysicalTable?: (label: string, maxSeats: TableCap) => void;
  onStartGameAtTable?: (physicalTableId: string, gameId: string) => void;
};

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

const createMapElement = ({
  sessions = [runningTable],
  physicalTables = [],
  players = [seatedPlayer],
  storageKey = 'floor-layout:test',
  remainingSeconds = 3600,
  onOpenTable = vi.fn(),
  onAddPhysicalTable = vi.fn(),
  onStartGameAtTable = vi.fn()
}: RenderOptions = {}) => (
  <FloorRoomMap
    sessions={sessions}
    physicalTables={physicalTables}
    games={games}
    playerSessions={players}
    clockNow={Date.parse('2026-08-18T18:30:00.000Z')}
    layoutStorageKey={storageKey}
    getTimeRemainingSeconds={() => remainingSeconds}
    onOpenTable={onOpenTable}
    onAddPhysicalTable={onAddPhysicalTable}
    onStartGameAtTable={onStartGameAtTable}
  />
);

const renderMap = (options: RenderOptions = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createMapElement(options));
  });
  mountedRoots.push({ container, root });
  return container;
};

const getButton = (container: ParentNode, label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.replace(/\s+/g, ' ').trim() === label);

afterEach(() => {
  for (const { container, root } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('FloorRoomMap', () => {
  it('keeps permanent tables visible when empty and starts a selected game at the chosen identity', () => {
    const physicalTables = Array.from({ length: 6 }, (_, index): PhysicalTable => ({
      id: `physical-${index + 1}`,
      label: `Table ${index + 1}`,
      maxSeats: 6,
      createdAt: '2026-08-18T12:00:00.000Z'
    }));
    const onStartGameAtTable = vi.fn();
    const boundSession = { ...runningTable, physicalTableId: physicalTables[0].id, label: physicalTables[0].label };
    const container = renderMap({
      sessions: [boundSession],
      physicalTables,
      onStartGameAtTable
    });

    expect(container.querySelectorAll('.floor-map-table')).toHaveLength(6);
    expect(container.querySelectorAll('.floor-map-table.is-empty')).toHaveLength(5);
    expect(container.textContent).toContain('$1/$2 Holdem');
    expect(container.textContent).toContain('No game assigned');

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Start a game at Table 2"]')?.click();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Start a game at Table 2');
    act(() => {
      document.querySelector<HTMLButtonElement>('[role="dialog"] button[type="submit"]')?.click();
    });
    expect(onStartGameAtTable).toHaveBeenCalledWith('physical-2', games[0].id);
  });

  it('keeps an unexpected duplicate live binding visible instead of hiding operational state', () => {
    const physicalTable: PhysicalTable = {
      id: 'physical-1',
      label: 'Table 1',
      maxSeats: 6,
      createdAt: '2026-08-18T12:00:00.000Z'
    };
    const duplicateSession: GameSession = {
      ...runningTable,
      id: 'duplicate-session',
      label: 'Overflow session',
      physicalTableId: physicalTable.id
    };
    const container = renderMap({
      physicalTables: [physicalTable],
      players: [],
      sessions: [{ ...runningTable, physicalTableId: physicalTable.id }, duplicateSession]
    });

    expect(container.querySelectorAll('.floor-map-table')).toHaveLength(2);
    expect(container.textContent).toContain('Table 1');
    expect(container.textContent).toContain('Overflow session');
  });

  it('adds a named permanent table from the room-map action', () => {
    const onAddPhysicalTable = vi.fn();
    const container = renderMap({ sessions: [], players: [], onAddPhysicalTable });

    act(() => getButton(container, 'Add permanent table')?.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Add permanent table');
    const nameInput = dialog?.querySelector<HTMLInputElement>('input');
    act(() => {
      if (!nameInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(nameInput, 'Poker Room Table A');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => dialog?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());

    expect(onAddPhysicalTable).toHaveBeenCalledWith('Poker Room Table A', 10);
  });

  it('shows open live state on a spatial table object and opens the existing table route callback', () => {
    const onOpenTable = vi.fn();
    const container = renderMap({ sessions: [runningTable, closedTable], onOpenTable });

    expect(container.querySelectorAll('.floor-map-table')).toHaveLength(1);
    expect(container.textContent).toContain('$1/$2 Holdem');
    expect(container.textContent).toContain('1/6 seated');
    expect(container.textContent).not.toContain('Table 8');
    expect(container.querySelectorAll('.floor-map-seat')).toHaveLength(6);
    expect(container.querySelectorAll('.floor-map-seat.occupied')).toHaveLength(1);
    expect(container.querySelector<HTMLButtonElement>('.floor-map-table-identity')?.getAttribute('aria-label')).toContain(
      'Seat 2, Alex'
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('.floor-map-table-identity')?.click();
    });

    expect(onOpenTable).toHaveBeenCalledWith(runningTable.id);
  });

  it('allocates players with missing or invalid seat numbers to unused seat markers', () => {
    const unnumberedPlayer: PlayerSession = {
      ...seatedPlayer,
      id: 'player-session-unassigned',
      playerName: 'Sam',
      seatNumber: undefined
    };
    const explicitlySeatedPlayer: PlayerSession = {
      ...seatedPlayer,
      id: 'player-session-seat-one',
      playerName: 'Taylor',
      seatNumber: 1
    };
    const invalidSeatPlayer: PlayerSession = {
      ...seatedPlayer,
      id: 'player-session-invalid-seat',
      playerName: 'Morgan',
      seatNumber: 1.5
    };
    const container = renderMap({ players: [unnumberedPlayer, explicitlySeatedPlayer, invalidSeatPlayer] });

    expect(container.querySelectorAll('.floor-map-seat.occupied')).toHaveLength(3);
    expect(container.querySelector('.floor-map-seat[title="Seat 1: Taylor"]')).not.toBeNull();
    expect(container.querySelector('.floor-map-seat[title="Seat 2: Morgan"]')).not.toBeNull();
    expect(container.querySelector('.floor-map-seat[title="Seat 3: Sam"]')).not.toBeNull();
    expect(container.textContent).toContain('3/6 seated');
  });

  it('uses the existing timer threshold helper for restrained table and seat attention states', () => {
    const container = renderMap({ remainingSeconds: 4 * 60 });

    expect(container.querySelector('.floor-map-table.requires-action')).not.toBeNull();
    expect(container.querySelector('.floor-map-seat.occupied.red')).not.toBeNull();
    expect(container.textContent).toContain('1 timer due');
    expect(container.querySelector<HTMLButtonElement>('.floor-map-table-identity')?.getAttribute('aria-label')).toContain(
      'timer due'
    );
  });

  it('communicates approaching timer attention without relying on color alone', () => {
    const container = renderMap({ remainingSeconds: 10 * 60 });

    expect(container.querySelector('.floor-map-table.approaching-action')).not.toBeNull();
    expect(container.querySelector('.floor-map-seat.occupied.yellow')).not.toBeNull();
    expect(container.textContent).toContain('1 timer soon');
  });

  it('keeps layout changes as a cancellable draft and persists only after Save layout', () => {
    const storageKey = 'floor-layout:persistence';
    const container = renderMap({ storageKey });

    act(() => getButton(container, 'Edit layout')?.click());
    const table = container.querySelector<HTMLElement>('.floor-map-table');
    expect(table?.style.left).toBe('50%');
    expect(document.activeElement).toBe(table);

    act(() => {
      table?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(table?.style.left).toBe('52%');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('52 percent across');

    act(() => getButton(container, 'Cancel')?.click());
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('50%');
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(document.activeElement).toBe(getButton(container, 'Edit layout'));

    act(() => getButton(container, 'Edit layout')?.click());
    act(() => {
      container.querySelector<HTMLElement>('.floor-map-table')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
      );
    });
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('56%');
    act(() => {
      container.querySelector<HTMLElement>('.floor-map-table')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })
      );
    });
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('50%');
    act(() => {
      container.querySelector<HTMLElement>('.floor-map-table')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
      );
    });
    act(() => getButton(container, 'Save layout')?.click());

    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({
      [runningTable.id]: { x: 56, y: 50 }
    });
  });

  it('moves a table by drag and drop within the bounded room canvas', () => {
    const storageKey = 'floor-layout:drag';
    const container = renderMap({ storageKey });
    act(() => getButton(container, 'Edit layout')?.click());
    const table = container.querySelector<HTMLElement>('.floor-map-table');
    const canvas = container.querySelector<HTMLElement>('.floor-room-map-canvas');
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'none',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? ''
    };
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500, x: 0, y: 0, toJSON: () => ({}) })
    });
    Object.defineProperty(table, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 200, height: 100, right: 300, bottom: 200, x: 100, y: 100, toJSON: () => ({}) })
    });
    const dragStart = new MouseEvent('dragstart', { bubbles: true, cancelable: true, clientX: 150, clientY: 125 });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 700, clientY: 200 });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });

    act(() => {
      table?.dispatchEvent(dragStart);
      canvas?.dispatchEvent(drop);
    });

    expect(table?.style.left).toBe('76%');
    expect(table?.style.top).toBe('46%');
    act(() => getButton(container, 'Save layout')?.click());
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({
      [runningTable.id]: { x: 76, y: 46 }
    });
  });

  it('keeps a failed layout save in edit mode with an accessible error', () => {
    const storageKey = 'floor-layout:write-failure';
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    const container = renderMap({ storageKey });

    act(() => getButton(container, 'Edit layout')?.click());
    act(() => {
      container.querySelector<HTMLElement>('.floor-map-table')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    act(() => getButton(container, 'Save layout')?.click());

    expect(storageWrite).toHaveBeenCalledOnce();
    expect(container.querySelector('.floor-room-map.is-editing')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('draft is still open');
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('52%');
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('resets transient map state when the account-scoped storage key changes', () => {
    const firstKey = 'floor-layout:account-a';
    const secondKey = 'floor-layout:account-b';
    window.localStorage.setItem(firstKey, JSON.stringify({ [runningTable.id]: { x: 20, y: 50 } }));
    window.localStorage.setItem(secondKey, JSON.stringify({ [runningTable.id]: { x: 80, y: 50 } }));
    const container = renderMap({ storageKey: firstKey });
    const root = mountedRoots.at(-1)?.root;

    act(() => getButton(container, 'Edit layout')?.click());
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn(), getData: vi.fn(() => runningTable.id) };
    const dragStart = new MouseEvent('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    act(() => container.querySelector('.floor-map-table')?.dispatchEvent(dragStart));
    expect(container.querySelector('.floor-map-table.is-dragging')).not.toBeNull();

    act(() => root?.render(createMapElement({ storageKey: secondKey })));

    expect(container.querySelector('.floor-room-map.is-editing')).toBeNull();
    expect(container.querySelector('.floor-map-table.is-dragging')).toBeNull();
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('80%');
  });

  it('reconciles a newly opened table into an in-progress layout draft', () => {
    const storageKey = 'floor-layout:new-session';
    const secondTable: GameSession = { ...runningTable, id: 'table-second', label: 'Table 9' };
    const container = renderMap({ storageKey });
    const root = mountedRoots.at(-1)?.root;

    act(() => getButton(container, 'Edit layout')?.click());
    act(() => {
      container.querySelector<HTMLElement>('.floor-map-table')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    act(() => root?.render(createMapElement({ storageKey, sessions: [runningTable, secondTable] })));

    expect(container.querySelectorAll('.floor-map-table')).toHaveLength(2);
    expect(container.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('52%');
    act(() => getButton(container, 'Save layout')?.click());
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')).toEqual({
      [runningTable.id]: { x: 52, y: 50 },
      [secondTable.id]: { x: 84, y: 50 }
    });
  });

  it('moves edit focus when the focused table closes', () => {
    const secondTable: GameSession = { ...runningTable, id: 'table-focus-second', label: 'Table 10' };
    const container = renderMap({ sessions: [runningTable, secondTable] });
    const root = mountedRoots.at(-1)?.root;

    act(() => getButton(container, 'Edit layout')?.click());
    expect(document.activeElement?.textContent).toContain('Table 7');
    act(() => root?.render(createMapElement({ sessions: [secondTable] })));
    expect(document.activeElement?.classList.contains('floor-map-table')).toBe(true);
    expect(document.activeElement?.textContent).toContain('Table 10');

    act(() => root?.render(createMapElement({ sessions: [] })));
    expect(document.activeElement).toBe(getButton(container, 'Cancel'));
  });

  it('expands dense room geometry and offers bounded zoom controls', () => {
    const sessions = Array.from({ length: 20 }, (_, index): GameSession => ({
      ...runningTable,
      id: `table-${index + 1}`,
      label: `Table ${index + 1}`
    }));
    const container = renderMap({ sessions, players: [] });
    const canvas = container.querySelector<HTMLElement>('.floor-room-map-canvas');

    expect(container.querySelectorAll('.floor-map-table')).toHaveLength(20);
    expect(canvas?.style.height).toBe('800px');
    expect(canvas?.style.minWidth).toBe('1300px');
    expect(container.querySelector('.floor-room-map-zoom output')?.textContent).toBe('100%');

    act(() => getButton(container, 'Fit')?.click());
    expect(canvas?.style.height).toBe('600px');
    expect(canvas?.style.minWidth).toBe('975px');
    expect(canvas?.style.width).toBe('75%');
    expect(container.querySelector('.floor-room-map-zoom output')?.textContent).toBe('75%');
  });

  it('fits medium-density rooms to the measured canvas viewport without residual scrolling', () => {
    const sessions = Array.from({ length: 12 }, (_, index): GameSession => ({
      ...runningTable,
      id: `fit-table-${index + 1}`,
      label: `Table ${index + 1}`
    }));
    const container = renderMap({ sessions, players: [] });
    const viewport = container.querySelector<HTMLElement>('.floor-room-map-viewport');
    const canvas = container.querySelector<HTMLElement>('.floor-room-map-canvas');
    if (!viewport) throw new Error('Expected a room map viewport');
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1112 },
      clientHeight: { configurable: true, value: 518 }
    });

    act(() => getButton(container, 'Fit')?.click());

    expect(canvas?.style.minWidth).toBe('1103.7px');
    expect(canvas?.style.height).toBe('509.4px');
    expect(container.querySelector('.floor-room-map-zoom output')?.textContent).toBe('85%');
  });

  it('bounds stored coordinates and ignores malformed renderer preferences', () => {
    const boundedKey = 'floor-layout:bounded';
    window.localStorage.setItem(boundedKey, JSON.stringify({
      [runningTable.id]: { x: -200, y: 900 }
    }));
    const bounded = renderMap({ storageKey: boundedKey });
    expect(bounded.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('16%');
    expect(bounded.querySelector<HTMLElement>('.floor-map-table')?.style.top).toBe('85%');

    const malformedKey = 'floor-layout:malformed';
    window.localStorage.setItem(malformedKey, '{not-json');
    const malformed = renderMap({ storageKey: malformedKey });
    expect(malformed.querySelector<HTMLElement>('.floor-map-table')?.style.left).toBe('50%');
    expect(malformed.querySelector<HTMLElement>('.floor-map-table')?.style.top).toBe('50%');
  });
});
