/**
 * @vitest-environment jsdom
 */
import { Session } from 'node:inspector/promises';
import type { Dispatch, SetStateAction } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type IdentifiedRecord = Record<string, unknown> & { id: string };

type CapturedState = Record<string, unknown> & {
  games: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  tableEvents: IdentifiedRecord[];
  usageEvents: IdentifiedRecord[];
};

const harness = vi.hoisted(() => ({
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isCapturedState = (value: unknown): value is CapturedState =>
  typeof value === 'object' &&
  value !== null &&
  'games' in value &&
  Array.isArray(value.games) &&
  value.games.every(isIdentifiedRecord) &&
  'interests' in value &&
  Array.isArray(value.interests) &&
  value.interests.every(isIdentifiedRecord) &&
  'sessions' in value &&
  Array.isArray(value.sessions) &&
  value.sessions.every(isIdentifiedRecord) &&
  'tableEvents' in value &&
  Array.isArray(value.tableEvents) &&
  value.tableEvents.every(isIdentifiedRecord) &&
  'usageEvents' in value &&
  Array.isArray(value.usageEvents) &&
  value.usageEvents.every(isIdentifiedRecord);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];

      if (isCapturedState(value) && value.games.some((game) => game.id === 'game-a')) {
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

const now = '2026-08-07T20:00:00.000Z';
const accountKey = 'type-007b-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const game = {
  id: 'game-a',
  name: 'Patch Holdem',
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
  tableId: 'previous-table',
  notes: 'Original note',
  manualEdits: { interestedAt: '2026-08-07T17:05:00.000Z' }
};
const supportingInterests = Array.from({ length: 5 }, (_, index) => ({
  id: `interest-support-${index + 1}`,
  playerName: `Support ${index + 1}`,
  gameId: 'game-a',
  status: index % 2 ? 'Confirmed Coming' : 'Interested',
  timestamp: `2026-08-07T17:0${index + 1}:00.000Z`,
  interestedAt: `2026-08-07T17:0${index + 1}:00.000Z`,
  notes: `Support note ${index + 1}`
}));
const sourceInterests = [targetInterest, ...supportingInterests];
const openSession = {
  id: 'open-table',
  gameId: 'game-a',
  label: 'Open Table',
  status: 'Running',
  seatsFilled: 0,
  maxSeats: 8,
  timeFeeBased: false,
  collectionMode: 'Drop',
  tags: [],
  startedAt: '2026-08-07T18:00:00.000Z'
};

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const resetState = async (interests: IdentifiedRecord[] = sourceInterests, sessions: IdentifiedRecord[] = [openSession]) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');

  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        interests,
        sessions,
        tableEvents: [],
        usageEvents: []
      };
    });
  });
};

const getReactClickHandler = (button: HTMLButtonElement) => {
  const reactPropsKey = Reflect.ownKeys(button).find(
    (key) => typeof key === 'string' && key.startsWith('__reactProps$')
  );
  if (!reactPropsKey) throw new Error('Expected React props on the waitlist action');
  const props: unknown = Reflect.get(button, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected React button props');
  const onClick: unknown = Reflect.get(props, 'onClick');
  if (typeof onClick !== 'function') throw new Error('Expected a React click handler');
  return onClick;
};

const findUpdateInterestObjectId = async (session: Session) => {
  const button = document.querySelector<HTMLButtonElement>('.waitlist-arrive-button');
  if (!button) throw new Error('Expected a visible waitlist patch action');
  Reflect.set(globalThis, '__orbitType007bHandler', getReactClickHandler(button));

  const evaluated = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007bHandler'
  });
  const handlerObjectId = evaluated.result.objectId;
  if (!handlerObjectId) throw new Error('Expected the waitlist handler to be inspectable');

  const handlerProperties = await session.post('Runtime.getProperties', {
    objectId: handlerObjectId,
    ownProperties: false
  });
  const scopesObjectId = handlerProperties.internalProperties?.find(
    (property) => property.name === '[[Scopes]]'
  )?.value?.objectId;
  if (!scopesObjectId) throw new Error('Expected the waitlist handler closure scopes');

  const scopes = await session.post('Runtime.getProperties', {
    objectId: scopesObjectId,
    ownProperties: true
  });
  for (const scope of scopes.result) {
    const scopeObjectId = scope.value?.objectId;
    if (!scopeObjectId) continue;
    const bindings = await session.post('Runtime.getProperties', {
      objectId: scopeObjectId,
      ownProperties: true
    });
    const updateInterest = bindings.result.find((binding) => binding.name === 'updateInterest')?.value;
    if (updateInterest?.type === 'function' && updateInterest.objectId) return updateInterest.objectId;
  }

  throw new Error('Expected updateInterest in the rendered waitlist action closure');
};

const invokeUpdateInterest = async (session: Session, id: string, patch: Record<string, unknown>) => {
  const updateInterestObjectId = await findUpdateInterestObjectId(session);
  await act(async () => {
    const result = await session.post('Runtime.callFunctionOn', {
      objectId: updateInterestObjectId,
      functionDeclaration: 'function (id, patch) { return this(id, patch); }',
      arguments: [{ value: id }, { value: patch }],
      returnByValue: true
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  });
};

const getInterest = (state: CapturedState, id: string) => {
  const interest = state.interests.find((item) => item.id === id);
  if (!interest) throw new Error(`Expected interest ${id}`);
  return interest;
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the update to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

describe('waitlist interest patching', () => {
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
          defaultCollectionMode: 'Drop',
          defaultTableCap: 8,
          defaultHourlyFee: 0,
          defaultEstimatedDropPerSeatHour: 0,
          collectionProfiles: [],
          membershipPlans: [],
          showPlayerGrid: true,
          showDashboardKpis: false,
          showRecentPlayers: true,
          pilotAccess: {
            authorized: true,
            authorizationCode: 'TYPE-007B-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-07T12:00:00.000Z',
            licenseId: 'TYPE-007B-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007b@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007b@example.test',
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

    await act(async () => {
      await import('../main');
    });

    const waitlistButton = document.querySelector<HTMLButtonElement>('.waitlist-icon-trigger');
    if (!waitlistButton) throw new Error('Expected the floor waitlist trigger');
    await act(async () => waitlistButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  });

  beforeEach(() => {
    vi.mocked(window.prompt).mockClear();
    vi.mocked(window.prompt).mockReturnValue('');
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007bHandler');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('patches one complete interest, accumulates manual edits, preserves order, and does not mutate input state', async () => {
    await resetState();
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousReferences = [...previousState.interests];

    await invokeUpdateInterest(inspectorSession, targetInterest.id, {
      notes: 'Updated note',
      expectedArrivalTime: '8:15 PM'
    });

    const nextState = getLatestState();
    const changedInterest = getInterest(nextState, targetInterest.id);
    expect(nextState).not.toBe(previousState);
    expect(nextState.interests).not.toBe(previousState.interests);
    expect(nextState.interests.map((interest) => interest.id)).toEqual(sourceInterests.map((interest) => interest.id));
    expect(changedInterest).toEqual({
      ...targetInterest,
      notes: 'Updated note',
      expectedArrivalTime: '8:15 PM',
      manualEdits: {
        interestedAt: '2026-08-07T17:05:00.000Z',
        notes: now,
        expectedArrivalTime: now
      }
    });
    expect(changedInterest).not.toBe(previousReferences[0]);
    nextState.interests.slice(1).forEach((interest, index) => {
      expect(interest).toBe(previousReferences[index + 1]);
    });
    expect(previousState).toEqual(previousSnapshot);
    expect(previousState.interests).toEqual(previousSnapshot.interests);
    expect(changedInterest.gameId).toBe(targetInterest.gameId);
    expect(changedInterest.timestamp).toBe(targetInterest.timestamp);
    expect(window.prompt).not.toHaveBeenCalled();
    expect(getPersistedState().interests).toEqual(nextState.interests);
  });

  it('creates manual edits for an interest that does not already have them', async () => {
    const targetWithoutManualEdits = {
      id: 'interest-target',
      profileId: 'profile-target',
      playerName: 'Target Player',
      gameId: 'game-a',
      status: 'Interested',
      timestamp: '2026-08-07T17:00:00.000Z',
      interestedAt: '2026-08-07T16:30:00.000Z',
      expectedArrivalTime: '7:30 PM',
      notes: 'Original note'
    };
    await resetState([targetWithoutManualEdits, ...supportingInterests]);

    await invokeUpdateInterest(inspectorSession, targetWithoutManualEdits.id, { notes: 'First manual edit' });

    expect(getInterest(getLatestState(), targetWithoutManualEdits.id)).toEqual({
      ...targetWithoutManualEdits,
      notes: 'First manual edit',
      manualEdits: { notes: now }
    });
  });

  it('keeps the existing status timestamp matrix while refreshing the canonical timestamp', async () => {
    const statusCases = [
      ['Interested', undefined],
      ['Confirmed Coming', 'confirmedAt'],
      ['Arrived', 'arrivedAt'],
      ['Seated', 'seatedAt'],
      ['Declined', 'closedAt'],
      ['No-Show', 'closedAt'],
      ['Left Before Seated', 'closedAt'],
      ['Removed', 'closedAt']
    ] as const;

    for (const [status, timestampKey] of statusCases) {
      const matrixTarget = {
        id: targetInterest.id,
        profileId: targetInterest.profileId,
        playerName: targetInterest.playerName,
        gameId: targetInterest.gameId,
        status: 'Interested',
        timestamp: targetInterest.timestamp,
        interestedAt: targetInterest.interestedAt,
        expectedArrivalTime: targetInterest.expectedArrivalTime,
        availabilityStartTime: targetInterest.availabilityStartTime,
        availabilityEndTime: targetInterest.availabilityEndTime,
        tableId: targetInterest.tableId,
        notes: targetInterest.notes,
        manualEdits: { notes: '2026-08-07T17:15:00.000Z' }
      };
      await resetState([matrixTarget, ...supportingInterests]);

      await invokeUpdateInterest(inspectorSession, matrixTarget.id, { status });

      const changedInterest = getInterest(getLatestState(), matrixTarget.id);
      expect(changedInterest.status).toBe(status);
      expect(changedInterest.timestamp).toBe(now);
      expect(changedInterest.gameId).toBe(matrixTarget.gameId);
      expect(changedInterest.manualEdits).toEqual({
        notes: '2026-08-07T17:15:00.000Z',
        status: now
      });
      if (timestampKey) {
        expect(changedInterest[timestampKey]).toBe(now);
      } else {
        expect(changedInterest).not.toHaveProperty('confirmedAt');
        expect(changedInterest).not.toHaveProperty('arrivedAt');
        expect(changedInterest).not.toHaveProperty('seatedAt');
        expect(changedInterest).not.toHaveProperty('closedAt');
      }
    }
  });

  it('persists the demand-follow-up result only for an active changed interest', async () => {
    await resetState(sourceInterests, []);
    vi.mocked(window.prompt).mockReturnValue('start');

    await invokeUpdateInterest(inspectorSession, targetInterest.id, { notes: 'Demand-triggering edit' });

    const nextState = getLatestState();
    const persistedState = getPersistedState();
    expect(window.prompt).toHaveBeenCalledOnce();
    expect(window.prompt).toHaveBeenCalledWith(
      '6 players now want Patch Holdem. Type "start" to create a new Patch Holdem table, "switch" to convert a running table to Patch Holdem, or leave blank to skip.',
      'start'
    );
    expect(nextState.sessions).toHaveLength(1);
    expect(nextState.sessions[0]).toMatchObject({ gameId: 'game-a', label: 'Main Table', status: 'Forming' });
    expect(nextState.tableEvents).toHaveLength(1);
    expect(nextState.tableEvents[0]).toMatchObject({
      type: 'Created',
      gameId: 'game-a',
      note: 'Prompted by 6 interested players'
    });
    expect(persistedState.sessions).toEqual(nextState.sessions);
    expect(persistedState.tableEvents).toEqual(nextState.tableEvents);
    expect(getInterest(persistedState, targetInterest.id)).toMatchObject({
      gameId: targetInterest.gameId,
      notes: 'Demand-triggering edit',
      timestamp: targetInterest.timestamp
    });
  });

  it('skips demand follow-up for an inactive result and still persists that exact patch state', async () => {
    await resetState(sourceInterests, []);

    await invokeUpdateInterest(inspectorSession, targetInterest.id, { status: 'Removed' });

    const nextState = getLatestState();
    const persistedState = getPersistedState();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(nextState.sessions).toEqual([]);
    expect(nextState.tableEvents).toEqual([]);
    expect(getInterest(nextState, targetInterest.id)).toMatchObject({
      gameId: targetInterest.gameId,
      status: 'Removed',
      timestamp: now,
      closedAt: now
    });
    expect(persistedState.interests).toEqual(nextState.interests);
    expect(persistedState.sessions).toEqual([]);
  });

  it('persists a no-op collection when the target is missing without prompting or mutating prior state', async () => {
    await resetState(sourceInterests, []);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousReferences = [...previousState.interests];

    await invokeUpdateInterest(inspectorSession, 'missing-interest', { notes: 'Not applied' });

    const nextState = getLatestState();
    expect(window.prompt).not.toHaveBeenCalled();
    expect(nextState.interests).toEqual(previousState.interests);
    expect(nextState.interests).not.toBe(previousState.interests);
    nextState.interests.forEach((interest, index) => expect(interest).toBe(previousReferences[index]));
    expect(previousState).toEqual(previousSnapshot);
    expect(getPersistedState().interests).toEqual(previousState.interests);
  });
});
