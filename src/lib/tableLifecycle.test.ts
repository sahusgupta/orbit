/**
 * @vitest-environment jsdom
 */
import { Session } from 'node:inspector/promises';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type IdentifiedRecord = Record<string, unknown> & { id: string };

type CapturedState = Record<string, unknown> & {
  correctionLog: IdentifiedRecord[];
  dealerAssignments: IdentifiedRecord[];
  games: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  tableEvents: IdentifiedRecord[];
  usageEvents: IdentifiedRecord[];
};

type LifecycleFixtures = {
  correctionLog?: IdentifiedRecord[];
  dealerAssignments?: IdentifiedRecord[];
  playerLedger?: IdentifiedRecord[];
  playerSessions?: IdentifiedRecord[];
  sessions?: IdentifiedRecord[];
  tableEvents?: IdentifiedRecord[];
  usageEvents?: IdentifiedRecord[];
};

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isCapturedState = (value: unknown): value is CapturedState => {
  if (typeof value !== 'object' || value === null) return false;
  return [
    'correctionLog',
    'dealerAssignments',
    'games',
    'playerSessions',
    'sessions',
    'tableEvents',
    'usageEvents'
  ].every((key) => {
    const records: unknown = Reflect.get(value, key);
    return Array.isArray(records) && records.every(isIdentifiedRecord);
  });
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];
      if (isCapturedState(value) && value.games.some((candidate) => candidate.id === 'game-lifecycle')) {
        harness.latestState = value;
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
    createRoot(container: Element | DocumentFragment, options?: RootOptions) {
      const root = actual.createRoot(container, options);
      const render = root.render.bind(root);
      root.render = (children: ReactNode) => {
        const pending: unknown[] = [children];
        while (pending.length) {
          const child = pending.pop();
          if (typeof child !== 'object' || child === null) continue;
          if ('type' in child && typeof child.type === 'function' && child.type.name === 'App') {
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

const now = '2026-08-07T22:00:00.000Z';
const accountKey = 'type-007g-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const game = {
  id: 'game-lifecycle',
  name: 'Lifecycle Holdem',
  maxSeats: 8,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};
const targetTableWithoutLifecycleFields = {
  id: 'table-target',
  gameId: game.id,
  label: 'Feature Table',
  status: 'Forming',
  seatsFilled: 3,
  maxSeats: 8,
  timeFeeBased: true,
  collectionMode: 'Time',
  plannedPlayerIds: ['interest-a', 'interest-b'],
  tags: ['Action', 'Full-ring'],
  startedAt: '2026-08-07T18:00:00.000Z'
};
const targetTableWithLifecycleFields = {
  ...targetTableWithoutLifecycleFields,
  status: 'Closed',
  endedAt: '2026-08-07T21:00:00.000Z',
  manualEdits: { startedAt: '2026-08-07T18:05:00.000Z' }
};
const otherTable = {
  id: 'table-other',
  gameId: game.id,
  label: 'Other Table',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: 6,
  timeFeeBased: false,
  collectionMode: 'Drop',
  plannedPlayerIds: ['interest-other'],
  tags: ['Social'],
  startedAt: '2026-08-07T17:00:00.000Z',
  manualEdits: { label: '2026-08-07T17:05:00.000Z' }
};
const openTargetPlayerSession: IdentifiedRecord = {
  id: 'player-session-open-target',
  playerName: 'Open Target Player',
  profileId: 'profile-open-target',
  gameId: game.id,
  tableId: targetTableWithoutLifecycleFields.id,
  seatNumber: 2,
  seatedAt: '2026-08-07T19:00:00.000Z',
  timePurchasedMinutes: 120,
  timeRemainingMinutes: 55,
  lastTimeTickAt: '2026-08-07T21:55:00.000Z',
  timeFeeEnabled: true,
  manualEdits: { seatNumber: '2026-08-07T19:05:00.000Z' }
};
const closedTargetPlayerSession: IdentifiedRecord = {
  ...openTargetPlayerSession,
  id: 'player-session-closed-target',
  playerName: 'Closed Target Player',
  profileId: 'profile-closed-target',
  seatNumber: 4,
  leftAt: '2026-08-07T21:15:00.000Z',
  manualEdits: { leftAt: '2026-08-07T21:15:00.000Z' }
};
const otherTablePlayerSession: IdentifiedRecord = {
  ...openTargetPlayerSession,
  id: 'player-session-other-table',
  playerName: 'Other Table Player',
  profileId: 'profile-other-table',
  tableId: otherTable.id,
  seatNumber: 1,
  manualEdits: undefined
};
const openTargetDealer: IdentifiedRecord = {
  id: 'dealer-open-target',
  tableId: targetTableWithoutLifecycleFields.id,
  gameId: game.id,
  dealerName: 'Open Dealer',
  startedAt: '2026-08-07T19:00:00.000Z'
};
const closedTargetDealer: IdentifiedRecord = {
  ...openTargetDealer,
  id: 'dealer-closed-target',
  dealerName: 'Closed Dealer',
  endedAt: '2026-08-07T21:00:00.000Z'
};
const otherTableDealer: IdentifiedRecord = {
  ...openTargetDealer,
  id: 'dealer-other-table',
  tableId: otherTable.id,
  dealerName: 'Other Dealer'
};
const existingEvent: IdentifiedRecord = {
  id: 'event-existing',
  type: 'Created',
  gameId: game.id,
  tableId: targetTableWithoutLifecycleFields.id,
  timestamp: '2026-08-07T17:55:00.000Z',
  playerCount: 0,
  note: 'Existing table history'
};
const existingCorrection: IdentifiedRecord = {
  id: 'correction-existing',
  entity: 'Earlier table',
  field: 'label',
  note: 'Existing correction history',
  timestamp: '2026-08-07T17:45:00.000Z'
};
const existingUsage: IdentifiedRecord = {
  id: 'usage-existing',
  feature: 'Earlier feature',
  action: 'Earlier action',
  route: 'floor',
  timestamp: '2026-08-07T17:40:00.000Z',
  accountKey
};

type ScriptLocation = {
  columnNumber?: number;
  lineNumber: number;
  scriptId: string;
};

let appBreakpointLocation: ScriptLocation | undefined;

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const getAppBreakpointLocation = async (session: Session) => {
  if (appBreakpointLocation) return appBreakpointLocation;
  if (typeof harness.appComponent !== 'function') throw new Error('Expected to capture the App component');
  Reflect.set(globalThis, '__orbitType007gApp', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType007gApp' });
  const appObjectId = evaluated.result.objectId;
  if (!appObjectId) throw new Error('Expected the App component to be inspectable');
  const appProperties = await session.post('Runtime.getProperties', { objectId: appObjectId, ownProperties: false });
  const functionLocation = appProperties.internalProperties?.find(
    (property) => property.name === '[[FunctionLocation]]'
  )?.value?.value;
  if (
    typeof functionLocation !== 'object' ||
    functionLocation === null ||
    !('scriptId' in functionLocation) ||
    typeof functionLocation.scriptId !== 'string'
  ) {
    throw new Error('Expected the App component script location');
  }
  const sourceResult = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007gApp.toString()',
    returnByValue: true
  });
  const source = sourceResult.result.value;
  if (typeof source !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = source.split(/\r?\n/).findIndex((line) => line.includes('const failFormingGame'));
  if (relativeLineNumber < 0) throw new Error('Expected the table lifecycle boundary in the App source');
  appBreakpointLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  return appBreakpointLocation;
};

const armLifecycleFunctionCapture = async (session: Session) => {
  const location = await getAppBreakpointLocation(session);
  const breakpoint = await session.post('Debugger.setBreakpoint', { location });
  const completed = new Promise<void>((resolve, reject) => {
    session.once('Debugger.paused', (message) => {
      void (async () => {
        try {
          const callFrame = message.params.callFrames[0];
          if (!callFrame) throw new Error('Expected a paused App call frame');
          await session.post('Debugger.evaluateOnCallFrame', {
            callFrameId: callFrame.callFrameId,
            expression:
              'globalThis.__orbitType007gUpdateSession = updateSession; ' +
              'globalThis.__orbitType007gUpdateSessionTimestamp = updateSessionTimestamp; ' +
              'globalThis.__orbitType007gRecordTableEvent = recordTableEvent; true'
          });
          await session.post('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    });
  });
  return { completed };
};

const replaceCapturedState = async (session: Session, fixtures: LifecycleFixtures = {}) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  const capture = await armLifecycleFunctionCapture(session);
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        correctionLog: fixtures.correctionLog ?? [structuredClone(existingCorrection)],
        dealerAssignments: fixtures.dealerAssignments ?? [
          structuredClone(openTargetDealer),
          structuredClone(closedTargetDealer),
          structuredClone(otherTableDealer)
        ],
        playerLedger: fixtures.playerLedger ?? [],
        playerSessions: fixtures.playerSessions ?? [
          structuredClone(openTargetPlayerSession),
          structuredClone(closedTargetPlayerSession),
          structuredClone(otherTablePlayerSession)
        ],
        sessions: fixtures.sessions ?? [
          structuredClone(targetTableWithoutLifecycleFields),
          structuredClone(otherTable)
        ],
        tableEvents: fixtures.tableEvents ?? [structuredClone(existingEvent)],
        usageEvents: fixtures.usageEvents ?? [structuredClone(existingUsage)]
      };
    });
  });
  await capture.completed;
};

const invokeLifecycleFunction = async (session: Session, bindingName: string, args: unknown[]) => {
  const globalName =
    bindingName === 'updateSession'
      ? '__orbitType007gUpdateSession'
      : bindingName === 'updateSessionTimestamp'
        ? '__orbitType007gUpdateSessionTimestamp'
        : '__orbitType007gRecordTableEvent';
  const evaluated = await session.post('Runtime.evaluate', { expression: `globalThis.${globalName}` });
  const functionObjectId = evaluated.result.objectId;
  if (!functionObjectId) throw new Error(`Expected the captured ${bindingName} function`);
  await act(async () => {
    await session.post('Runtime.callFunctionOn', {
      objectId: functionObjectId,
      functionDeclaration: 'function () { return this.apply(undefined, arguments); }',
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true
    });
  });
};

const getRecord = (records: IdentifiedRecord[], id: string) => {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Expected record ${id}`);
  return record;
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the lifecycle state to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const expectPreviousStateUnchanged = (previousState: CapturedState, previousSnapshot: CapturedState) => {
  expect(previousState).toEqual(previousSnapshot);
  expect(getLatestState()).not.toBe(previousState);
};

const expectCorrection = (state: CapturedState, entity: string, field: string) => {
  expect(state.correctionLog).toEqual([
    {
      id: expect.any(String),
      entity,
      field,
      note: 'Table timestamp corrected',
      timestamp: now
    },
    existingCorrection
  ]);
};

const expectRecordedEventUsage = (state: CapturedState, action: string, reason: string) => {
  expect(state.usageEvents).toEqual([
    expect.objectContaining({
      id: expect.any(String),
      feature: 'Tables',
      action,
      route: 'floor',
      timestamp: now,
      accountKey,
      metadata: {
        gameId: game.id,
        tableId: targetTableWithoutLifecycleFields.id,
        reason
      }
    }),
    existingUsage
  ]);
};

describe('table lifecycle transitions', () => {
  const inspectorSession = new Session();

  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '/floor';
    localStorage.clear();
    localStorage.setItem('table-manager-state-v1:last-account', stateKey);
    localStorage.setItem(
      `table-manager-state-v1:auth:${accountKey}`,
      JSON.stringify({ expiresAt, savedAt: '2026-08-07T12:00:00.000Z' })
    );
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        games: [game],
        profiles: [],
        tournaments: [],
        interests: [],
        sessions: [targetTableWithoutLifecycleFields, otherTable],
        playerSessions: [openTargetPlayerSession, closedTargetPlayerSession, otherTablePlayerSession],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [openTargetDealer, closedTargetDealer, otherTableDealer],
        handCountLogs: [],
        timeFeeLogs: [],
        revenueTransactions: [],
        playerLedger: [],
        tableEvents: [existingEvent],
        inAppNotifications: [],
        history: [],
        nightCloses: [],
        feedback: [],
        scriptTemplates: [],
        correctionLog: [existingCorrection],
        usageEvents: [existingUsage],
        settings: {
          lowLight: false,
          defaultCollectionMode: 'Time',
          defaultTableCap: 8,
          defaultHourlyFee: 12,
          defaultEstimatedDropPerSeatHour: 0,
          collectionProfiles: [],
          membershipPlans: [],
          showPlayerGrid: true,
          showDashboardKpis: false,
          showRecentPlayers: true,
          pilotAccess: {
            authorized: true,
            authorizationCode: 'TYPE-007G-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007G-TEST'
          },
          clubAccount: {
            clubName: 'Local Lifecycle Club',
            accountName: 'Local Lifecycle Account',
            contactName: 'Test Operator',
            email: 'type-007g@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007g@example.test',
            passwordSalt: 'local-test-salt',
            passwordHash: 'local-test-hash',
            createdAt: '2026-08-07T12:00:00.000Z'
          }
        }
      })
    );
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response(JSON.stringify({ ok: true, revision: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        : new Response(null, { status: 404 })
    ));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../components/TableView');
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007gApp');
    Reflect.deleteProperty(globalThis, '__orbitType007gUpdateSession');
    Reflect.deleteProperty(globalThis, '__orbitType007gUpdateSessionTimestamp');
    Reflect.deleteProperty(globalThis, '__orbitType007gRecordTableEvent');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders a table-first route with compact, progressively disclosed utilities', async () => {
    await act(async () => {
      window.location.hash = `/table?sessionId=${targetTableWithoutLifecycleFields.id}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(document.querySelector('.table-view-topbar [title="Back to floor"]')).toBeTruthy();
    expect(document.querySelector('.table-view-identity > span')?.textContent).toBe('Lifecycle Holdem');
    expect(document.querySelector('.table-view-topbar h1')?.textContent).toBe('Feature Table');
    expect(Array.from(document.querySelectorAll('.table-view-meta > span'), (item) => item.textContent?.trim())).toEqual([
      'Forming',
      '1/8 seated',
      'Time'
    ]);
    expect(document.querySelector('.table-view-utilities')?.getAttribute('aria-label')).toBe('Table utilities');
    expect(document.querySelector('.table-view-seat-player-button')?.textContent?.trim()).toBe('Seat player');
    expect(document.querySelector('button[aria-label="Activity, 1 event"]')).toBeTruthy();
    expect(document.querySelector('button[aria-label="Ledger, 0 buy-ins"]')).toBeTruthy();
    expect(document.querySelector('button[aria-label="Timers, 1"]')).toBeTruthy();
    expect(document.querySelector('.table-live-feed-overlay')).toBeNull();
    expect(document.querySelector('.table-buyin-float')).toBeNull();
    expect(document.querySelector('.table-view-time-overview')).toBeNull();
    const centerControls = document.querySelector('[aria-label="Table revenue and dealer controls"]');
    expect(centerControls?.textContent).toContain('Time revenue');
    expect(centerControls?.textContent).toContain('$48.00');
    expect(centerControls?.textContent).toContain('Current: Open Dealer');
    expect(centerControls?.querySelector<HTMLInputElement>('input[aria-label="Dealer selection"]')?.value).toBe('Open Dealer');
    expect(document.querySelector('.table-view-statusbar')?.textContent?.replace(/\s+/g, ' ').trim()).toContain('Average stack $0');

    await act(async () => {
      window.location.hash = '/floor';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
  });

  it('patches a complete session without lifecycle optionals and preserves unrelated fields and ordering', async () => {
    await replaceCapturedState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousOtherTable = previousState.sessions[1];
    const previousEvents = previousState.tableEvents;

    await invokeLifecycleFunction(inspectorSession, 'updateSession', [
      targetTableWithoutLifecycleFields.id,
      { label: 'Renamed Feature Table', seatsFilled: 4 }
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      label: 'Renamed Feature Table',
      seatsFilled: 4,
      endedAt: undefined,
      manualEdits: { label: now, seatsFilled: now }
    });
    expect(nextState.sessions.map((session) => session.id)).toEqual([
      targetTableWithoutLifecycleFields.id,
      otherTable.id
    ]);
    expect(nextState.sessions[1]).toBe(previousOtherTable);
    expect(nextState.tableEvents).toBe(previousEvents);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.usageEvents).toEqual([existingUsage]);
    const persisted = getPersistedState();
    expect(getRecord(persisted.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      label: 'Renamed Feature Table',
      seatsFilled: 4,
      manualEdits: { label: now, seatsFilled: now }
    });
    expect(persisted.tableEvents).toEqual([existingEvent]);
  });

  it('reopens a session with endedAt, clears the end, accumulates edits, and appends a Started event', async () => {
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(targetTableWithLifecycleFields), structuredClone(otherTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'updateSession', [
      targetTableWithLifecycleFields.id,
      { status: 'Running' }
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithLifecycleFields.id)).toEqual({
      ...targetTableWithLifecycleFields,
      status: 'Running',
      endedAt: undefined,
      manualEdits: { startedAt: '2026-08-07T18:05:00.000Z', status: now }
    });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Started',
        gameId: game.id,
        tableId: targetTableWithLifecycleFields.id,
        timestamp: now,
        playerCount: targetTableWithLifecycleFields.seatsFilled,
        note: ''
      }
    ]);
    expect(nextState.playerSessions).toBe(previousState.playerSessions);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.usageEvents).toEqual([existingUsage]);
    const persisted = getPersistedState();
    expect(getRecord(persisted.sessions, targetTableWithLifecycleFields.id)).not.toHaveProperty('endedAt');
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
  });

  it('closes a forming session through updateSession and records Failed to Start without propagating players', async () => {
    await replaceCapturedState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'updateSession', [
      targetTableWithoutLifecycleFields.id,
      { status: 'Closed' }
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      status: 'Closed',
      endedAt: now,
      manualEdits: { status: now }
    });
    expect(nextState.playerSessions).toBe(previousState.playerSessions);
    expect(nextState.dealerAssignments).toBe(previousState.dealerAssignments);
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Failed to Start',
        gameId: game.id,
        tableId: targetTableWithoutLifecycleFields.id,
        timestamp: now,
        playerCount: targetTableWithoutLifecycleFields.seatsFilled,
        note: ''
      }
    ]);
    expect(getPersistedState().sessions).toEqual(nextState.sessions);
  });

  it('corrects an empty endedAt without existing manual edits and prepends an audit entry', async () => {
    await replaceCapturedState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'updateSessionTimestamp', [
      targetTableWithoutLifecycleFields.id,
      'endedAt',
      ''
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      endedAt: undefined,
      manualEdits: { endedAt: now }
    });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expectCorrection(nextState, targetTableWithoutLifecycleFields.id, 'endedAt');
    expect(nextState.tableEvents).toBe(previousState.tableEvents);
    expect(nextState.usageEvents).toEqual([existingUsage]);
    const persisted = getPersistedState();
    expect(getRecord(persisted.sessions, targetTableWithoutLifecycleFields.id)).not.toHaveProperty('endedAt');
    expect(persisted.correctionLog).toEqual(nextState.correctionLog);
  });

  it('corrects startedAt with existing endedAt and manual edits while preserving all other session fields', async () => {
    const input = '2026-08-07T19:30';
    const correctedStartedAt = new Date(input).toISOString();
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(targetTableWithLifecycleFields), structuredClone(otherTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'updateSessionTimestamp', [
      targetTableWithLifecycleFields.id,
      'startedAt',
      input
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithLifecycleFields.id)).toEqual({
      ...targetTableWithLifecycleFields,
      startedAt: correctedStartedAt,
      manualEdits: { startedAt: now }
    });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expectCorrection(nextState, targetTableWithLifecycleFields.id, 'startedAt');
    const persisted = getPersistedState();
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.correctionLog).toEqual(nextState.correctionLog);
  });

  it('records a normal table event without changing status, player sessions, dealers, or audit history', async () => {
    const runningTable = {
      ...targetTableWithLifecycleFields,
      status: 'Running',
      endedAt: '2026-08-07T21:30:00.000Z'
    };
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(runningTable), structuredClone(otherTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'recordTableEvent', [
      runningTable,
      'Merged',
      'player move',
      'Moved one player to balance tables'
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, runningTable.id)).toEqual(runningTable);
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expect(nextState.playerSessions).toBe(previousState.playerSessions);
    expect(nextState.dealerAssignments).toBe(previousState.dealerAssignments);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Merged',
        gameId: game.id,
        tableId: runningTable.id,
        timestamp: now,
        playerCount: runningTable.seatsFilled,
        reason: 'player move',
        note: 'Moved one player to balance tables'
      }
    ]);
    expectRecordedEventUsage(nextState, 'Merged', 'player move');
    const persisted = getPersistedState();
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.playerSessions).toEqual(nextState.playerSessions);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
    expect(persisted.usageEvents).toEqual(nextState.usageEvents);
  });

  it('records Started by moving the target to Running without closing players or dealers', async () => {
    await replaceCapturedState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'recordTableEvent', [
      targetTableWithoutLifecycleFields,
      'Started',
      'minimum players met',
      'Opened on schedule'
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      status: 'Running',
      endedAt: undefined
    });
    expect(nextState.playerSessions).toBe(previousState.playerSessions);
    expect(nextState.dealerAssignments).toBe(previousState.dealerAssignments);
    expect(nextState.tableEvents[0]).toBe(previousState.tableEvents[0]);
    expect(getRecord(nextState.tableEvents, nextState.tableEvents[1].id)).toEqual({
      id: expect.any(String),
      type: 'Started',
      gameId: game.id,
      tableId: targetTableWithoutLifecycleFields.id,
      timestamp: now,
      playerCount: targetTableWithoutLifecycleFields.seatsFilled,
      reason: 'minimum players met',
      note: 'Opened on schedule'
    });
    expectRecordedEventUsage(nextState, 'Started', 'minimum players met');
    expect(getPersistedState().sessions).toEqual(nextState.sessions);
  });

  it('records Closed, ends only open players and dealers at the target table, and preserves field/order contracts', async () => {
    const runningTarget = { ...targetTableWithoutLifecycleFields, status: 'Running' };
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(runningTarget), structuredClone(otherTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'recordTableEvent', [
      runningTarget,
      'Closed',
      'Staff closed table',
      ''
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, runningTarget.id)).toEqual({
      ...runningTarget,
      status: 'Closed',
      seatsFilled: 0,
      endedAt: now
    });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expect(nextState.playerSessions.map((playerSession) => playerSession.id)).toEqual([
      openTargetPlayerSession.id,
      closedTargetPlayerSession.id,
      otherTablePlayerSession.id
    ]);
    expect(getRecord(nextState.playerSessions, openTargetPlayerSession.id)).toEqual({
      ...openTargetPlayerSession,
      leftAt: now,
      manualEdits: { seatNumber: '2026-08-07T19:05:00.000Z', leftAt: now }
    });
    expect(nextState.playerSessions[1]).toBe(previousState.playerSessions[1]);
    expect(nextState.playerSessions[2]).toBe(previousState.playerSessions[2]);
    expect(getRecord(nextState.dealerAssignments, openTargetDealer.id)).toEqual({
      ...openTargetDealer,
      endedAt: now
    });
    expect(nextState.dealerAssignments[1]).toBe(previousState.dealerAssignments[1]);
    expect(nextState.dealerAssignments[2]).toBe(previousState.dealerAssignments[2]);
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Closed',
        gameId: game.id,
        tableId: runningTarget.id,
        timestamp: now,
        playerCount: runningTarget.seatsFilled,
        reason: 'Staff closed table',
        note: ''
      }
    ]);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.playerLedger).toEqual([
      {
        id: expect.any(String),
        type: 'Cash-Out',
        profileId: openTargetPlayerSession.profileId,
        playerName: openTargetPlayerSession.playerName,
        tableId: runningTarget.id,
        gameId: game.id,
        timestamp: now,
        note: 'Table closed by staff'
      }
    ]);
    expectRecordedEventUsage(nextState, 'Closed', 'Staff closed table');
    const persisted = getPersistedState();
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.playerSessions).toEqual(nextState.playerSessions);
    expect(persisted.dealerAssignments).toEqual(nextState.dealerAssignments);
    expect(persisted.playerLedger).toEqual(nextState.playerLedger);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
  });

  it('records Broke while retaining an existing table end and closing only still-open target players', async () => {
    const alreadyEndedRunningTarget = { ...targetTableWithLifecycleFields, status: 'Running' };
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(alreadyEndedRunningTarget), structuredClone(otherTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'recordTableEvent', [
      alreadyEndedRunningTarget,
      'Broke',
      'Short game',
      'Two players left together'
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, alreadyEndedRunningTarget.id)).toEqual({
      ...alreadyEndedRunningTarget,
      status: 'Closed',
      seatsFilled: 0
    });
    expect(getRecord(nextState.playerSessions, openTargetPlayerSession.id)).toEqual({
      ...openTargetPlayerSession,
      leftAt: now,
      manualEdits: { seatNumber: '2026-08-07T19:05:00.000Z', leftAt: now }
    });
    expect(nextState.playerSessions[1]).toBe(previousState.playerSessions[1]);
    expect(nextState.playerSessions[2]).toBe(previousState.playerSessions[2]);
    expect(getRecord(nextState.dealerAssignments, openTargetDealer.id)).toEqual({
      ...openTargetDealer,
      endedAt: now
    });
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Broke',
        gameId: game.id,
        tableId: alreadyEndedRunningTarget.id,
        timestamp: now,
        playerCount: alreadyEndedRunningTarget.seatsFilled,
        reason: 'Short game',
        note: 'Two players left together'
      }
    ]);
    expectRecordedEventUsage(nextState, 'Broke', 'Short game');
    expect(nextState.playerLedger).toEqual([
      {
        id: expect.any(String),
        type: 'Cash-Out',
        profileId: openTargetPlayerSession.profileId,
        playerName: openTargetPlayerSession.playerName,
        tableId: alreadyEndedRunningTarget.id,
        gameId: game.id,
        timestamp: now,
        note: 'Table broke; player session closed by staff'
      }
    ]);
    expect(getPersistedState().playerSessions).toEqual(nextState.playerSessions);
    expect(getPersistedState().playerLedger).toEqual(nextState.playerLedger);
  });

  it('records Failed to Start by ending the table and open dealer without changing player sessions', async () => {
    await replaceCapturedState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeLifecycleFunction(inspectorSession, 'recordTableEvent', [
      targetTableWithoutLifecycleFields,
      'Failed to Start',
      'Insufficient demand',
      'Only three players arrived'
    ]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(getRecord(nextState.sessions, targetTableWithoutLifecycleFields.id)).toEqual({
      ...targetTableWithoutLifecycleFields,
      status: 'Failed to Start',
      endedAt: now
    });
    expect(nextState.playerSessions).toBe(previousState.playerSessions);
    expect(getRecord(nextState.dealerAssignments, openTargetDealer.id)).toEqual({
      ...openTargetDealer,
      endedAt: now
    });
    expect(nextState.dealerAssignments[1]).toBe(previousState.dealerAssignments[1]);
    expect(nextState.dealerAssignments[2]).toBe(previousState.dealerAssignments[2]);
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Failed to Start',
        gameId: game.id,
        tableId: targetTableWithoutLifecycleFields.id,
        timestamp: now,
        playerCount: targetTableWithoutLifecycleFields.seatsFilled,
        reason: 'Insufficient demand',
        note: 'Only three players arrived'
      }
    ]);
    expectRecordedEventUsage(nextState, 'Failed to Start', 'Insufficient demand');
    const persisted = getPersistedState();
    expect(persisted.playerSessions).toEqual(previousState.playerSessions);
    expect(persisted.dealerAssignments).toEqual(nextState.dealerAssignments);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
  });
});
