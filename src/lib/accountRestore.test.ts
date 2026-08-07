/**
 * @vitest-environment jsdom
 */
import { Session } from 'node:inspector/promises';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type PersistedRecord = {
  schemaVersion: number;
  savedAt: string;
  state: Record<string, unknown>;
};

type PilotAccessFixture = {
  activatedAt: string;
  authorizationCode: string;
  authorized: true;
  expiresAt: string;
  issuedTo: string;
  licenseId: string;
};

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  loadForAccountError: false,
  loadForAccountResult: null as unknown,
  root: undefined as { unmount: () => void } | undefined,
  savedStates: [] as unknown[],
  stateSetter: undefined as unknown
}));

const isAppState = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray(Reflect.get(value, 'games')) &&
  Array.isArray(Reflect.get(value, 'profiles')) &&
  Array.isArray(Reflect.get(value, 'sessions')) &&
  typeof Reflect.get(value, 'settings') === 'object' &&
  Reflect.get(value, 'settings') !== null;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isAppState(result[0])) harness.stateSetter = result[1];
      return result;
    }
  };
});

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment, options?: RootOptions) {
      const root = actual.createRoot(container, options);
      const render = root.render.bind(root);
      root.render = (children: ReactNode) => {
        const pending: unknown[] = [children];
        while (pending.length) {
          const child = pending.pop();
          if (typeof child !== 'object' || child === null) continue;
          if ('type' in child && typeof child.type === 'function') {
            harness.appComponent = child.type;
            break;
          }
          if ('props' in child && typeof child.props === 'object' && child.props !== null && 'children' in child.props) {
            const nested = child.props.children;
            pending.push(...(Array.isArray(nested) ? nested : [nested]));
          }
        }
        render(children);
      };
      harness.root = root;
      return root;
    }
  };
});

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

const access: PilotAccessFixture = {
  activatedAt: '2026-08-07T12:00:00.000Z',
  authorizationCode: 'TYPE-009-AUTH',
  authorized: true,
  expiresAt: '2099-12-31T23:59:59.000Z',
  issuedTo: 'TYPE-009 Fixture Club',
  licenseId: 'TYPE-009-ACCOUNT'
};
const accountStorageKey = 'table-manager-state-v1:type-009-account';

type ScriptLocation = {
  columnNumber?: number;
  lineNumber: number;
  scriptId: string;
};

let restoreFunctionObjectId = '';

const captureRestoreFunction = async (session: Session) => {
  if (typeof harness.appComponent !== 'function') throw new Error('Expected to capture the App component');
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  Reflect.set(globalThis, '__orbitType009App', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType009App' });
  const appObjectId = evaluated.result.objectId;
  if (!appObjectId) throw new Error('Expected the App component to be inspectable');
  const properties = await session.post('Runtime.getProperties', { objectId: appObjectId, ownProperties: false });
  const functionLocation = properties.internalProperties?.find(
    (property) => property.name === '[[FunctionLocation]]'
  )?.value?.value;
  if (
    typeof functionLocation !== 'object' ||
    functionLocation === null ||
    !('scriptId' in functionLocation) ||
    typeof functionLocation.scriptId !== 'string' ||
    !('lineNumber' in functionLocation) ||
    typeof functionLocation.lineNumber !== 'number'
  ) {
    throw new Error('Expected the App component script location');
  }
  const sourceResult = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType009App.toString()',
    returnByValue: true
  });
  const source = sourceResult.result.value;
  if (typeof source !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = source.split(/\r?\n/).findIndex((line) => line.includes('const loadPilotKeyFile'));
  if (relativeLineNumber < 0) throw new Error('Expected the account-restore boundary in the App source');
  const location: ScriptLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  const breakpoint = await session.post('Debugger.setBreakpoint', { location });
  const completed = new Promise<void>((resolve, reject) => {
    session.once('Debugger.paused', (message) => {
      void (async () => {
        try {
          const callFrame = message.params.callFrames[0];
          if (!callFrame) throw new Error('Expected a paused App call frame');
          await session.post('Debugger.evaluateOnCallFrame', {
            callFrameId: callFrame.callFrameId,
            expression: 'globalThis.__orbitType009Restore = loadExistingAccountState; true'
          });
          await session.post('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    });
  });
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isAppState(current)) throw new Error('Expected the current application state');
      return { ...current };
    });
  });
  await completed;
  const restore = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType009Restore' });
  if (!restore.result.objectId) throw new Error('Expected the captured account-restore function');
  restoreFunctionObjectId = restore.result.objectId;
};

const invokeRestore = async (session: Session) => {
  if (!restoreFunctionObjectId) throw new Error('Expected a captured restore function');
  Reflect.set(globalThis, '__orbitType009Access', access);
  let invocation:
    | {
        exceptionDetails?: object;
        result: { value?: unknown };
      }
    | undefined;
  await act(async () => {
    invocation = await session.post('Runtime.evaluate', {
      expression: 'globalThis.__orbitType009Restore(globalThis.__orbitType009Access)',
      awaitPromise: true,
      returnByValue: true
    });
  });
  if (!invocation) throw new Error('Expected an account-restore invocation result');
  if ('exceptionDetails' in invocation && invocation.exceptionDetails) {
    throw new Error(JSON.stringify(invocation.exceptionDetails));
  }
  return invocation;
};

const readPersistedState = () => {
  const stored = localStorage.getItem(accountStorageKey);
  if (!stored) throw new Error('Expected restored state to be persisted');
  const parsed: unknown = JSON.parse(stored);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Expected an object state');
  return parsed as Record<string, unknown>;
};

describe('persisted account restore boundary', () => {
  const inspectorSession = new Session();

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '#access';
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => null),
      loadStateForAccount: vi.fn(async () => {
        if (harness.loadForAccountError) throw new Error('fixture bridge failure');
        return harness.loadForAccountResult;
      }),
      onPrepareForUpdate: vi.fn(() => () => undefined),
      openWindow: vi.fn(async () => undefined),
      preserveStateForUpdate: vi.fn(async () => ({ ok: true })),
      recordClientError: vi.fn(async () => ({ ok: true })),
      recordClientEvent: vi.fn(async () => ({ ok: true })),
      saveState: vi.fn(async (state: unknown) => {
        harness.savedStates.push(state);
        return { ok: true, path: 'fixture' };
      }),
      sendTextMessages: vi.fn(async () => ({ ok: true })),
      submitAnalyticalReport: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: false, active: true }))
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../main');
    });
    await captureRestoreFunction(inspectorSession);
  });

  beforeEach(() => {
    localStorage.clear();
    harness.loadForAccountError = false;
    harness.loadForAccountResult = null;
    harness.savedStates.length = 0;
    window.location.hash = '#access';
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType009App');
    Reflect.deleteProperty(globalThis, '__orbitType009Access');
    Reflect.deleteProperty(globalThis, '__orbitType009Restore');
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('returns false for a null desktop record when no local account exists', async () => {
    const result = await invokeRestore(inspectorSession);

    expect(result.result.value).toBe(false);
    expect(harness.savedStates).toHaveLength(0);
    expect(localStorage.getItem(accountStorageKey)).toBeNull();
  });

  it('returns false when neither a desktop bridge nor a local account record exists', async () => {
    const desktopBridge = Reflect.get(window, 'tableManagerDesktop');
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    try {
      const result = await invokeRestore(inspectorSession);

      expect(result.result.value).toBe(false);
      expect(harness.savedStates).toHaveLength(0);
      expect(localStorage.getItem(accountStorageKey)).toBeNull();
    } finally {
      Reflect.set(window, 'tableManagerDesktop', desktopBridge);
    }
  });

  it('loads a current versioned desktop record and replaces only pilot access', async () => {
    harness.loadForAccountResult = {
      schemaVersion: 4,
      savedAt: '2026-08-07T21:00:00.000Z',
      state: {
        games: [{ id: 'fixture-game', name: 'Fixture Game', maxSeats: 8 }],
        settings: {
          lowLight: true,
          defaultCollectionMode: 'Time',
          defaultTableCap: 8,
          defaultHourlyFee: 12,
          defaultEstimatedDropPerSeatHour: 0,
          collectionProfiles: [],
          membershipPlans: [],
          showPlayerGrid: false,
          showDashboardKpis: true,
          showRecentPlayers: false,
          pilotAccess: { ...access, licenseId: 'OLD-KEY' },
          staffAccounts: []
        }
      }
    } satisfies PersistedRecord;

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();
    const settings = Reflect.get(restored, 'settings') as Record<string, unknown>;

    expect(result.result.value).toBe(true);
    expect(Reflect.get(restored, 'games')).toEqual([{ id: 'fixture-game', name: 'Fixture Game', maxSeats: 8 }]);
    expect(settings.lowLight).toBe(true);
    expect(settings.showPlayerGrid).toBe(false);
    expect(settings.pilotAccess).toEqual(access);
    expect(harness.savedStates.length).toBeGreaterThanOrEqual(1);
    expect(window.location.hash).toBe('#/floor');
  });

  it('falls back to a local legacy state after a desktop bridge failure and supplies settings defaults', async () => {
    harness.loadForAccountError = true;
    localStorage.setItem(
      accountStorageKey,
      JSON.stringify({
        games: [{ id: 'legacy-game', name: 'Legacy Game', maxSeats: 6 }],
        settings: { lowLight: true, showRecentPlayers: false }
      })
    );

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();
    const settings = Reflect.get(restored, 'settings') as Record<string, unknown>;

    expect(result.result.value).toBe(true);
    expect(Reflect.get(restored, 'games')).toEqual([{ id: 'legacy-game', name: 'Legacy Game', maxSeats: 6 }]);
    expect(settings.lowLight).toBe(true);
    expect(settings.defaultCollectionMode).toBe('Drop');
    expect(settings.defaultTableCap).toBe(6);
    expect(settings.showRecentPlayers).toBe(false);
    expect(settings.pilotAccess).toEqual(access);
  });

  it('retains the historical default collection mode key', async () => {
    harness.loadForAccountResult = {
      schemaVersion: 1,
      savedAt: '2026-08-07T21:00:00.000Z',
      state: {
        settings: { defaultRakeMode: 'Time' }
      }
    } satisfies PersistedRecord;

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();
    const settings = Reflect.get(restored, 'settings') as Record<string, unknown>;

    expect(result.result.value).toBe(true);
    expect(settings.defaultCollectionMode).toBe('Time');
    expect(Reflect.has(settings, 'defaultRakeMode')).toBe(false);
  });

  it('gives the current collection mode precedence over the historical key', async () => {
    harness.loadForAccountResult = {
      schemaVersion: 4,
      savedAt: '2026-08-07T21:00:00.000Z',
      state: {
        settings: { defaultCollectionMode: 'Drop', defaultRakeMode: 'Time' }
      }
    } satisfies PersistedRecord;

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();
    const settings = Reflect.get(restored, 'settings') as Record<string, unknown>;

    expect(result.result.value).toBe(true);
    expect(settings.defaultCollectionMode).toBe('Drop');
    expect(Reflect.has(settings, 'defaultRakeMode')).toBe(false);
  });

  it('falls back safely for corrupt historical collection modes', async () => {
    harness.loadForAccountResult = {
      schemaVersion: 1,
      savedAt: '2026-08-07T21:00:00.000Z',
      state: {
        settings: { defaultRakeMode: 'Hourly' }
      }
    } satisfies PersistedRecord;

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();
    const settings = Reflect.get(restored, 'settings') as Record<string, unknown>;

    expect(result.result.value).toBe(true);
    expect(settings.defaultCollectionMode).toBe('Drop');
    expect(Reflect.has(settings, 'defaultRakeMode')).toBe(false);
  });

  it('normalizes legacy domain records, fills canonical defaults, preserves order, and does not mutate the loaded record', async () => {
    const seatedAt = '2026-08-07T18:00:00.000Z';
    const legacyState = {
      games: [{
        id: 'nlh-1-2',
        name: 'No Limit Holdem 1/2',
        maxSeats: 7,
        minInRoomForLikely: 4,
        minFlexibleForLikely: 2,
        minTotalForViable: 6
      }],
      interests: [{
        id: 'interest-legacy',
        playerName: 'Legacy Player',
        gameId: 'holdem',
        status: 'Coming',
        timestamp: '2026-08-07T17:30:00.000Z',
        notes: ''
      }],
      sessions: [{
        id: 'table-legacy',
        gameId: 'holdem',
        label: 'Legacy Table',
        status: 'Running',
        seatsFilled: 2,
        maxSeats: 7,
        tags: [],
        startedAt: '2026-08-07T17:45:00.000Z',
        rakeMode: 'Time'
      }],
      playerSessions: [
        {
          id: 'session-first',
          playerName: 'First Player',
          gameId: 'holdem',
          tableId: 'table-legacy',
          seatNumber: 2,
          seatedAt,
          timeRakeEnabled: true
        },
        {
          id: 'session-second',
          playerName: 'Second Player',
          gameId: 'holdem',
          tableId: 'table-legacy',
          seatNumber: 2,
          seatedAt: '2026-08-07T18:05:00.000Z'
        }
      ],
      tournaments: [{
        id: 'tournament-legacy',
        name: 'Legacy Tournament',
        createdAt: '2026-08-01T12:00:00.000Z'
      }],
      tableEvents: [{
        id: 'event-legacy',
        type: 'Created',
        gameId: 'nlh-1-2',
        timestamp: '2026-08-07T17:45:00.000Z',
        playerCount: 0,
        note: 'legacy event'
      }],
      inAppNotifications: [{
        id: 'notification-legacy',
        clubId: 'club-legacy',
        gameId: 'nlh-1-2',
        title: 'Legacy notice',
        body: 'Legacy body',
        reason: 'game-forming',
        createdAt: '2026-08-07T17:40:00.000Z'
      }],
      settings: {
        defaultTableCap: 7,
        rakeProfiles: [{
          gameId: 'holdem',
          hourlyFee: 12,
          estimatedDropPerSeatHour: 0,
          rakeMode: 'Time'
        }],
        membershipPlans: [{
          id: 'legacy-plan',
          name: 'Legacy Plan',
          priceLabel: '$5',
          durationDays: 0,
          active: false
        }],
        clubAccount: {
          clubName: 'Legacy Club',
          accountName: 'Legacy Account',
          contactName: 'Legacy Operator',
          email: 'OWNER@EXAMPLE.TEST',
          phone: '',
          address: ''
        },
        accountLogin: {
          username: 'legacy-owner',
          passwordSalt: 'legacy-salt',
          passwordHash: 'legacy-hash',
          createdAt: '2026-08-01T12:00:00.000Z'
        }
      }
    };
    const loadedRecord = {
      schemaVersion: 1,
      savedAt: '2026-08-07T21:00:00.000Z',
      state: legacyState
    } satisfies PersistedRecord;
    const loadedSnapshot = structuredClone(loadedRecord);
    harness.loadForAccountResult = loadedRecord;

    const result = await invokeRestore(inspectorSession);
    const restored = readPersistedState();

    expect(result.result.value).toBe(true);
    expect(loadedRecord).toEqual(loadedSnapshot);
    expect(restored.games).toEqual([{ ...legacyState.games[0], maxSeats: 8 }]);
    expect(restored.profiles).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        name: 'Legacy Player',
        membershipStartDate: '2026-08-07',
        membershipExpirationDate: '2027-08-07',
        preferredGameId: 'nlh-1-2',
        preferredGameIds: ['nlh-1-2'],
        gamePlayCounts: {},
        mostPlayedGameId: 'nlh-1-2'
      })
    ]);
    expect(restored.interests).toEqual([{
      ...legacyState.interests[0],
      gameId: 'nlh-1-2',
      status: 'Confirmed Coming',
      interestedAt: legacyState.interests[0].timestamp,
      confirmedAt: legacyState.interests[0].timestamp,
      manualEdits: {}
    }]);
    expect(restored.sessions).toEqual([expect.objectContaining({
      id: 'table-legacy',
      gameId: 'nlh-1-2',
      maxSeats: 8,
      collectionMode: 'Time',
      timeFeeBased: true,
      manualEdits: {}
    })]);
    expect((restored.playerSessions as Array<Record<string, unknown>>).map((session) => session.id)).toEqual([
      'session-first',
      'session-second'
    ]);
    expect((restored.playerSessions as Array<Record<string, unknown>>).map((session) => session.seatNumber)).toEqual([2, 1]);
    expect(restored.playerSessions).toEqual([
      expect.objectContaining({
        gameId: 'nlh-1-2',
        timePurchasedMinutes: 0,
        timeRemainingMinutes: 0,
        lastTimeTickAt: seatedAt,
        timeFeeEnabled: true,
        manualEdits: {}
      }),
      expect.objectContaining({
        gameId: 'nlh-1-2',
        timePurchasedMinutes: 0,
        timeRemainingMinutes: 0,
        timeFeeEnabled: false,
        manualEdits: {}
      })
    ]);
    expect(restored.tournaments).toEqual([
      expect.objectContaining({
        id: 'tournament-legacy',
        status: 'Draft',
        currentLevelIndex: 0,
        buyIn: 0,
        startingStack: 10_000,
        levels: [],
        players: [],
        payouts: []
      }),
      expect.objectContaining({ id: 'orbit-launch-championship-2026' })
    ]);
    expect(restored.tableEvents).toEqual([{ ...legacyState.tableEvents[0], reason: '' }]);
    expect(restored.inAppNotifications).toEqual([{
      ...legacyState.inAppNotifications[0],
      targetPlayerIds: [],
      targetPlayerNames: []
    }]);
    const settings = restored.settings as Record<string, unknown>;
    expect(settings.defaultTableCap).toBe(8);
    expect(settings.collectionProfiles).toEqual([{
      ...legacyState.settings.rakeProfiles[0],
      collectionMode: 'Time'
    }]);
    expect(settings.membershipPlans).toEqual([{
      ...legacyState.settings.membershipPlans[0],
      durationDays: 1
    }]);
    expect(settings.accountLogin).toEqual({
      ...legacyState.settings.accountLogin,
      username: 'owner@example.test'
    });
  });

  it('never persists malformed local JSON', async () => {
    localStorage.setItem(accountStorageKey, '{not-json');

    const result = await invokeRestore(inspectorSession);

    expect(result.result.value).toBe(false);
    expect(harness.savedStates).toHaveLength(0);
    expect(localStorage.getItem(accountStorageKey)).toBe('{not-json');
    expect(window.location.hash).toBe('#access');
  });
});
