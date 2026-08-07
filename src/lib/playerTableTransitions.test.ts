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
  games: IdentifiedRecord[];
  inAppNotifications: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  playerLedger: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
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
    'correctionLog',
    'games',
    'inAppNotifications',
    'interests',
    'playerLedger',
    'playerSessions',
    'profiles',
    'sessions',
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
            expression: 'globalThis.__orbitType007dMarkPlayerSessionLeft = markPlayerSessionLeft; true'
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
  const evaluated = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007dMarkPlayerSessionLeft'
  });
  const functionObjectId = evaluated.result.objectId;
  if (!functionObjectId) throw new Error('Expected the captured markPlayerSessionLeft function');
  await act(async () => {
    await session.post('Runtime.callFunctionOn', {
      objectId: functionObjectId,
      functionDeclaration: 'function () { return this.apply(undefined, arguments); }',
      arguments: [{ value: playerSession }, { value: 75 }, { value: '  Test cash out  ' }],
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
  if (!stored) throw new Error('Expected the departure state to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const resetState = async (session: Session, profiles: IdentifiedRecord[], profileId?: string) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
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
  const capture = await armDepartureFunctionCapture(session);
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        correctionLog: [structuredClone(existingCorrection)],
        inAppNotifications: [structuredClone(existingNotification)],
        interests: [targetInterest],
        playerLedger: [structuredClone(existingLedger)],
        playerSessions: [targetSession, structuredClone(unrelatedSession)],
        profiles,
        sessions: [structuredClone(table)],
        usageEvents: []
      };
    });
  });
  await capture.completed;
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

describe('player-session departure profile resolution', () => {
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007dApp');
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
});
