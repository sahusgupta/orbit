/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameConfig, GameSession, PlayerSession } from '../domain/types';
import type { FloorActivityItem } from '../features/floor/floorActivity';
import FloorUtilities from './FloorUtilities';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: ReturnType<typeof createRoot>[] = [];
const clockNow = Date.parse('2026-08-18T20:00:00.000Z');

const games: GameConfig[] = [
  {
    id: 'holdem',
    name: 'No Limit Holdem',
    maxSeats: 8,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  },
  {
    id: 'plo',
    name: 'Pot Limit Omaha',
    maxSeats: 8,
    minInRoomForLikely: 4,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  }
];

const sessions: GameSession[] = [
  {
    id: 'time-main',
    gameId: 'holdem',
    label: 'Main Table',
    status: 'Running',
    seatsFilled: 2,
    maxSeats: 8,
    collectionMode: 'Time',
    tags: [],
    startedAt: '2026-08-18T18:00:00.000Z'
  },
  {
    id: 'drop-patio',
    gameId: 'plo',
    label: 'Patio Table',
    status: 'Running',
    seatsFilled: 1,
    maxSeats: 8,
    collectionMode: 'Drop',
    tags: [],
    startedAt: '2026-08-18T18:00:00.000Z'
  },
  {
    id: 'time-side',
    gameId: 'holdem',
    label: 'Side Table',
    status: 'Paused',
    seatsFilled: 1,
    maxSeats: 8,
    collectionMode: 'Time',
    tags: [],
    startedAt: '2026-08-18T18:00:00.000Z'
  },
  {
    id: 'quiet-table',
    gameId: 'plo',
    label: 'Quiet Table',
    status: 'Running',
    seatsFilled: 0,
    maxSeats: 8,
    collectionMode: 'Drop',
    tags: [],
    startedAt: '2026-08-18T18:00:00.000Z'
  }
];

const playerSessions: PlayerSession[] = [
  {
    id: 'urgent-player',
    playerName: 'Alex Rivera',
    gameId: 'holdem',
    tableId: 'time-main',
    seatNumber: 1,
    seatedAt: '2026-08-18T19:00:00.000Z',
    timeFeeEnabled: true,
    timeRemainingMinutes: 4
  },
  {
    id: 'no-timer-player',
    playerName: 'Casey Morgan',
    gameId: 'holdem',
    tableId: 'time-main',
    seatNumber: 2,
    seatedAt: '2026-08-18T19:10:00.000Z',
    timeFeeEnabled: false
  },
  {
    id: 'drop-player',
    playerName: 'Devon Lee',
    gameId: 'plo',
    tableId: 'drop-patio',
    seatNumber: 4,
    seatedAt: new Date(clockNow - 3661 * 1000).toISOString(),
    timeFeeEnabled: false
  },
  {
    id: 'legacy-drop-timer',
    playerName: 'Riley Park',
    gameId: 'plo',
    tableId: 'drop-patio',
    seatNumber: 5,
    seatedAt: '2026-08-18T19:05:00.000Z',
    timeFeeEnabled: true,
    timeRemainingMinutes: 10
  },
  {
    id: 'approaching-player',
    playerName: 'Morgan Ellis',
    gameId: 'holdem',
    tableId: 'time-side',
    seatNumber: 3,
    seatedAt: '2026-08-18T19:20:00.000Z',
    timeFeeEnabled: true,
    timeRemainingMinutes: 10
  }
];

const activityItems: FloorActivityItem[] = [
  {
    id: 'buy-in-main',
    timestamp: '2026-08-18T19:55:00.000Z',
    label: 'Buy-In',
    actor: 'Alex Rivera',
    detail: 'No Limit Holdem $500',
    kind: 'buy-in',
    eventType: 'Buy-In',
    sourceType: 'Buy-In',
    scope: 'table',
    tableId: 'time-main',
    tableLabel: 'Main Table'
  },
  {
    id: 'drop-patio',
    timestamp: '2026-08-18T19:50:00.000Z',
    label: 'Drop',
    actor: 'Pot Limit Omaha',
    detail: '$120',
    kind: 'drop',
    eventType: 'Drop',
    sourceType: 'Drop',
    scope: 'table',
    tableId: 'drop-patio',
    tableLabel: 'Patio Table'
  },
  {
    id: 'cash-out-side',
    timestamp: '2026-08-18T19:45:00.000Z',
    label: 'Cash-Out',
    actor: 'Morgan Ellis',
    detail: '$800',
    kind: 'cash-out',
    eventType: 'Cash-Out',
    sourceType: 'Cash-Out',
    scope: 'table',
    tableId: 'time-side',
    tableLabel: 'Side Table'
  },
  {
    id: 'room-check-in',
    timestamp: '2026-08-18T19:40:00.000Z',
    label: 'Check-In',
    actor: 'Taylor Reed',
    detail: 'No table assigned',
    kind: 'check-in',
    eventType: 'Check-In',
    sourceType: 'Check-In',
    scope: 'room'
  },
  {
    id: 'unknown-table-event',
    timestamp: '2026-08-18T19:35:00.000Z',
    label: 'Created',
    actor: 'Archived game',
    detail: 'Original table is no longer configured',
    kind: 'table',
    eventType: 'Created',
    sourceType: 'Created',
    scope: 'table',
    tableId: 'unknown-table'
  }
];

const formatTimeLeft = (seconds: number) => {
  if (seconds <= 0) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const getTimeRemainingSeconds = (playerSession: PlayerSession) => {
  if (playerSession.id === 'urgent-player') return 4 * 60;
  if (playerSession.id === 'no-timer-player') return 0;
  if (playerSession.id === 'approaching-player') return 10 * 60;
  if (playerSession.id === 'legacy-drop-timer') return 10 * 60;
  return 30 * 60;
};

type UtilityOverrides = Partial<{
  sessions: GameSession[];
  playerSessions: PlayerSession[];
  activityItems: FloorActivityItem[];
}>;

const utilitiesElement = (overrides: UtilityOverrides = {}) => (
  <FloorUtilities
    sessions={overrides.sessions ?? sessions}
    games={games}
    playerSessions={overrides.playerSessions ?? playerSessions}
    activityItems={overrides.activityItems ?? activityItems}
    clockNow={clockNow}
    getTimeRemainingSeconds={getTimeRemainingSeconds}
    formatClock={(timestamp) => timestamp?.slice(11, 16) ?? '-'}
    formatTimeLeft={formatTimeLeft}
  />
);

function renderUtilities(overrides: UtilityOverrides = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(utilitiesElement(overrides));
  });
  return container;
}

const changeSelect = (select: HTMLSelectElement, value: string) => {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

afterEach(() => {
  act(() => {
    mountedRoots.splice(0).forEach((root) => root.unmount());
  });
  document.body.innerHTML = '';
});

describe('FloorUtilities', () => {
  it('groups room timers by table and truthfully distinguishes Time countdowns, Drop durations, and legacy timers', async () => {
    const container = renderUtilities();
    const timerButton = container.querySelector<HTMLButtonElement>('button[aria-label="Timers, 2 players due"]');
    expect(timerButton).not.toBeNull();
    expect(timerButton?.classList.contains('requires-action')).toBe(true);
    expect(timerButton?.textContent).toContain('2 due');

    await act(async () => {
      timerButton?.focus();
      timerButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const drawer = document.querySelector('.floor-timers-drawer');
    const tableFilter = drawer?.querySelector<HTMLSelectElement>('select[aria-label="Filter timers by table"]');
    expect(drawer?.querySelector<HTMLElement>('.floor-timer-list')?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(tableFilter);
    expect(Array.from(drawer?.querySelectorAll('.floor-timer-group header strong') ?? [], (item) => item.textContent)).toEqual([
      'Main Table',
      'Patio Table',
      'Side Table'
    ]);

    const urgentRow = Array.from(drawer?.querySelectorAll('article.floor-timer-row.red') ?? [])
      .find((row) => row.querySelector('strong')?.textContent === 'Alex Rivera');
    expect(urgentRow?.querySelector('strong')?.textContent).toBe('Alex Rivera');
    expect(urgentRow?.querySelector('em')?.textContent).toBe('4:00');
    expect(urgentRow?.querySelector('small')?.textContent).toBe('Needs attention');

    const zeroTimeRow = Array.from(drawer?.querySelectorAll('article.floor-timer-row.red') ?? [])
      .find((row) => row.querySelector('strong')?.textContent === 'Casey Morgan');
    expect(zeroTimeRow?.querySelector('em')?.textContent).toBe('0:00');
    expect(zeroTimeRow?.querySelector('small')?.textContent).toBe('Needs attention');

    const dropRow = drawer?.querySelector('article.floor-timer-row.neutral');
    expect(dropRow?.querySelector('strong')?.textContent).toBe('Devon Lee');
    expect(dropRow?.querySelector('em')?.textContent).toBe('1:01:01');
    expect(dropRow?.querySelector('small')?.textContent).toBe('At table');
    const legacyDropTimer = Array.from(drawer?.querySelectorAll('article.floor-timer-row.yellow') ?? [])
      .find((row) => row.querySelector('strong')?.textContent === 'Riley Park');
    expect(legacyDropTimer?.querySelector('em')?.textContent).toBe('10:00');
    expect(legacyDropTimer?.querySelector('small')?.textContent).toBe('Legacy timer · Approaching');
    expect(drawer?.textContent).toContain('Drop · session length');

    if (!tableFilter) throw new Error('Expected a timer table filter');
    changeSelect(tableFilter, 'drop-patio');
    expect(document.querySelectorAll('.floor-timers-drawer .floor-timer-group')).toHaveLength(1);
    expect(document.querySelector('.floor-timers-drawer .floor-timer-group header strong')?.textContent).toBe('Patio Table');
    expect(document.querySelector('.floor-timers-drawer')?.textContent).not.toContain('Alex Rivera');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('.floor-timers-drawer')).toBeNull();
    expect(timerButton?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(timerButton);
  });

  it('filters activity by exact table and exact event type without treating room events as table events', async () => {
    const container = renderUtilities();
    const activityButton = container.querySelector<HTMLButtonElement>('button[aria-label="Activity, 5 recent events"]');
    expect(activityButton).not.toBeNull();

    await act(async () => {
      activityButton?.focus();
      activityButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const drawer = document.querySelector('.floor-activity-drawer');
    const tableFilter = drawer?.querySelector<HTMLSelectElement>('select[aria-label="Filter activity by table"]');
    const eventFilter = drawer?.querySelector<HTMLSelectElement>('select[aria-label="Filter activity by event type"]');
    const activityRegion = drawer?.querySelector<HTMLElement>('.floor-activity-list');
    expect(activityRegion?.tabIndex).toBe(0);
    expect(drawer?.classList.contains('is-expanded')).toBe(false);
    act(() => {
      drawer?.querySelector<HTMLButtonElement>('button[aria-label="Expand activity"]')?.click();
    });
    expect(document.querySelector('.floor-activity-drawer')?.classList.contains('is-expanded')).toBe(true);
    act(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Restore compact activity"]')?.click();
    });
    expect(document.querySelector('.floor-activity-drawer')?.classList.contains('is-expanded')).toBe(false);
    expect(document.activeElement).toBe(tableFilter);
    expect(drawer?.querySelectorAll('.floor-activity-row')).toHaveLength(5);
    expect(Array.from(eventFilter?.options ?? [], (option) => option.value)).toEqual([
      '',
      'Buy-In',
      'Cash-Out',
      'Check-In',
      'Created',
      'Drop'
    ]);
    expect(Array.from(tableFilter?.options ?? [], (option) => [option.value, option.textContent])).toEqual([
      ['', 'All tables'],
      ['time-main', 'Main Table'],
      ['drop-patio', 'Patio Table'],
      ['quiet-table', 'Quiet Table'],
      ['time-side', 'Side Table'],
      ['unknown-table', 'Unknown table']
    ]);

    if (!tableFilter || !eventFilter) throw new Error('Expected both activity filters');
    changeSelect(tableFilter, 'time-main');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(1);
    expect(document.querySelector('.floor-activity-drawer')?.textContent).toContain('Alex Rivera');
    expect(document.querySelector('.floor-activity-drawer')?.textContent).not.toContain('Taylor Reed');

    changeSelect(eventFilter, 'Drop');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(0);
    expect(document.querySelector('.floor-activity-drawer .floor-utility-empty')?.textContent).toBe('No activity matches both filters.');

    changeSelect(tableFilter, '');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(1);
    expect(document.querySelector('.floor-activity-drawer')?.textContent).toContain('Pot Limit Omaha');
    expect(document.querySelector('.floor-activity-drawer')?.textContent).not.toContain('Alex Rivera');
    expect(document.querySelector('.floor-utility-filter-summary')?.textContent?.trim()).toBe('Showing 1 of 5 recent events');

    changeSelect(eventFilter, 'Created');
    expect(document.querySelector('.floor-activity-drawer')?.textContent).toContain('Unknown table · Created');
    changeSelect(tableFilter, 'quiet-table');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(0);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('.floor-activity-drawer')).toBeNull();
    expect(activityButton?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(activityButton);
  });

  it('offers only open or recently referenced activity tables and disambiguates duplicate labels in both filters', async () => {
    const duplicateSessions: GameSession[] = [
      { ...sessions[0], id: 'holdem-main', label: 'Main Table' },
      { ...sessions[1], id: 'plo-main', label: 'Main Table' },
      { ...sessions[3], id: 'closed-old', label: 'Historical Table', status: 'Closed' },
      { ...sessions[3], id: 'closed-recent', label: 'Archive Table', status: 'Closed' }
    ];
    const recentClosedActivity: FloorActivityItem = {
      id: 'recent-closed-event',
      timestamp: '2026-08-18T19:58:00.000Z',
      label: 'Closed',
      actor: 'Pot Limit Omaha',
      detail: 'Staff closed table',
      kind: 'table',
      eventType: 'Closed',
      sourceType: 'Closed',
      scope: 'table',
      tableId: 'closed-recent',
      tableLabel: 'Archive Table'
    };
    const container = renderUtilities({
      sessions: duplicateSessions,
      playerSessions: [],
      activityItems: [recentClosedActivity]
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Timers, no seated players"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(Array.from(
      document.querySelectorAll<HTMLOptionElement>('.floor-timers-drawer select[aria-label="Filter timers by table"] option'),
      (option) => [option.value, option.textContent]
    )).toEqual([
      ['', 'All tables'],
      ['holdem-main', 'Main Table · No Limit Holdem'],
      ['plo-main', 'Main Table · Pot Limit Omaha']
    ]);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close room timers"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      container.querySelector<HTMLButtonElement>('button[aria-label="Activity, 1 recent event"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(Array.from(
      document.querySelectorAll<HTMLOptionElement>('.floor-activity-drawer select[aria-label="Filter activity by table"] option'),
      (option) => [option.value, option.textContent]
    )).toEqual([
      ['', 'All tables'],
      ['closed-recent', 'Archive Table'],
      ['holdem-main', 'Main Table · No Limit Holdem · Running'],
      ['plo-main', 'Main Table · Pot Limit Omaha · Running']
    ]);
    expect(document.querySelector('.floor-activity-drawer')?.textContent).not.toContain('Historical Table');
  });

  it('distinguishes an unassigned table lifecycle event from room-scoped activity', async () => {
    const unassignedCreated: FloorActivityItem = {
      id: 'unassigned-created',
      timestamp: '2026-08-18T19:58:00.000Z',
      label: 'Created',
      actor: 'No Limit Holdem',
      detail: 'Table forming',
      kind: 'table',
      eventType: 'Created',
      sourceType: 'Created',
      scope: 'unassigned-table'
    };
    const container = renderUtilities({ activityItems: [unassignedCreated] });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Activity, 1 recent event"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('.floor-activity-drawer')?.textContent).toContain('Unassigned table · Created');
    expect(document.querySelector('.floor-activity-drawer')?.textContent).not.toContain('Room · Created');
  });

  it('immediately clears invalid hidden filters when activity props change', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);
    act(() => root.render(utilitiesElement()));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Activity, 5 recent events"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const initialTableFilter = document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by table"]');
    const initialEventFilter = document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by event type"]');
    if (!initialTableFilter || !initialEventFilter) throw new Error('Expected initial activity filters');
    changeSelect(initialTableFilter, 'time-main');
    changeSelect(initialEventFilter, 'Buy-In');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(1);

    act(() => root.render(utilitiesElement({
      sessions: [sessions[1]],
      playerSessions: [playerSessions[2]],
      activityItems: [activityItems[1]]
    })));

    const replacementTableFilter = document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by table"]');
    const replacementEventFilter = document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by event type"]');
    expect(replacementTableFilter?.value).toBe('');
    expect(replacementEventFilter?.value).toBe('');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(1);
    expect(document.querySelector('.floor-activity-drawer')?.textContent).toContain('Pot Limit Omaha');

    act(() => root.render(utilitiesElement()));
    expect(document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by table"]')?.value).toBe('');
    expect(document.querySelector<HTMLSelectElement>('.floor-activity-drawer select[aria-label="Filter activity by event type"]')?.value).toBe('');
    expect(document.querySelectorAll('.floor-activity-drawer .floor-activity-row')).toHaveLength(5);
  });

  it('does not show an urgency badge when only quiet, untimed, or Drop sessions exist', () => {
    const quietPlayer = {
      ...playerSessions[0],
      id: 'quiet-player',
      timeRemainingMinutes: 30
    };
    const container = renderUtilities({
      playerSessions: [quietPlayer, playerSessions[2]]
    });
    const timerButton = container.querySelector<HTMLButtonElement>('button[aria-label="Timers, no players need attention"]');
    expect(timerButton).not.toBeNull();
    expect(timerButton?.querySelector('strong')).toBeNull();
    expect(timerButton?.classList.contains('requires-action')).toBe(false);
    expect(timerButton?.classList.contains('approaching-action')).toBe(false);
  });
});
