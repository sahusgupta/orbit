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
  buyIns: IdentifiedRecord[];
  correctionLog: IdentifiedRecord[];
  dealerAssignments: IdentifiedRecord[];
  dropLogs: IdentifiedRecord[];
  games: IdentifiedRecord[];
  handCountLogs: IdentifiedRecord[];
  inAppNotifications: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  playerLedger: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  tableEvents: IdentifiedRecord[];
  timeFeeLogs: IdentifiedRecord[];
  usageEvents: IdentifiedRecord[];
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
    'buyIns',
    'correctionLog',
    'dealerAssignments',
    'dropLogs',
    'games',
    'handCountLogs',
    'inAppNotifications',
    'interests',
    'playerLedger',
    'playerSessions',
    'profiles',
    'sessions',
    'tableEvents',
    'timeFeeLogs',
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
      if (isCapturedState(value) && value.games.some((candidate) => candidate.id === 'game-departure')) {
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
const accountKey = 'type-007d-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const playerName = 'Case Player';
const game = {
  id: 'game-departure',
  name: 'Departure Holdem',
  maxSeats: 8,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};
const table = {
  id: 'table-departure',
  gameId: game.id,
  label: 'Departure Table',
  status: 'Running',
  seatsFilled: 2,
  maxSeats: 8,
  timeFeeBased: true,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-07T18:00:00.000Z'
};
const unrelatedSession = {
  id: 'session-unrelated',
  playerName: 'Unrelated Player',
  profileId: 'profile-unrelated',
  gameId: game.id,
  tableId: table.id,
  seatNumber: 6,
  seatedAt: '2026-08-07T21:00:00.000Z',
  timePurchasedMinutes: 60,
  timeRemainingMinutes: 30,
  lastTimeTickAt: '2026-08-07T21:30:00.000Z',
  timeFeeEnabled: true,
  manualEdits: { seatNumber: '2026-08-07T21:01:00.000Z' }
};
const existingLedger = {
  id: 'ledger-existing',
  type: 'Check-In',
  profileId: 'profile-unrelated',
  playerName: unrelatedSession.playerName,
  tableId: table.id,
  gameId: game.id,
  timestamp: unrelatedSession.seatedAt,
  note: 'Existing ledger entry'
};
const existingNotification = {
  id: 'notification-existing',
  clubId: accountKey,
  gameId: game.id,
  title: 'Existing notice',
  body: 'Preserve this notice',
  reason: 'seat-opened',
  createdAt: '2026-08-07T20:00:00.000Z',
  targetPlayerIds: ['profile-unrelated'],
  targetPlayerNames: [unrelatedSession.playerName]
};
const existingCorrection = {
  id: 'correction-existing',
  entity: 'Earlier record',
  field: 'notes',
  note: 'Preserve audit history',
  timestamp: '2026-08-07T20:00:00.000Z'
};

const buildProfile = (id: string, name: string, totalTimePlayedHours = 10): IdentifiedRecord => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours,
  lastSessionTimePlayedHours: 1,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: {},
  mostPlayedGameId: game.id,
  preferredStakes: '1/2',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: true,
  typicalAvailability: 'Evenings',
  usualCompanions: [],
  preferredTags: [],
  notes: `${id} remains otherwise unchanged`
});

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
  Reflect.set(globalThis, '__orbitType007dApp', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType007dApp' });
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
  const appSourceResult = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007dApp.toString()',
    returnByValue: true
  });
  const appSource = appSourceResult.result.value;
  if (typeof appSource !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = appSource.split(/\r?\n/).findIndex((line) => line.includes('const requestPlayerCashOut'));
  if (relativeLineNumber < 0) throw new Error('Expected the player departure boundary in the App source');
  appBreakpointLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  return appBreakpointLocation;
};

const armDepartureFunctionCapture = async (session: Session) => {
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
              'globalThis.__orbitType007dSeatPlayerInState = seatPlayerInState; ' +
              'globalThis.__orbitType007dSetTableCollectionMode = setTableCollectionMode; ' +
              'globalThis.__orbitType007dAddPlayerTime = addPlayerTime; ' +
              'globalThis.__orbitType007dAddBuyIn = addBuyIn; ' +
              'globalThis.__orbitType007dAddTableDrop = addTableDrop; ' +
              'globalThis.__orbitType007dAssignDealer = assignDealer; ' +
              'globalThis.__orbitType007dEndDealerAssignment = endDealerAssignment; ' +
              'globalThis.__orbitType007dRecordHands = recordHands; ' +
              'globalThis.__orbitType007dSetDropDrafts = setDropDrafts; ' +
              'globalThis.__orbitType007dSetDealerDrafts = setDealerDrafts; ' +
              'globalThis.__orbitType007dSetHandCountDrafts = setHandCountDrafts; ' +
              'globalThis.__orbitType007dMovePlayerToTable = movePlayerToTable; ' +
              'globalThis.__orbitType007dMarkPlayerLeft = markPlayerLeft; ' +
              'globalThis.__orbitType007dMarkPlayerSessionLeft = markPlayerSessionLeft; true'
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

const invokeDeparture = async (session: Session, playerSession: IdentifiedRecord) => {
  await invokeCapturedFunction(session, '__orbitType007dMarkPlayerSessionLeft', [playerSession, 75, '  Test cash out  ']);
};

const invokeCapturedFunction = async (session: Session, globalName: string, args: unknown[]) => {
  const serializedArgs = JSON.stringify(args);
  if (!serializedArgs) throw new Error(`Expected serializable arguments for ${globalName}`);
  let result: unknown;
  await act(async () => {
    const called = await session.post('Runtime.evaluate', {
      expression: `globalThis.${globalName}(...${serializedArgs})`,
      awaitPromise: true,
      returnByValue: true
    });
    result = called.result.value;
  });
  return result;
};

const invokeAndRecapture = async (session: Session, globalName: string, args: unknown[]) => {
  const capture = await armDepartureFunctionCapture(session);
  const result = await invokeCapturedFunction(session, globalName, args);
  await capture.completed;
  return result;
};

const getSuccessfulCommandState = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Reflect.get(value, 'ok') !== true) {
    throw new Error('Expected a successful command result');
  }
  const nextState: unknown = Reflect.get(value, 'state');
  if (!isCapturedState(nextState)) throw new Error('Expected a complete command state');
  return nextState;
};

const replaceCapturedState = async (session: Session, patch: Record<string, unknown>) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  const capture = await armDepartureFunctionCapture(session);
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return { ...current, ...patch };
    });
  });
  await capture.completed;
};

const getRecord = (records: IdentifiedRecord[], id: string) => {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Expected record ${id}`);
  return record;
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the departure state to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const resetState = async (session: Session, profiles: IdentifiedRecord[], profileId?: string) => {
  const targetSession: IdentifiedRecord = {
    id: 'session-target',
    playerName,
    ...(profileId ? { profileId } : {}),
    gameId: game.id,
    tableId: table.id,
    seatNumber: 3,
    seatedAt: '2026-08-07T20:00:00.000Z',
    timePurchasedMinutes: 120,
    timeRemainingMinutes: 45,
    lastTimeTickAt: '2026-08-07T21:45:00.000Z',
    timeFeeEnabled: true,
    manualEdits: { seatNumber: '2026-08-07T20:01:00.000Z' }
  };
  const targetInterest: IdentifiedRecord = {
    id: 'interest-target',
    ...(profileId ? { profileId } : {}),
    playerName,
    gameId: game.id,
    status: 'Seated',
    timestamp: '2026-08-07T20:00:00.000Z',
    interestedAt: '2026-08-07T19:00:00.000Z',
    seatedAt: '2026-08-07T20:00:00.000Z',
    notes: 'Target interest',
    manualEdits: { seatedAt: '2026-08-07T20:01:00.000Z' }
  };
  await replaceCapturedState(session, {
    buyIns: [],
    correctionLog: [structuredClone(existingCorrection)],
    dealerAssignments: [],
    dropLogs: [],
    handCountLogs: [],
    inAppNotifications: [structuredClone(existingNotification)],
    interests: [targetInterest],
    playerLedger: [structuredClone(existingLedger)],
    playerSessions: [targetSession, structuredClone(unrelatedSession)],
    profiles,
    sessions: [structuredClone(table)],
    tableEvents: [],
    timeFeeLogs: [],
    usageEvents: []
  });
  return { targetInterest, targetSession };
};

const expectDepartureCompleted = (
  previousState: CapturedState,
  previousSnapshot: CapturedState,
  targetInterest: IdentifiedRecord,
  targetSession: IdentifiedRecord
) => {
  const nextState = getLatestState();
  expect(nextState).not.toBe(previousState);
  expect(previousState).toEqual(previousSnapshot);
  expect(nextState.playerSessions.map((candidate) => candidate.id)).toEqual(['session-target', 'session-unrelated']);
  expect(getRecord(nextState.playerSessions, targetSession.id)).toEqual({
    ...targetSession,
    leftAt: now,
    manualEdits: { seatNumber: '2026-08-07T20:01:00.000Z', leftAt: now }
  });
  expect(nextState.playerSessions[1]).toBe(previousState.playerSessions[1]);
  expect(getRecord(nextState.interests, targetInterest.id)).toEqual({
    ...targetInterest,
    status: 'Removed',
    closedAt: now,
    timestamp: now
  });
  expect(getRecord(nextState.sessions, table.id)).toEqual({ ...table, seatsFilled: 1 });
  expect(nextState.playerLedger).toEqual([
    {
      id: expect.any(String),
      type: 'Cash-Out',
      profileId: targetSession.profileId,
      playerName,
      tableId: table.id,
      gameId: game.id,
      amount: 75,
      timestamp: now,
      note: 'Test cash out'
    },
    existingLedger
  ]);
  expect(nextState.inAppNotifications).toEqual([existingNotification]);
  expect(nextState.correctionLog).toEqual([existingCorrection]);
  expect(nextState.usageEvents).toEqual([
    expect.objectContaining({
      id: expect.any(String),
      feature: 'Seating',
      action: 'Marked player left',
      route: 'floor',
      timestamp: now,
      accountKey,
      metadata: { gameId: game.id, tableId: table.id }
    })
  ]);
  const persisted = getPersistedState();
  expect(persisted.profiles).toEqual(nextState.profiles);
  expect(persisted.playerSessions).toEqual(nextState.playerSessions);
  expect(persisted.interests).toEqual(nextState.interests);
  expect(persisted.playerLedger).toEqual(nextState.playerLedger);
  expect(persisted.sessions).toEqual(nextState.sessions);
  expect(persisted.inAppNotifications).toEqual(nextState.inAppNotifications);
  expect(persisted.correctionLog).toEqual(nextState.correctionLog);
};

describe('player table transitions', () => {
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
        profiles: [buildProfile('profile-initial', playerName)],
        tournaments: [],
        interests: [],
        sessions: [table],
        playerSessions: [],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [],
        handCountLogs: [],
        timeFeeLogs: [],
        revenueTransactions: [],
        playerLedger: [],
        tableEvents: [],
        inAppNotifications: [],
        history: [],
        nightCloses: [],
        feedback: [],
        scriptTemplates: [],
        correctionLog: [],
        usageEvents: [],
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
            authorizationCode: 'TYPE-007D-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007D-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007d@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007d@example.test',
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
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007dApp');
    Reflect.deleteProperty(globalThis, '__orbitType007dSeatPlayerInState');
    Reflect.deleteProperty(globalThis, '__orbitType007dSetTableCollectionMode');
    Reflect.deleteProperty(globalThis, '__orbitType007dAddPlayerTime');
    Reflect.deleteProperty(globalThis, '__orbitType007dAddBuyIn');
    Reflect.deleteProperty(globalThis, '__orbitType007dAddTableDrop');
    Reflect.deleteProperty(globalThis, '__orbitType007dAssignDealer');
    Reflect.deleteProperty(globalThis, '__orbitType007dEndDealerAssignment');
    Reflect.deleteProperty(globalThis, '__orbitType007dRecordHands');
    Reflect.deleteProperty(globalThis, '__orbitType007dSetDropDrafts');
    Reflect.deleteProperty(globalThis, '__orbitType007dSetDealerDrafts');
    Reflect.deleteProperty(globalThis, '__orbitType007dSetHandCountDrafts');
    Reflect.deleteProperty(globalThis, '__orbitType007dMovePlayerToTable');
    Reflect.deleteProperty(globalThis, '__orbitType007dMarkPlayerLeft');
    Reflect.deleteProperty(globalThis, '__orbitType007dMarkPlayerSessionLeft');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('uses profileId as the authoritative identity and does not fall back by name', async () => {
    const authoritative = buildProfile('profile-authoritative', 'Different Stored Name');
    const nameMatch = buildProfile('profile-name-match', playerName, 20);
    const unrelated = buildProfile('profile-unrelated', unrelatedSession.playerName, 30);
    const { targetInterest, targetSession } = await resetState(
      inspectorSession,
      [authoritative, nameMatch, unrelated],
      authoritative.id
    );
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    await invokeDeparture(inspectorSession, targetSession);
    const nextState = getLatestState();

    expect(nextState.profiles.map((profile) => profile.id)).toEqual(previousState.profiles.map((profile) => profile.id));
    expect(getRecord(nextState.profiles, authoritative.id)).toEqual({
      ...authoritative,
      totalTimePlayedHours: 12,
      lastSessionTimePlayedHours: 2
    });
    expect(nextState.profiles[1]).toBe(previousState.profiles[1]);
    expect(nextState.profiles[2]).toBe(previousState.profiles[2]);
    expectDepartureCompleted(previousState, previousSnapshot, targetInterest, targetSession);
  });

  it('updates the one case-insensitive name match when profileId is absent', async () => {
    const uniqueMatch = buildProfile('profile-unique', 'cASE pLAYER');
    const unrelated = buildProfile('profile-unrelated', unrelatedSession.playerName, 30);
    const { targetInterest, targetSession } = await resetState(inspectorSession, [uniqueMatch, unrelated]);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    await invokeDeparture(inspectorSession, targetSession);
    const nextState = getLatestState();

    expect(getRecord(nextState.profiles, uniqueMatch.id)).toEqual({
      ...uniqueMatch,
      totalTimePlayedHours: 12,
      lastSessionTimePlayedHours: 2
    });
    expect(nextState.profiles[1]).toBe(previousState.profiles[1]);
    expectDepartureCompleted(previousState, previousSnapshot, targetInterest, targetSession);
  });

  it('updates no profile when profileId is absent and no name matches', async () => {
    const nonMatch = buildProfile('profile-non-match', 'Somebody Else');
    const unrelated = buildProfile('profile-unrelated', unrelatedSession.playerName, 30);
    const { targetInterest, targetSession } = await resetState(inspectorSession, [nonMatch, unrelated]);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    await invokeDeparture(inspectorSession, targetSession);
    const nextState = getLatestState();

    expect(nextState.profiles.map((profile) => profile.id)).toEqual(previousState.profiles.map((profile) => profile.id));
    nextState.profiles.forEach((profile, index) => expect(profile).toBe(previousState.profiles[index]));
    expectDepartureCompleted(previousState, previousSnapshot, targetInterest, targetSession);
  });

  it('updates no profile when profileId is absent and two case-insensitive duplicate names match', async () => {
    const firstDuplicate = buildProfile('profile-duplicate-a', playerName, 10);
    const secondDuplicate = buildProfile('profile-duplicate-b', 'CASE PLAYER', 20);
    const unrelated = buildProfile('profile-unrelated', unrelatedSession.playerName, 30);
    const { targetInterest, targetSession } = await resetState(
      inspectorSession,
      [firstDuplicate, secondDuplicate, unrelated]
    );
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    await invokeDeparture(inspectorSession, targetSession);
    const nextState = getLatestState();

    expect(nextState.profiles.map((profile) => profile.id)).toEqual(previousState.profiles.map((profile) => profile.id));
    nextState.profiles.forEach((profile, index) => expect(profile).toBe(previousState.profiles[index]));
    expectDepartureCompleted(previousState, previousSnapshot, targetInterest, targetSession);
  });

  it('moves a complete player session to the first open target seat and preserves transition ordering', async () => {
    const sourceTable = { ...table, id: 'table-source', label: 'Source Table', seatsFilled: 2 };
    const targetTable = { ...table, id: 'table-target', label: 'Target Table', seatsFilled: 1, maxSeats: 3 };
    const movingSession: IdentifiedRecord = {
      id: 'session-moving',
      playerName: 'Moving Player',
      profileId: 'profile-moving',
      gameId: game.id,
      tableId: sourceTable.id,
      seatNumber: 2,
      seatedAt: '2026-08-07T20:00:00.000Z',
      timePurchasedMinutes: 90,
      timeRemainingMinutes: 60,
      lastTimeTickAt: '2026-08-07T21:45:00.000Z',
      timeFeeEnabled: true
    };
    const sourcePeer = { ...unrelatedSession, id: 'session-source-peer', tableId: sourceTable.id, seatNumber: 4 };
    const targetOccupant = { ...unrelatedSession, id: 'session-target-occupant', tableId: targetTable.id, seatNumber: 2 };
    const existingEvent: IdentifiedRecord = {
      id: 'event-existing',
      type: 'Started',
      gameId: game.id,
      tableId: sourceTable.id,
      timestamp: '2026-08-07T20:00:00.000Z',
      playerCount: 2,
      note: 'Existing event'
    };
    await replaceCapturedState(inspectorSession, {
      correctionLog: [structuredClone(existingCorrection)],
      inAppNotifications: [structuredClone(existingNotification)],
      interests: [],
      playerLedger: [structuredClone(existingLedger)],
      playerSessions: [movingSession, sourcePeer, targetOccupant],
      profiles: [buildProfile('profile-moving', 'Moving Player'), buildProfile('profile-unrelated', unrelatedSession.playerName)],
      sessions: [sourceTable, targetTable],
      tableEvents: [existingEvent],
      usageEvents: []
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMovePlayerToTable', [movingSession, targetTable.id]);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(getRecord(nextState.playerSessions, movingSession.id)).toEqual({
      ...movingSession,
      tableId: targetTable.id,
      seatNumber: 1,
      manualEdits: { tableId: now, seatNumber: now }
    });
    expect(nextState.playerSessions[1]).toBe(previousState.playerSessions[1]);
    expect(nextState.playerSessions[2]).toBe(previousState.playerSessions[2]);
    expect(nextState.sessions.map((session) => session.id)).toEqual([sourceTable.id, targetTable.id]);
    expect(getRecord(nextState.sessions, sourceTable.id)).toEqual({ ...sourceTable, seatsFilled: 1 });
    expect(getRecord(nextState.sessions, targetTable.id)).toEqual({ ...targetTable, seatsFilled: 2 });
    expect(nextState.tableEvents).toEqual([
      existingEvent,
      {
        id: expect.any(String),
        type: 'Merged',
        gameId: game.id,
        tableId: targetTable.id,
        timestamp: now,
        playerCount: 2,
        profileId: movingSession.profileId,
        reason: 'player moved',
        note: 'Moving Player moved from Source Table to Target Table'
      }
    ]);
    expect(nextState.usageEvents).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        feature: 'Tables',
        action: 'Moved player',
        timestamp: now,
        metadata: { fromTableId: sourceTable.id, toTableId: targetTable.id }
      })
    ]);
    expect(nextState.profiles).toEqual(previousState.profiles);
    expect(nextState.playerLedger).toEqual([existingLedger]);
    expect(nextState.inAppNotifications).toEqual([existingNotification]);
    const persisted = getPersistedState();
    expect(persisted.playerSessions).toEqual(nextState.playerSessions);
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
  });

  it('keeps same-table, missing-target, and full-target moves as no-ops', async () => {
    const sourceTable = { ...table, id: 'table-source', label: 'Source Table', seatsFilled: 1 };
    const fullTarget = { ...table, id: 'table-full', label: 'Full Target', seatsFilled: 1, maxSeats: 1 };
    const movingSession: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-moving',
      playerName: 'Moving Player',
      profileId: 'profile-moving',
      tableId: sourceTable.id,
      seatNumber: 2,
      manualEdits: { seatedAt: '2026-08-07T20:05:00.000Z' }
    };
    const targetOccupant = { ...unrelatedSession, id: 'session-target-occupant', tableId: fullTarget.id, seatNumber: 1 };
    await replaceCapturedState(inspectorSession, {
      correctionLog: [],
      inAppNotifications: [],
      interests: [],
      playerLedger: [],
      playerSessions: [movingSession, targetOccupant],
      profiles: [buildProfile('profile-moving', 'Moving Player')],
      sessions: [sourceTable, fullTarget],
      tableEvents: [],
      usageEvents: []
    });
    const alertMock = vi.mocked(window.alert);
    alertMock.mockClear();
    const originalState = getLatestState();

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMovePlayerToTable', [movingSession, sourceTable.id]);
    expect(getLatestState()).toBe(originalState);
    expect(alertMock).not.toHaveBeenCalled();

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMovePlayerToTable', [movingSession, 'missing-table']);
    expect(getLatestState()).toBe(originalState);
    expect(alertMock).not.toHaveBeenCalled();

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMovePlayerToTable', [movingSession, fullTarget.id]);
    expect(getLatestState()).toBe(originalState);
    expect(alertMock).toHaveBeenCalledOnce();
    expect(alertMock).toHaveBeenCalledWith('No open seats on the target table.');
  });

  it('marks the first open exact-name and exact-game session left and emits seat-opened notifications', async () => {
    const otherGame = { ...game, id: 'game-other', name: 'Other Game' };
    const otherTable = { ...table, id: 'table-other', gameId: otherGame.id, label: 'Other Table', seatsFilled: 1 };
    const targetInterest: IdentifiedRecord = {
      id: 'interest-mark-left',
      profileId: 'profile-target',
      playerName,
      gameId: game.id,
      status: 'Seated',
      timestamp: '2026-08-07T20:00:00.000Z',
      interestedAt: '2026-08-07T19:00:00.000Z',
      seatedAt: '2026-08-07T20:00:00.000Z',
      notes: 'Leave through interest action'
    };
    const otherInterest: IdentifiedRecord = {
      ...targetInterest,
      id: 'interest-other',
      playerName: 'Other Interest',
      status: 'Arrived'
    };
    const historicalSession: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-historical',
      playerName,
      profileId: 'profile-target',
      leftAt: '2026-08-07T19:00:00.000Z'
    };
    const openTargetSession: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-open-target',
      playerName,
      profileId: 'profile-target',
      seatNumber: 3,
      manualEdits: { seatNumber: '2026-08-07T20:05:00.000Z' }
    };
    const sameNameOtherGame: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-other-game',
      playerName,
      profileId: 'profile-other-game',
      gameId: otherGame.id,
      tableId: otherTable.id,
      seatNumber: 1
    };
    const sameGameOtherName = { ...unrelatedSession, id: 'session-other-name', tableId: table.id, seatNumber: 5 };
    const recipientName = 'Notification Recipient';
    const recipient = {
      ...buildProfile('profile-recipient', recipientName),
      gamePlayCounts: { [game.id]: 3, [otherGame.id]: 1 }
    };
    await replaceCapturedState(inspectorSession, {
      correctionLog: [structuredClone(existingCorrection)],
      games: [game, otherGame],
      inAppNotifications: [structuredClone(existingNotification)],
      interests: [targetInterest, otherInterest],
      playerLedger: [structuredClone(existingLedger)],
      playerSessions: [historicalSession, openTargetSession, sameNameOtherGame, sameGameOtherName],
      profiles: [buildProfile('profile-target', playerName), recipient],
      sessions: [structuredClone(table), otherTable],
      tableEvents: [],
      usageEvents: []
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMarkPlayerLeft', [targetInterest]);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(getRecord(nextState.interests, targetInterest.id)).toEqual({
      ...targetInterest,
      status: 'Removed',
      closedAt: now,
      timestamp: now
    });
    expect(nextState.interests[1]).toBe(previousState.interests[1]);
    expect(nextState.playerSessions[0]).toBe(previousState.playerSessions[0]);
    expect(getRecord(nextState.playerSessions, openTargetSession.id)).toEqual({ ...openTargetSession, leftAt: now });
    expect(nextState.playerSessions[2]).toBe(previousState.playerSessions[2]);
    expect(nextState.playerSessions[3]).toBe(previousState.playerSessions[3]);
    expect(getRecord(nextState.sessions, table.id)).toEqual({ ...table, seatsFilled: 1 });
    expect(nextState.sessions[1]).toBe(previousState.sessions[1]);
    expect(nextState.inAppNotifications).toEqual([
      {
        id: expect.any(String),
        clubId: accountKey,
        gameId: game.id,
        title: game.name,
        body: 'A seat has opened for Departure Holdem at Local Test Club. Open or refresh Orbit Player to view current availability and request a seat.',
        reason: 'seat-opened',
        createdAt: now,
        expiresAt: '2026-08-08T02:00:00.000Z',
        targetPlayerIds: [recipient.id],
        targetPlayerNames: [recipientName]
      },
      existingNotification
    ]);
    expect(nextState.profiles).toEqual(previousState.profiles);
    expect(nextState.playerLedger).toEqual([existingLedger]);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.usageEvents).toEqual([]);
    const persisted = getPersistedState();
    expect(persisted.interests).toEqual(nextState.interests);
    expect(persisted.playerSessions).toEqual(nextState.playerSessions);
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.inAppNotifications).toEqual(nextState.inAppNotifications);
  });

  it('removes the selected interest and closes its unique case-insensitive open session match', async () => {
    const targetInterest: IdentifiedRecord = {
      id: 'interest-without-session',
      playerName,
      gameId: game.id,
      status: 'Arrived',
      timestamp: '2026-08-07T20:00:00.000Z',
      interestedAt: '2026-08-07T19:00:00.000Z',
      notes: 'No open session'
    };
    const historicalSession: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-historical',
      playerName,
      gameId: game.id,
      leftAt: '2026-08-07T21:00:00.000Z'
    };
    const caseDifferentSession: IdentifiedRecord = {
      ...unrelatedSession,
      id: 'session-case-different',
      playerName: 'case player',
      gameId: game.id
    };
    await replaceCapturedState(inspectorSession, {
      correctionLog: [structuredClone(existingCorrection)],
      games: [game],
      inAppNotifications: [structuredClone(existingNotification)],
      interests: [targetInterest],
      playerLedger: [structuredClone(existingLedger)],
      playerSessions: [historicalSession, caseDifferentSession],
      profiles: [buildProfile('profile-target', playerName)],
      sessions: [structuredClone(table)],
      tableEvents: [],
      usageEvents: []
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await invokeCapturedFunction(inspectorSession, '__orbitType007dMarkPlayerLeft', [targetInterest]);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(getRecord(nextState.interests, targetInterest.id)).toEqual({
      ...targetInterest,
      status: 'Removed',
      closedAt: now,
      timestamp: now
    });
    expect(nextState.playerSessions[0]).toBe(previousState.playerSessions[0]);
    expect(nextState.playerSessions[1]).toEqual({ ...caseDifferentSession, leftAt: now });
    expect(nextState.sessions).toEqual([{ ...table, seatsFilled: 0 }]);
    nextState.profiles.forEach((profile, index) => expect(profile).toBe(previousState.profiles[index]));
    expect(nextState.playerLedger).toEqual([existingLedger]);
    expect(nextState.inAppNotifications).toEqual([existingNotification]);
    expect(nextState.correctionLog).toEqual([existingCorrection]);
    expect(nextState.usageEvents).toEqual([]);
    const persisted = getPersistedState();
    expect(persisted.interests).toEqual(nextState.interests);
    expect(persisted.playerSessions).toEqual(nextState.playerSessions);
    expect(persisted.sessions).toEqual(nextState.sessions);
  });

  it('seats through the canonical state transition with initial time, buy-in, ledger, and profile updates', async () => {
    const targetProfile = buildProfile('profile-seat-target', 'Seat Target');
    const targetInterest: IdentifiedRecord = {
      id: 'interest-seat-target',
      profileId: targetProfile.id,
      playerName: targetProfile.name,
      gameId: game.id,
      status: 'Arrived',
      timestamp: '2026-08-07T21:30:00.000Z',
      interestedAt: '2026-08-07T20:00:00.000Z',
      arrivedAt: '2026-08-07T21:30:00.000Z',
      notes: 'Ready to seat'
    };
    await resetState(inspectorSession, [targetProfile, buildProfile('profile-unrelated', unrelatedSession.playerName)]);
    const captured = getLatestState();
    const formingTable = { ...table, status: 'Forming', seatsFilled: 1 };
    const source: CapturedState = {
      ...structuredClone(captured),
      interests: [targetInterest],
      playerSessions: [structuredClone(unrelatedSession)],
      profiles: [targetProfile, buildProfile('profile-unrelated', unrelatedSession.playerName)],
      sessions: [formingTable]
    };
    const sourceSnapshot = structuredClone(source);

    const rawResult = await invokeCapturedFunction(inspectorSession, '__orbitType007dSeatPlayerInState', [
      source,
      table.id,
      {
        playerName: targetProfile.name,
        profileId: targetProfile.id,
        interestId: targetInterest.id,
        requestedSeatNumber: 2,
        initialTimeMinutes: 60,
        initialBuyIn: 200,
        note: 'Characterized seating'
      }
    ]);
    const nextState = getSuccessfulCommandState(rawResult);

    expect(source).toEqual(sourceSnapshot);
    expect(rawResult).toMatchObject({
      ok: true,
      seatNumber: 2,
      playerName: targetProfile.name,
      profileId: targetProfile.id,
      tableId: table.id,
      gameId: game.id
    });
    expect(getRecord(nextState.interests, targetInterest.id)).toEqual({
      ...targetInterest,
      status: 'Seated',
      seatedAt: now,
      timestamp: now
    });
    expect(nextState.playerSessions).toEqual([
      unrelatedSession,
      {
        id: expect.any(String),
        playerName: targetProfile.name,
        profileId: targetProfile.id,
        gameId: game.id,
        tableId: table.id,
        seatNumber: 2,
        seatedAt: now,
        timePurchasedMinutes: 60,
        timeRemainingMinutes: 60,
        lastTimeTickAt: now,
        timeFeeEnabled: true
      }
    ]);
    expect(nextState.buyIns).toEqual([{
      id: expect.any(String),
      profileId: targetProfile.id,
      playerName: targetProfile.name,
      tableId: table.id,
      gameId: game.id,
      amount: 200,
      timestamp: now,
      note: 'Initial buy-in'
    }]);
    expect(nextState.playerLedger).toEqual([
      expect.objectContaining({ type: 'Buy-In', amount: 200, timestamp: now, note: 'Initial buy-in' }),
      expect.objectContaining({ type: 'Check-In', timestamp: now, note: 'Characterized seating: seat 2' }),
      existingLedger
    ]);
    expect(getRecord(nextState.sessions, table.id)).toEqual({ ...formingTable, status: 'Running', seatsFilled: 2 });
    expect(getRecord(nextState.profiles, targetProfile.id)).toEqual({
      ...targetProfile,
      gamePlayCounts: { [game.id]: 1 },
      mostPlayedGameId: game.id,
      preferredGameIds: [game.id]
    });
  });

  it('returns exact seating failures without mutating the supplied state', async () => {
    const targetProfile = buildProfile('profile-seat-failures', 'Seat Failures');
    await resetState(inspectorSession, [targetProfile, buildProfile('profile-unrelated', unrelatedSession.playerName)]);
    const source: CapturedState = {
      ...structuredClone(getLatestState()),
      playerSessions: [structuredClone(unrelatedSession)],
      profiles: [targetProfile, buildProfile('profile-unrelated', unrelatedSession.playerName)],
      sessions: [structuredClone(table)]
    };
    const snapshot = structuredClone(source);

    const missingTable = await invokeCapturedFunction(inspectorSession, '__orbitType007dSeatPlayerInState', [source, 'missing-table', { playerName: targetProfile.name }]);
    const missingPlayer = await invokeCapturedFunction(inspectorSession, '__orbitType007dSeatPlayerInState', [source, table.id, {}]);
    const duplicate = await invokeCapturedFunction(inspectorSession, '__orbitType007dSeatPlayerInState', [
      source,
      table.id,
      { playerName: unrelatedSession.playerName, profileId: unrelatedSession.profileId }
    ]);
    const occupiedSeat = await invokeCapturedFunction(inspectorSession, '__orbitType007dSeatPlayerInState', [
      source,
      table.id,
      { playerName: targetProfile.name, profileId: targetProfile.id, requestedSeatNumber: unrelatedSession.seatNumber }
    ]);

    expect(missingTable).toEqual({ ok: false, error: 'This table is no longer open.' });
    expect(missingPlayer).toEqual({ ok: false, error: 'Choose a player or enter a player name.' });
    expect(duplicate).toEqual({ ok: false, error: `${unrelatedSession.playerName} is already seated.` });
    expect(occupiedSeat).toEqual({ ok: false, error: 'Table full. No open seats remain.' });
    expect(source).toEqual(snapshot);
  });

  it('records player time and buy-ins and propagates collection mode to open sessions', async () => {
    const { targetSession } = await resetState(
      inspectorSession,
      [buildProfile('profile-target', playerName), buildProfile('profile-unrelated', unrelatedSession.playerName)],
      'profile-target'
    );
    const beforeTime = getLatestState();
    const beforeTimeSnapshot = structuredClone(beforeTime);

    await invokeAndRecapture(inspectorSession, '__orbitType007dAddPlayerTime', [targetSession, 30]);
    const afterTime = getLatestState();
    expect(beforeTime).toEqual(beforeTimeSnapshot);
    expect(getRecord(afterTime.playerSessions, targetSession.id)).toMatchObject({
      timePurchasedMinutes: 150,
      timeRemainingMinutes: 60,
      lastTimeTickAt: now,
      timeFeeEnabled: true
    });
    expect(afterTime.timeFeeLogs).toEqual([{
      id: expect.any(String),
      playerSessionId: targetSession.id,
      tableId: table.id,
      gameId: game.id,
      playerName,
      minutes: 30,
      amount: 6,
      timestamp: now
    }]);
    expect(afterTime.tableEvents).toEqual([expect.objectContaining({
      type: 'Merged',
      reason: 'time added',
      playerCount: table.seatsFilled,
      note: `30 minutes added for ${playerName}`
    })]);

    const currentSession = getRecord(afterTime.playerSessions, targetSession.id);
    await invokeAndRecapture(inspectorSession, '__orbitType007dAddBuyIn', [currentSession, 125, 'Reload override']);
    const afterBuyIn = getLatestState();
    expect(afterBuyIn.buyIns).toEqual([expect.objectContaining({
      profileId: 'profile-target',
      playerName,
      amount: 125,
      timestamp: now,
      note: 'Reload override'
    })]);
    expect(afterBuyIn.playerLedger[0]).toEqual(expect.objectContaining({
      type: 'Buy-In',
      profileId: 'profile-target',
      amount: 125,
      timestamp: now,
      note: 'Reload override'
    }));
    expect(afterBuyIn.playerLedger[1]).toEqual(existingLedger);

    await invokeAndRecapture(inspectorSession, '__orbitType007dSetTableCollectionMode', [table.id, 'Drop']);
    const afterCollectionChange = getLatestState();
    expect(getRecord(afterCollectionChange.sessions, table.id)).toMatchObject({ collectionMode: 'Drop', timeFeeBased: false });
    expect(getRecord(afterCollectionChange.playerSessions, targetSession.id)).toMatchObject({ timeFeeEnabled: false });
    expect(getRecord(afterCollectionChange.playerSessions, unrelatedSession.id)).toMatchObject({ timeFeeEnabled: false });
    expect(getPersistedState().playerSessions).toEqual(afterCollectionChange.playerSessions);
  });

  it('records drop, dealer, and hand logs with their established ordering and trimming', async () => {
    vi.mocked(window.alert).mockClear();
    await resetState(
      inspectorSession,
      [buildProfile('profile-target', playerName), buildProfile('profile-unrelated', unrelatedSession.playerName)],
      'profile-target'
    );
    const openDealer = {
      id: 'dealer-open',
      tableId: table.id,
      gameId: game.id,
      dealerName: 'First Dealer',
      startedAt: '2026-08-07T21:00:00.000Z'
    };
    await replaceCapturedState(inspectorSession, { dealerAssignments: [openDealer] });

    await invokeAndRecapture(inspectorSession, '__orbitType007dSetDropDrafts', [{
      [table.id]: { amount: '42.5', note: '  Counted drop  ' }
    }]);
    await invokeAndRecapture(inspectorSession, '__orbitType007dAddTableDrop', [table]);
    expect(getLatestState().dropLogs).toEqual([expect.objectContaining({
      tableId: table.id,
      gameId: game.id,
      amount: 42.5,
      timestamp: now,
      note: 'Counted drop'
    })]);

    await invokeAndRecapture(inspectorSession, '__orbitType007dSetDealerDrafts', [{ [table.id]: '  Next Dealer  ' }]);
    await invokeAndRecapture(inspectorSession, '__orbitType007dAssignDealer', [table]);
    const afterAssignment = getLatestState();
    expect(afterAssignment.dealerAssignments).toEqual([
      { ...openDealer, endedAt: now },
      {
        id: expect.any(String),
        tableId: table.id,
        gameId: game.id,
        dealerName: 'Next Dealer',
        startedAt: now
      }
    ]);

    await invokeAndRecapture(inspectorSession, '__orbitType007dEndDealerAssignment', [table]);
    expect(getLatestState().dealerAssignments).toEqual([
      { ...openDealer, endedAt: now },
      expect.objectContaining({ dealerName: 'Next Dealer', endedAt: now })
    ]);

    await invokeAndRecapture(inspectorSession, '__orbitType007dSetHandCountDrafts', [{ [table.id]: '17' }]);
    await invokeAndRecapture(inspectorSession, '__orbitType007dRecordHands', [table]);
    expect(getLatestState().handCountLogs).toEqual([expect.objectContaining({
      tableId: table.id,
      gameId: game.id,
      hands: 17,
      timestamp: now
    })]);
    expect(getPersistedState().handCountLogs).toEqual(getLatestState().handCountLogs);
    expect(window.alert).not.toHaveBeenCalled();
  });
});
