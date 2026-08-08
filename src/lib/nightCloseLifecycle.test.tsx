/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../domain/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  latestState: undefined as unknown,
  props: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isAppState = (value: unknown): value is AppState =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'nightCloses'));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isAppState(result[0])) {
        harness.latestState = result[0];
        harness.stateSetter = result[1];
      }
      return result;
    }
  };
});

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment) {
      const root = actual.createRoot(container);
      harness.root = root;
      return root;
    }
  };
});

vi.mock('../components/SummaryView', () => ({
  default: (props: unknown) => {
    harness.props = props;
    return null;
  }
}));
vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const now = '2026-08-08T22:00:00.000Z';

const getState = () => {
  if (!isAppState(harness.latestState)) throw new Error('Expected application state');
  return harness.latestState;
};

const invoke = async (name: string, ...args: unknown[]) => {
  if (typeof harness.props !== 'object' || harness.props === null) throw new Error('Expected summary props');
  const callback: unknown = Reflect.get(harness.props, name);
  if (typeof callback !== 'function') throw new Error(`Expected ${name} callback`);
  await act(async () => {
    Reflect.apply(callback, undefined, args);
    await Promise.resolve();
  });
};

const resetState = async () => {
  const setter = harness.stateSetter;
  if (typeof setter !== 'function') throw new Error('Expected state setter');
  await act(async () => {
    setter((current: unknown) => {
      if (!isAppState(current)) throw new Error('Expected current state');
      return {
        ...current,
        games: [{ id: 'game-close', name: 'Close Holdem', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }],
        sessions: [{ id: 'table-close', gameId: 'game-close', label: 'Close Table', status: 'Running', seatsFilled: 1, maxSeats: 8, collectionMode: 'Drop', tags: [], startedAt: '2026-08-08T18:00:00.000Z' }],
        playerSessions: [{ id: 'session-close', profileId: 'profile-close', playerName: 'Close Player', gameId: 'game-close', tableId: 'table-close', seatedAt: '2026-08-08T18:10:00.000Z' }],
        buyIns: [{ id: 'buy-close', profileId: 'profile-close', playerName: 'Close Player', tableId: 'table-close', gameId: 'game-close', amount: 500, timestamp: '2026-08-08T18:15:00.000Z' }],
        playerLedger: [{ id: 'cash-close', type: 'Cash-Out', profileId: 'profile-close', playerName: 'Close Player', tableId: 'table-close', gameId: 'game-close', amount: 480, timestamp: '2026-08-08T21:00:00.000Z' }],
        dropLogs: [{ id: 'drop-close', tableId: 'table-close', gameId: 'game-close', amount: 20, timestamp: '2026-08-08T20:00:00.000Z' }],
        interests: [{ id: 'interest-close', profileId: 'profile-close', playerName: 'Close Player', gameId: 'game-close', status: 'Seated', tableId: 'table-close', timestamp: '2026-08-08T18:05:00.000Z', interestedAt: '2026-08-08T18:00:00.000Z', notes: '' }],
        tableEvents: [],
        nightCloses: [],
        history: [],
        usageEvents: [],
        settings: {
          ...current.settings,
          activeStaffId: 'staff-manager',
          staffAccounts: [{ id: 'staff-manager', name: 'Manager One', role: 'Manager', pinSalt: 'salt', pinHash: 'hash', active: true, createdAt: '2026-01-01T00:00:00.000Z' }]
        }
      };
    });
  });
};

describe('night-close mutation orchestration', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#summary';
    localStorage.setItem('table-manager-state-v1', JSON.stringify({
      settings: {
        pilotAccess: {
          activatedAt: '2026-08-08T12:00:00.000Z', authorizationCode: 'REF-017-CLOSE', authorized: true,
          expiresAt: '2099-12-31T23:59:59.000Z', licenseId: 'REF-017-CLOSE-LICENSE'
        },
        accountLogin: { username: 'ref-017-close@example.test' }
      }
    }));
    localStorage.setItem('table-manager-state-v1:auth:ref-017-close-license', JSON.stringify({ expiresAt: '2099-12-31T23:59:59.000Z' }));
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('prompt', vi.fn(() => '  Recounted cash  '));
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('saves, signs, locks, closes operational state, and reopens with canonical audit order', async () => {
    await resetState();
    await invoke('setNightCloseActuals', { 'table-close': '20' });
    await invoke('setNightCloseNotes', 'Counted at cage');
    await invoke('saveNightClose');

    let close = getState().nightCloses[0];
    expect(close).toMatchObject({
      id: expect.any(String),
      date: '2026-08-08',
      status: 'Draft',
      createdAt: now,
      updatedAt: now,
      notes: 'Counted at cage',
      warnings: ['Close Table: Table is still open']
    });
    expect(close.tables[0]).toMatchObject({ tableId: 'table-close', expectedCash: 20, actualCash: 20, discrepancy: 0 });
    expect(close.audit).toEqual([expect.objectContaining({ action: 'Created', timestamp: now, staffId: 'staff-manager', staffName: 'Manager One', staffRole: 'Manager' })]);

    await invoke('signNightClose');
    close = getState().nightCloses[0];
    expect(close.status).toBe('Staff Signed');
    expect(close.staffSignOff).toMatchObject({ action: 'Staff Signed', timestamp: now, note: 'Discrepancy 0.00' });
    expect(close.audit.map((entry) => entry.action)).toEqual(['Created', 'Staff Signed']);

    await invoke('approveAndLockNightClose');
    const lockedState = getState();
    close = lockedState.nightCloses[0];
    expect(globalThis.confirm).toHaveBeenCalledOnce();
    expect(close).toMatchObject({ status: 'Locked', lockedAt: now, updatedAt: now, warnings: [] });
    expect(close.managerSignOff).toMatchObject({ action: 'Manager Approved', timestamp: now, note: 'Locked with discrepancy 0.00' });
    expect(close.audit.map((entry) => entry.action)).toEqual(['Created', 'Staff Signed', 'Manager Approved']);
    expect(lockedState.interests).toEqual([]);
    expect(lockedState.sessions[0]).toMatchObject({ status: 'Closed', endedAt: now });
    expect(lockedState.playerSessions[0]).toMatchObject({ leftAt: now });
    expect(lockedState.tableEvents[0]).toMatchObject({ type: 'Closed', tableId: 'table-close', timestamp: now, note: 'Night reconciliation locked' });
    expect(lockedState.history).toHaveLength(1);

    await invoke('reopenNightClose');
    close = getState().nightCloses[0];
    expect(globalThis.prompt).toHaveBeenCalledOnce();
    expect(close).toMatchObject({ status: 'Draft', lockedAt: undefined, managerSignOff: undefined, updatedAt: now });
    expect(close.audit.map((entry) => entry.action)).toEqual(['Created', 'Staff Signed', 'Manager Approved', 'Reopened']);
    expect(close.audit.at(-1)).toMatchObject({ note: 'Recounted cash', staffId: 'staff-manager' });
  });
});
