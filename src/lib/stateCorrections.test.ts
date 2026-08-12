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
  interests: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
};

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isCapturedState = (value: unknown): value is CapturedState =>
  typeof value === 'object' &&
  value !== null &&
  'correctionLog' in value &&
  Array.isArray(value.correctionLog) &&
  value.correctionLog.every(isIdentifiedRecord) &&
  'games' in value &&
  Array.isArray(value.games) &&
  value.games.every(isIdentifiedRecord) &&
  'interests' in value &&
  Array.isArray(value.interests) &&
  value.interests.every(isIdentifiedRecord) &&
  'playerSessions' in value &&
  Array.isArray(value.playerSessions) &&
  value.playerSessions.every(isIdentifiedRecord) &&
  'sessions' in value &&
  Array.isArray(value.sessions) &&
  value.sessions.every(isIdentifiedRecord);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];

      if (isCapturedState(value) && value.games.some((candidate) => candidate.id === 'game-a')) {
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
const accountKey = 'type-007c-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const game = {
  id: 'game-a',
  name: 'Correction Holdem',
  maxSeats: 8,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};
const targetInterest = {
  id: 'interest-target',
  profileId: 'profile-target',
  playerName: 'Target Player',
  gameId: 'game-a',
  status: 'Interested',
  timestamp: '2026-08-07T17:00:00.000Z',
  interestedAt: '2026-08-07T16:30:00.000Z',
  confirmedAt: '2026-08-07T16:40:00.000Z',
  arrivedAt: '2026-08-07T16:50:00.000Z',
  seatedAt: '2026-08-07T16:55:00.000Z',
  closedAt: '2026-08-07T16:58:00.000Z',
  expectedArrivalTime: '7:30 PM',
  availabilityStartTime: '6:00 PM',
  availabilityEndTime: '11:00 PM',
  tableId: 'table-a',
  notes: 'Preserve every unrelated field',
  manualEdits: { notes: '2026-08-07T17:05:00.000Z' }
};
const otherInterest = {
  id: 'interest-other',
  playerName: 'Other Player',
  gameId: 'game-a',
  status: 'Confirmed Coming',
  timestamp: '2026-08-07T17:10:00.000Z',
  interestedAt: '2026-08-07T17:10:00.000Z',
  notes: 'Unchanged interest'
};
const sourceInterests = [targetInterest, otherInterest];
const matchingSession = {
  id: 'session-match',
  playerName: 'Target Player',
  profileId: 'profile-target',
  gameId: 'game-a',
  tableId: 'table-a',
  seatNumber: 4,
  seatedAt: '2026-08-07T18:00:00.000Z',
  timePurchasedMinutes: 120,
  timeRemainingMinutes: 80,
  lastTimeTickAt: '2026-08-07T21:55:00.000Z',
  timeFeeEnabled: true,
  manualEdits: { seatNumber: '2026-08-07T18:05:00.000Z' }
};
const sameNameOtherGameSession = {
  ...matchingSession,
  id: 'session-other-game',
  gameId: 'game-b',
  tableId: 'table-b',
  seatNumber: 1,
  manualEdits: { tableId: '2026-08-07T18:06:00.000Z' }
};
const sameGameOtherNameSession = {
  ...matchingSession,
  id: 'session-other-name',
  playerName: 'target player',
  profileId: 'profile-other',
  seatNumber: 2,
  manualEdits: undefined
};
const sourcePlayerSessions = [matchingSession, sameNameOtherGameSession, sameGameOtherNameSession];
const openSession = {
  id: 'table-a',
  gameId: 'game-a',
  label: 'Open Table',
  status: 'Running',
  seatsFilled: 1,
  maxSeats: 8,
  timeFeeBased: true,
  collectionMode: 'Time',
  tags: [],
  startedAt: '2026-08-07T18:00:00.000Z'
};
const existingCorrection = {
  id: 'correction-existing',
  entity: 'Earlier Player',
  field: 'notes',
  note: 'Earlier correction',
  timestamp: '2026-08-07T19:00:00.000Z'
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

const resetState = async (
  inspectorSession: Session,
  interests: IdentifiedRecord[] = structuredClone(sourceInterests),
  playerSessions: IdentifiedRecord[] = structuredClone(sourcePlayerSessions)
) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  const capture = await armCorrectionFunctionCapture(inspectorSession);

  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        correctionLog: [structuredClone(existingCorrection)],
        interests,
        playerSessions,
        sessions: [structuredClone(openSession)]
      };
    });
  });
  await capture.completed;
};

const getAppBreakpointLocation = async (session: Session) => {
  if (appBreakpointLocation) return appBreakpointLocation;
  if (typeof harness.appComponent !== 'function') throw new Error('Expected to capture the App component');
  Reflect.set(globalThis, '__orbitType007cApp', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007cApp'
  });
  const appObjectId = evaluated.result.objectId;
  if (!appObjectId) throw new Error('Expected the App component to be inspectable');

  const appProperties = await session.post('Runtime.getProperties', {
    objectId: appObjectId,
    ownProperties: false
  });
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
    expression: 'globalThis.__orbitType007cApp.toString()',
    returnByValue: true
  });
  const appSource = appSourceResult.result.value;
  if (typeof appSource !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = appSource
    .split(/\r?\n/)
    .findIndex((line) => line.includes('const changePlayerSeat'));
  if (relativeLineNumber < 0) throw new Error('Expected the player-session correction boundary in the App source');
  appBreakpointLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  return appBreakpointLocation;
};

const armCorrectionFunctionCapture = async (session: Session) => {
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
              'globalThis.__orbitType007cUpdateInterestTimestamp = updateInterestTimestamp; ' +
              'globalThis.__orbitType007cUpdatePlayerSession = updatePlayerSession; true'
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

const invokeClosureFunction = async (session: Session, bindingName: string, args: unknown[]) => {
  const globalName =
    bindingName === 'updateInterestTimestamp'
      ? '__orbitType007cUpdateInterestTimestamp'
      : '__orbitType007cUpdatePlayerSession';
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

const getRecord = (records: IdentifiedRecord[], id: string) => {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Expected record ${id}`);
  return record;
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the correction to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const expectNewCorrection = (
  state: CapturedState,
  expected: { entity: string; field: string; note: string }
) => {
  expect(state.correctionLog).toHaveLength(2);
  expect(state.correctionLog[0]).toEqual({
    id: expect.any(String),
    ...expected,
    timestamp: now
  });
  expect(state.correctionLog[1]).toEqual(existingCorrection);
};

describe('cross-record timestamp corrections', () => {
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
        interests: sourceInterests,
        sessions: [openSession],
        playerSessions: sourcePlayerSessions,
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
        correctionLog: [existingCorrection],
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
            authorizationCode: 'TYPE-007C-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007C-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007c@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007c@example.test',
            passwordSalt: 'local-test-salt',
            passwordHash: 'local-test-hash',
            createdAt: '2026-08-07T12:00:00.000Z'
          }
        }
      })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    vi.spyOn(window, 'prompt').mockReturnValue('');
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');

    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007cApp');
    Reflect.deleteProperty(globalThis, '__orbitType007cUpdateInterestTimestamp');
    Reflect.deleteProperty(globalThis, '__orbitType007cUpdatePlayerSession');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('updates all five interest timestamps and mirrors only populated seated and closed corrections to an exact session match', async () => {
    const timestampKeys = ['interestedAt', 'confirmedAt', 'arrivedAt', 'seatedAt', 'closedAt'] as const;

    for (const key of timestampKeys) {
      await resetState(inspectorSession);
      const previousState = getLatestState();
      const previousSnapshot = structuredClone(previousState);
      const previousInterests = [...previousState.interests];
      const previousPlayerSessions = [...previousState.playerSessions];
      const input = '2026-08-07T18:45';
      const nextValue = new Date(input).toISOString();

      await invokeClosureFunction(inspectorSession, 'updateInterestTimestamp', [targetInterest.id, key, input]);

      const nextState = getLatestState();
      const changedInterest = getRecord(nextState.interests, targetInterest.id);
      expect(nextState).not.toBe(previousState);
      expect(nextState.interests.map((interest) => interest.id)).toEqual(sourceInterests.map((interest) => interest.id));
      expect(changedInterest).toEqual({
        ...targetInterest,
        [key]: nextValue,
        manualEdits: { notes: '2026-08-07T17:05:00.000Z', [key]: now }
      });
      expect(changedInterest).not.toBe(previousInterests[0]);
      expect(nextState.interests[1]).toBe(previousInterests[1]);

      const changedSession = getRecord(nextState.playerSessions, matchingSession.id);
      if (key === 'seatedAt') {
        expect(changedSession).toEqual({
          ...matchingSession,
          seatedAt: nextValue,
          manualEdits: { seatNumber: '2026-08-07T18:05:00.000Z', seatedAt: now }
        });
        expect(changedSession).not.toBe(previousPlayerSessions[0]);
      } else if (key === 'closedAt') {
        expect(changedSession).toEqual({
          ...matchingSession,
          leftAt: nextValue,
          manualEdits: { seatNumber: '2026-08-07T18:05:00.000Z', leftAt: now }
        });
        expect(changedSession).not.toBe(previousPlayerSessions[0]);
      } else {
        expect(changedSession).toBe(previousPlayerSessions[0]);
      }
      expect(nextState.playerSessions[1]).toBe(previousPlayerSessions[1]);
      expect(nextState.playerSessions[2]).toBe(previousPlayerSessions[2]);
      expect(previousState).toEqual(previousSnapshot);
      expectNewCorrection(nextState, {
        entity: targetInterest.playerName,
        field: key,
        note: 'Timestamp corrected'
      });
      const persistedState = getPersistedState();
      expect(persistedState.interests).toEqual(nextState.interests);
      expect(persistedState.playerSessions).toEqual(nextState.playerSessions);
      expect(persistedState.correctionLog).toEqual(nextState.correctionLog);
    }
  });

  it('keeps the current asymmetric propagation when seated and closed timestamps are cleared', async () => {
    await resetState(inspectorSession);
    const seatedPreviousState = getLatestState();
    const seatedSessionReferences = [...seatedPreviousState.playerSessions];

    await invokeClosureFunction(inspectorSession, 'updateInterestTimestamp', [targetInterest.id, 'seatedAt', '']);

    const clearedSeatedState = getLatestState();
    const clearedSeatedInterest = getRecord(clearedSeatedState.interests, targetInterest.id);
    expect(clearedSeatedInterest).toHaveProperty('seatedAt', undefined);
    expect(clearedSeatedInterest.manualEdits).toEqual({
      notes: '2026-08-07T17:05:00.000Z',
      seatedAt: now
    });
    clearedSeatedState.playerSessions.forEach((session, index) => expect(session).toBe(seatedSessionReferences[index]));
    expectNewCorrection(clearedSeatedState, {
      entity: targetInterest.playerName,
      field: 'seatedAt',
      note: 'Timestamp corrected'
    });
    expect(getRecord(getPersistedState().interests, targetInterest.id)).not.toHaveProperty('seatedAt');

    await resetState(inspectorSession);
    const closedPreviousState = getLatestState();
    const closedSessionReferences = [...closedPreviousState.playerSessions];

    await invokeClosureFunction(inspectorSession, 'updateInterestTimestamp', [targetInterest.id, 'closedAt', '']);

    const clearedClosedState = getLatestState();
    const clearedClosedInterest = getRecord(clearedClosedState.interests, targetInterest.id);
    const clearedMatchingSession = getRecord(clearedClosedState.playerSessions, matchingSession.id);
    expect(clearedClosedInterest).toHaveProperty('closedAt', undefined);
    expect(clearedMatchingSession).toEqual({
      ...matchingSession,
      leftAt: undefined,
      manualEdits: { seatNumber: '2026-08-07T18:05:00.000Z', leftAt: now }
    });
    expect(clearedMatchingSession).not.toBe(closedSessionReferences[0]);
    expect(clearedClosedState.playerSessions[1]).toBe(closedSessionReferences[1]);
    expect(clearedClosedState.playerSessions[2]).toBe(closedSessionReferences[2]);
    expectNewCorrection(clearedClosedState, {
      entity: targetInterest.playerName,
      field: 'closedAt',
      note: 'Timestamp corrected'
    });
    const persistedState = getPersistedState();
    expect(getRecord(persistedState.interests, targetInterest.id)).not.toHaveProperty('closedAt');
    expect(getRecord(persistedState.playerSessions, matchingSession.id)).not.toHaveProperty('leftAt');
    expect(persistedState.correctionLog).toEqual(clearedClosedState.correctionLog);
  });

  it('creates interest manual edits when absent and records a missing target as an audited no-op', async () => {
    const interestWithoutManualEdits = { ...targetInterest };
    delete (interestWithoutManualEdits as Partial<typeof targetInterest>).manualEdits;
    await resetState(inspectorSession, [interestWithoutManualEdits, structuredClone(otherInterest)]);

    await invokeClosureFunction(inspectorSession, 'updateInterestTimestamp', [
      targetInterest.id,
      'arrivedAt',
      '2026-08-07T18:30'
    ]);

    const changedState = getLatestState();
    expect(getRecord(changedState.interests, targetInterest.id).manualEdits).toEqual({ arrivedAt: now });
    expectNewCorrection(changedState, {
      entity: targetInterest.playerName,
      field: 'arrivedAt',
      note: 'Timestamp corrected'
    });

    await resetState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const interestReferences = [...previousState.interests];
    const sessionReferences = [...previousState.playerSessions];

    await invokeClosureFunction(inspectorSession, 'updateInterestTimestamp', [
      'missing-interest',
      'closedAt',
      '2026-08-07T18:30'
    ]);

    const missingTargetState = getLatestState();
    missingTargetState.interests.forEach((interest, index) => expect(interest).toBe(interestReferences[index]));
    missingTargetState.playerSessions.forEach((session, index) => expect(session).toBe(sessionReferences[index]));
    expect(previousState).toEqual(previousSnapshot);
    expectNewCorrection(missingTargetState, {
      entity: 'missing-interest',
      field: 'closedAt',
      note: 'Timestamp corrected'
    });
    const persistedState = getPersistedState();
    expect(persistedState.interests).toEqual(previousState.interests);
    expect(persistedState.playerSessions).toEqual(previousState.playerSessions);
    expect(persistedState.correctionLog).toEqual(missingTargetState.correctionLog);
  });

  it('patches one complete player session, accumulates manual edits, and preserves order and unrelated fields', async () => {
    await resetState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousReferences = [...previousState.playerSessions];

    await invokeClosureFunction(inspectorSession, 'updatePlayerSession', [matchingSession.id, { seatNumber: 7 }, 'seatNumber']);

    const nextState = getLatestState();
    const changedSession = getRecord(nextState.playerSessions, matchingSession.id);
    expect(changedSession).toEqual({
      ...matchingSession,
      seatNumber: 7,
      manualEdits: { seatNumber: now }
    });
    expect(changedSession).not.toBe(previousReferences[0]);
    expect(nextState.playerSessions[1]).toBe(previousReferences[1]);
    expect(nextState.playerSessions[2]).toBe(previousReferences[2]);
    expect(nextState.playerSessions.map((session) => session.id)).toEqual(sourcePlayerSessions.map((session) => session.id));
    expect(previousState).toEqual(previousSnapshot);
    expectNewCorrection(nextState, {
      entity: matchingSession.id,
      field: 'seatNumber',
      note: 'Player session corrected'
    });
    const persistedState = getPersistedState();
    expect(persistedState.playerSessions).toEqual(nextState.playerSessions);
    expect(persistedState.correctionLog).toEqual(nextState.correctionLog);
  });

  it('creates player-session manual edits when absent while preserving canonical identity and seating fields', async () => {
    const sessionWithoutManualEdits = { ...matchingSession };
    delete (sessionWithoutManualEdits as Partial<typeof matchingSession>).manualEdits;
    await resetState(inspectorSession, undefined, [sessionWithoutManualEdits, structuredClone(sameNameOtherGameSession)]);

    await invokeClosureFunction(inspectorSession, 'updatePlayerSession', [
      matchingSession.id,
      { seatNumber: 6 },
      'seatNumber'
    ]);

    const nextState = getLatestState();
    expect(getRecord(nextState.playerSessions, matchingSession.id)).toEqual({
      ...sessionWithoutManualEdits,
      seatNumber: 6,
      manualEdits: { seatNumber: now }
    });
    expect(getRecord(nextState.playerSessions, matchingSession.id)).toMatchObject({
      id: matchingSession.id,
      playerName: matchingSession.playerName,
      profileId: matchingSession.profileId,
      gameId: matchingSession.gameId,
      tableId: matchingSession.tableId,
      seatedAt: matchingSession.seatedAt,
      timePurchasedMinutes: matchingSession.timePurchasedMinutes,
      timeRemainingMinutes: matchingSession.timeRemainingMinutes,
      timeFeeEnabled: matchingSession.timeFeeEnabled
    });
    expect(getRecord(nextState.playerSessions, sameNameOtherGameSession.id)).toEqual(sameNameOtherGameSession);
    expectNewCorrection(nextState, {
      entity: matchingSession.id,
      field: 'seatNumber',
      note: 'Player session corrected'
    });
    expect(getPersistedState().playerSessions).toEqual(nextState.playerSessions);
  });

  it('records a missing player-session target as an audited no-op without mutating prior state', async () => {
    await resetState(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousReferences = [...previousState.playerSessions];

    await invokeClosureFunction(inspectorSession, 'updatePlayerSession', [
      'missing-session',
      { seatNumber: 8 },
      'seatNumber'
    ]);

    const nextState = getLatestState();
    nextState.playerSessions.forEach((session, index) => expect(session).toBe(previousReferences[index]));
    expect(previousState).toEqual(previousSnapshot);
    expectNewCorrection(nextState, {
      entity: 'missing-session',
      field: 'seatNumber',
      note: 'Player session corrected'
    });
    const persistedState = getPersistedState();
    expect(persistedState.playerSessions).toEqual(previousState.playerSessions);
    expect(persistedState.correctionLog).toEqual(nextState.correctionLog);
  });
});
