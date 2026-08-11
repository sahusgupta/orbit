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
  games: IdentifiedRecord[];
  inAppNotifications: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  settings: Record<string, unknown>;
  tableEvents: IdentifiedRecord[];
  usageEvents: IdentifiedRecord[];
};

type PlanningFixtures = Partial<
  Pick<
    CapturedState,
    | 'inAppNotifications'
    | 'interests'
    | 'playerSessions'
    | 'profiles'
    | 'sessions'
    | 'settings'
    | 'tableEvents'
    | 'usageEvents'
  >
>;

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  startPlayerDrafts: undefined as unknown,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isCapturedState = (value: unknown): value is CapturedState => {
  if (typeof value !== 'object' || value === null) return false;
  const settings: unknown = Reflect.get(value, 'settings');
  return (
    typeof settings === 'object' &&
    settings !== null &&
    ['games', 'inAppNotifications', 'interests', 'playerSessions', 'profiles', 'sessions', 'tableEvents', 'usageEvents'].every(
      (key) => {
        const records: unknown = Reflect.get(value, key);
        return Array.isArray(records) && records.every(isIdentifiedRecord);
      }
    )
  );
};

const isStringArrayRecord = (value: unknown): value is Record<string, string[]> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, item]) => Array.isArray(item) && item.every((part) => typeof part === 'string'));
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];
      if (isCapturedState(value) && value.games.some((candidate) => candidate.id === 'game-planning')) {
        harness.latestState = value;
        harness.stateSetter = result[1];
      }
      if (isStringArrayRecord(value)) harness.startPlayerDrafts = value;
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
const accountKey = 'type-007e-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const game = {
  id: 'game-planning',
  name: 'Planning Holdem',
  maxSeats: 8,
  minInRoomForLikely: 2,
  minFlexibleForLikely: 3,
  minTotalForViable: 6
};
const otherGame = {
  id: 'game-other',
  name: 'Other Omaha',
  maxSeats: 6,
  minInRoomForLikely: 2,
  minFlexibleForLikely: 3,
  minTotalForViable: 5
};
const existingEvent: IdentifiedRecord = {
  id: 'event-existing',
  type: 'Started',
  gameId: otherGame.id,
  tableId: 'table-other-game',
  timestamp: '2026-08-07T18:00:00.000Z',
  playerCount: 4,
  note: 'Existing event'
};
const existingNotification: IdentifiedRecord = {
  id: 'notification-existing',
  clubId: accountKey,
  gameId: otherGame.id,
  title: otherGame.name,
  body: 'Existing notification',
  reason: 'seat-opened',
  createdAt: '2026-08-07T21:00:00.000Z',
  expiresAt: '2026-08-08T01:00:00.000Z',
  targetPlayerIds: ['profile-existing'],
  targetPlayerNames: ['Existing Player']
};
const existingUsage: IdentifiedRecord = {
  id: 'usage-existing',
  feature: 'Earlier feature',
  action: 'Earlier action',
  route: 'floor',
  timestamp: '2026-08-07T20:00:00.000Z',
  accountKey
};
const baseSettings = {
  lowLight: false,
  defaultCollectionMode: 'Drop',
  defaultTableCap: 8,
  defaultHourlyFee: 12,
  defaultEstimatedDropPerSeatHour: 5,
  collectionProfiles: [
    {
      gameId: game.id,
      collectionMode: 'Time',
      hourlyFee: 14,
      estimatedDropPerSeatHour: 0
    }
  ],
  membershipPlans: [],
  showPlayerGrid: true,
  showDashboardKpis: false,
  showRecentPlayers: true,
  pilotAccess: {
    authorized: true,
    authorizationCode: 'TYPE-007E-TEST-CODE',
    expiresAt: '2099-12-31T23:59:59.000Z',
    activatedAt: '2026-08-07T12:00:00.000Z',
    licenseId: 'TYPE-007E-TEST'
  },
  clubAccount: {
    clubName: 'Local Planning Club',
    accountName: 'Local Planning Account',
    contactName: 'Test Operator',
    email: 'type-007e@example.test',
    phone: '',
    address: ''
  },
  staffAccounts: [],
  accountLogin: {
    username: 'type-007e@example.test',
    passwordSalt: 'local-test-salt',
    passwordHash: 'local-test-hash',
    createdAt: '2026-08-07T12:00:00.000Z'
  }
};

const buildInterest = (index: number, status = 'Interested'): IdentifiedRecord => ({
  id: `interest-${index}`,
  profileId: `profile-${index}`,
  playerName: `Player ${index}`,
  gameId: game.id,
  status,
  timestamp: `2026-08-07T19:${String(index).padStart(2, '0')}:00.000Z`,
  interestedAt: `2026-08-07T19:${String(index).padStart(2, '0')}:00.000Z`,
  notes: `Interest ${index}`
});

const eligibleProfile: IdentifiedRecord = {
  id: 'profile-notification',
  name: 'Notification Player',
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 12,
  lastSessionTimePlayedHours: 2,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: { [game.id]: 4, [otherGame.id]: 1 },
  mostPlayedGameId: game.id,
  preferredStakes: game.name,
  typicalBuyInMin: 200,
  typicalBuyInMax: 500,
  willingnessToMove: true,
  typicalAvailability: 'Evenings',
  usualCompanions: [],
  preferredTags: ['Social'],
  notes: 'Eligible notification fixture'
};

const closedTable: IdentifiedRecord = {
  id: 'table-closed',
  gameId: game.id,
  label: 'Closed Feature Table',
  status: 'Closed',
  seatsFilled: 0,
  maxSeats: 8,
  timeFeeBased: false,
  collectionMode: 'Drop',
  tags: ['Relaxed'],
  startedAt: '2026-08-07T15:00:00.000Z',
  endedAt: '2026-08-07T17:00:00.000Z',
  manualEdits: { label: '2026-08-07T15:05:00.000Z' }
};
const otherGameTable: IdentifiedRecord = {
  id: 'table-other-game',
  gameId: otherGame.id,
  label: 'Other Game Table',
  status: 'Running',
  seatsFilled: 4,
  maxSeats: 6,
  timeFeeBased: false,
  collectionMode: 'Drop',
  tags: ['Action'],
  startedAt: '2026-08-07T16:00:00.000Z'
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
  Reflect.set(globalThis, '__orbitType007eApp', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType007eApp' });
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
    expression: 'globalThis.__orbitType007eApp.toString()',
    returnByValue: true
  });
  const source = sourceResult.result.value;
  if (typeof source !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = source.split(/\r?\n/).findIndex((line) => line.includes('const updateSession'));
  if (relativeLineNumber < 0) throw new Error('Expected the table-planning boundary in the App source');
  appBreakpointLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  return appBreakpointLocation;
};

const armPlanningFunctionCapture = async (session: Session) => {
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
              'globalThis.__orbitType007eAddSession = addSession; ' +
              'globalThis.__orbitType007eCreateBalancedTable = createBalancedTable; ' +
              'globalThis.__orbitType007eSetStartPlayerDrafts = setStartPlayerDrafts; ' +
              'globalThis.__orbitType007eStartSessionWithPlayers = startSessionWithPlayers; true'
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

const replaceCapturedState = async (session: Session, fixtures: PlanningFixtures = {}) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  const capture = await armPlanningFunctionCapture(session);
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        inAppNotifications: fixtures.inAppNotifications ?? [structuredClone(existingNotification)],
        interests: fixtures.interests ?? [],
        playerSessions: fixtures.playerSessions ?? [],
        profiles: fixtures.profiles ?? [],
        sessions: fixtures.sessions ?? [structuredClone(closedTable), structuredClone(otherGameTable)],
        settings: fixtures.settings ?? structuredClone(baseSettings),
        tableEvents: fixtures.tableEvents ?? [structuredClone(existingEvent)],
        usageEvents: fixtures.usageEvents ?? [structuredClone(existingUsage)]
      };
    });
  });
  await capture.completed;
};

type PlanningFunctionName = 'addSession' | 'createBalancedTable' | 'setStartPlayerDrafts' | 'startSessionWithPlayers';

const invokePlanningFunction = async (session: Session, bindingName: PlanningFunctionName, args: unknown[]) => {
  const globalName = {
    addSession: '__orbitType007eAddSession',
    createBalancedTable: '__orbitType007eCreateBalancedTable',
    setStartPlayerDrafts: '__orbitType007eSetStartPlayerDrafts',
    startSessionWithPlayers: '__orbitType007eStartSessionWithPlayers'
  }[bindingName];
  const evaluated = await session.post('Runtime.evaluate', { expression: `globalThis.${globalName}` });
  const functionObjectId = evaluated.result.objectId;
  if (!functionObjectId) throw new Error(`Expected the captured ${bindingName} function`);
  await act(async () => {
    await session.post('Runtime.callFunctionOn', {
      objectId: functionObjectId,
      functionDeclaration: 'function () { return this.apply(undefined, arguments); }',
      arguments: args.map((value) => ({ value })),
      returnByValue: true
    });
  });
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the planning state to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const expectPreviousStateUnchanged = (previousState: CapturedState, previousSnapshot: CapturedState) => {
  expect(previousState).toEqual(previousSnapshot);
  expect(getLatestState()).not.toBe(previousState);
};

describe('forming and balanced table planning', () => {
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
        games: [game, otherGame],
        profiles: [],
        tournaments: [],
        interests: [],
        sessions: [closedTable, otherGameTable],
        playerSessions: [],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [],
        handCountLogs: [],
        timeFeeLogs: [],
        revenueTransactions: [],
        playerLedger: [],
        tableEvents: [existingEvent],
        inAppNotifications: [existingNotification],
        history: [],
        nightCloses: [],
        feedback: [],
        scriptTemplates: [],
        correctionLog: [],
        usageEvents: [existingUsage],
        settings: baseSettings
      })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007eApp');
    Reflect.deleteProperty(globalThis, '__orbitType007eAddSession');
    Reflect.deleteProperty(globalThis, '__orbitType007eCreateBalancedTable');
    Reflect.deleteProperty(globalThis, '__orbitType007eSetStartPlayerDrafts');
    Reflect.deleteProperty(globalThis, '__orbitType007eStartSessionWithPlayers');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('creates the first forming table with configured collection, capped drafts, events, notifications, and persistence', async () => {
    const openInterests = Array.from({ length: 9 }, (_, index) => buildInterest(index + 1));
    const closedInterest = buildInterest(10, 'Declined');
    await replaceCapturedState(inspectorSession, {
      interests: [...openInterests, closedInterest],
      profiles: [structuredClone(eligibleProfile)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokePlanningFunction(inspectorSession, 'addSession', [game.id]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(nextState.sessions.slice(0, -1)).toEqual(previousState.sessions);
    expect(nextState.sessions[0]).toBe(previousState.sessions[0]);
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    const createdSession = nextState.sessions.at(-1);
    expect(createdSession).toEqual({
      id: expect.any(String),
      gameId: game.id,
      label: 'Main Table',
      status: 'Forming',
      seatsFilled: 0,
      maxSeats: game.maxSeats,
      timeFeeBased: true,
      collectionMode: 'Time',
      tags: [],
      startedAt: now
    });
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Created',
        gameId: game.id,
        timestamp: now,
        playerCount: 0,
        note: 'Table forming'
      }
    ]);
    expect(nextState.inAppNotifications).toEqual([
      {
        id: expect.any(String),
        clubId: accountKey,
        gameId: game.id,
        title: game.name,
        body: `${game.name} is forming right now at Local Planning Club! Text back to get on the waitlist`,
        reason: 'game-forming',
        createdAt: now,
        expiresAt: '2026-08-08T02:00:00.000Z',
        targetPlayerIds: [eligibleProfile.id],
        targetPlayerNames: [eligibleProfile.name]
      },
      existingNotification
    ]);
    expect(nextState.usageEvents).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        feature: 'Tables',
        action: 'Created forming table',
        route: 'floor',
        timestamp: now,
        accountKey,
        metadata: { gameId: game.id }
      }),
      existingUsage
    ]);
    if (!createdSession || !isStringArrayRecord(harness.startPlayerDrafts)) {
      throw new Error('Expected the created table drafts to be captured');
    }
    expect(harness.startPlayerDrafts[createdSession.id]).toEqual(openInterests.slice(0, game.maxSeats).map((interest) => interest.id));
    const persisted = getPersistedState();
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
    expect(persisted.inAppNotifications).toEqual(nextState.inAppNotifications);
    expect(persisted.usageEvents).toEqual(nextState.usageEvents);
  });

  it('counts only open same-game tables and falls back to the default Drop collection profile', async () => {
    const runningTable = {
      ...closedTable,
      id: 'table-running',
      label: 'Existing Main Table',
      status: 'Running',
      endedAt: undefined
    };
    const previousNotifications = [structuredClone(existingNotification)];
    await replaceCapturedState(inspectorSession, {
      inAppNotifications: previousNotifications,
      interests: [buildInterest(1, 'Confirmed Coming')],
      profiles: [],
      sessions: [structuredClone(runningTable), structuredClone(closedTable), structuredClone(otherGameTable)],
      settings: { ...structuredClone(baseSettings), collectionProfiles: [] }
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokePlanningFunction(inspectorSession, 'addSession', [game.id]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(nextState.sessions.at(-1)).toEqual({
      id: expect.any(String),
      gameId: game.id,
      label: 'Table 2',
      status: 'Forming',
      seatsFilled: 0,
      maxSeats: game.maxSeats,
      timeFeeBased: false,
      collectionMode: 'Drop',
      tags: [],
      startedAt: now
    });
    expect(nextState.sessions.slice(0, 3)).toEqual(previousState.sessions);
    expect(nextState.inAppNotifications).toBe(previousState.inAppNotifications);
    expect(nextState.tableEvents.at(-1)).toMatchObject({ type: 'Created', gameId: game.id, note: 'Table forming' });
  });

  it('balances a complete source table, removes moved IDs, preserves order and records the exact appended table and event', async () => {
    const sourceTable = {
      id: 'table-a',
      gameId: game.id,
      label: 'Feature Table A',
      status: 'Running',
      seatsFilled: 8,
      maxSeats: 8,
      timeFeeBased: true,
      collectionMode: 'Time',
      plannedPlayerIds: ['interest-keep-a', 'interest-move-a', 'interest-move-b', 'interest-keep-b'],
      tags: ['Action', 'Full-ring'],
      startedAt: '2026-08-07T17:00:00.000Z',
      manualEdits: { label: '2026-08-07T17:05:00.000Z' }
    };
    const secondOpenTable = {
      ...otherGameTable,
      id: 'table-same-game',
      gameId: game.id,
      label: 'Feature Table C',
      status: 'Forming',
      seatsFilled: 2,
      maxSeats: 8,
      tags: ['Social']
    };
    const moveA = buildInterest(21, 'Arrived');
    moveA.id = 'interest-move-a';
    const moveB = buildInterest(22, 'Confirmed Coming');
    moveB.id = 'interest-move-b';
    const plan = {
      game,
      demand: { interested: 2, confirmed: 3, waiting: 1, inRoom: 8, totalDemand: 14 },
      fromTable: structuredClone(sourceTable),
      moveCandidates: [
        { id: moveB.id, playerName: moveB.playerName, interest: moveB, confidence: 98, reasons: ['Arrived'], source: 'interest' },
        { id: moveA.id, playerName: moveA.playerName, interest: moveA, confidence: 95, reasons: ['Flexible'], source: 'interest' }
      ],
      tableASeatsAfterMove: 6,
      tableBProjectedSeats: 6,
      nextStep: 'Move two players'
    };
    const planSnapshot = structuredClone(plan);
    await replaceCapturedState(inspectorSession, {
      sessions: [structuredClone(sourceTable), structuredClone(secondOpenTable), structuredClone(closedTable), structuredClone(otherGameTable)]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokePlanningFunction(inspectorSession, 'createBalancedTable', [plan]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(plan).toEqual(planSnapshot);
    expect(nextState.sessions.map((session) => session.id)).toEqual([
      sourceTable.id,
      secondOpenTable.id,
      closedTable.id,
      otherGameTable.id,
      expect.any(String)
    ]);
    expect(nextState.sessions[0]).toEqual({
      ...sourceTable,
      seatsFilled: 6,
      plannedPlayerIds: ['interest-keep-a', 'interest-keep-b']
    });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expect(nextState.sessions[2]).toBe(previousState.sessions[2]);
    expect(nextState.sessions[3]).toBe(previousState.sessions[3]);
    expect(nextState.sessions.at(-1)).toEqual({
      id: expect.any(String),
      gameId: game.id,
      label: 'Balanced Table 3',
      status: 'Forming',
      seatsFilled: 6,
      maxSeats: game.maxSeats,
      timeFeeBased: true,
      collectionMode: 'Time',
      plannedPlayerIds: [moveB.id, moveA.id],
      tags: [],
      startedAt: now
    });
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Created',
        gameId: game.id,
        tableId: sourceTable.id,
        timestamp: now,
        playerCount: 6,
        note: `Table B created from Table A balance option: ${moveB.playerName}, ${moveA.playerName}`
      }
    ]);
    expect(nextState.usageEvents).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        feature: 'Table builder',
        action: 'Created balanced table',
        route: 'floor',
        timestamp: now,
        accountKey,
        metadata: { gameId: game.id, players: 6 }
      }),
      existingUsage
    ]);
    const persisted = getPersistedState();
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
    expect(persisted.usageEvents).toEqual(nextState.usageEvents);
  });

  it('balances a source table without planned IDs and preserves the existing Drop fallback contract', async () => {
    const sourceWithoutPlannedIds = {
      id: 'table-no-plans',
      gameId: game.id,
      label: 'No Plans Table',
      status: 'Running',
      seatsFilled: 7,
      maxSeats: 8,
      timeFeeBased: false,
      tags: ['Relaxed'],
      startedAt: '2026-08-07T18:00:00.000Z'
    };
    const mover = buildInterest(31, 'Arrived');
    const plan = {
      game,
      demand: { interested: 2, confirmed: 3, waiting: 1, inRoom: 7, totalDemand: 13 },
      fromTable: structuredClone(sourceWithoutPlannedIds),
      moveCandidates: [
        { id: mover.id, playerName: mover.playerName, interest: mover, confidence: 90, reasons: ['Arrived'], source: 'interest' }
      ],
      tableASeatsAfterMove: 6,
      tableBProjectedSeats: 5,
      nextStep: 'Move one player'
    };
    await replaceCapturedState(inspectorSession, { sessions: [structuredClone(sourceWithoutPlannedIds)] });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokePlanningFunction(inspectorSession, 'createBalancedTable', [plan]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(nextState.sessions[0]).toEqual({ ...sourceWithoutPlannedIds, seatsFilled: 6, plannedPlayerIds: [] });
    expect(nextState.sessions[1]).toEqual({
      id: expect.any(String),
      gameId: game.id,
      label: 'Balanced Table 2',
      status: 'Forming',
      seatsFilled: 5,
      maxSeats: game.maxSeats,
      timeFeeBased: false,
      collectionMode: 'Drop',
      plannedPlayerIds: [mover.id],
      tags: [],
      startedAt: now
    });
  });

  it('starts a forming table with selected players in source order and records the exact lifecycle outcome', async () => {
    const formingTable = {
      id: 'table-start-selected',
      gameId: game.id,
      label: 'Selected Start Table',
      status: 'Forming',
      seatsFilled: 0,
      maxSeats: 8,
      timeFeeBased: false,
      collectionMode: 'Drop',
      tags: [],
      startedAt: '2026-08-07T19:00:00.000Z'
    };
    const selectedA = buildInterest(41, 'Arrived');
    const selectedB = buildInterest(42, 'Confirmed Coming');
    await replaceCapturedState(inspectorSession, {
      interests: [selectedA, selectedB],
      sessions: [formingTable],
      tableEvents: [],
      usageEvents: []
    });
    const draftCapture = await armPlanningFunctionCapture(inspectorSession);
    await invokePlanningFunction(inspectorSession, 'setStartPlayerDrafts', [{
      [formingTable.id]: [selectedB.id, selectedA.id]
    }]);
    await draftCapture.completed;
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokePlanningFunction(inspectorSession, 'startSessionWithPlayers', [formingTable]);

    const nextState = getLatestState();
    expectPreviousStateUnchanged(previousState, previousSnapshot);
    expect(nextState.sessions[0]).toEqual({ ...formingTable, status: 'Running', seatsFilled: 2, startedAt: now });
    expect(nextState.playerSessions.map((playerSession) => playerSession.playerName)).toEqual([
      selectedA.playerName,
      selectedB.playerName
    ]);
    expect(nextState.playerSessions.map((playerSession) => playerSession.seatNumber)).toEqual([1, 2]);
    expect(nextState.interests.map((interest) => interest.status)).toEqual(['Seated', 'Seated']);
    expect(nextState.tableEvents).toEqual([{
      id: expect.any(String),
      type: 'Started',
      gameId: game.id,
      tableId: formingTable.id,
      timestamp: now,
      playerCount: 2,
      note: `Started with ${selectedA.playerName}, ${selectedB.playerName} - messaging trigger: Local Planning Club`
    }]);
    expect(nextState.usageEvents).toEqual([expect.objectContaining({
      feature: 'Tables',
      action: 'Started table',
      metadata: { gameId: game.id, players: 2 }
    })]);
    if (!isStringArrayRecord(harness.startPlayerDrafts)) throw new Error('Expected start-player drafts');
    expect(harness.startPlayerDrafts[formingTable.id]).toEqual([]);
    expect(getPersistedState().sessions).toEqual(nextState.sessions);
    expect(getPersistedState().playerSessions).toEqual(nextState.playerSessions);
    expect(getPersistedState().tableEvents).toEqual(nextState.tableEvents);
  });
});
