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
  interests: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  settings: Record<string, unknown>;
  tableEvents: IdentifiedRecord[];
  usageEvents: IdentifiedRecord[];
};

type CapturedCandidate = Record<string, unknown> & {
  id: string;
  playerName: string;
};

type ParticipantFixtures = Partial<
  Pick<CapturedState, 'interests' | 'profiles' | 'sessions' | 'settings' | 'tableEvents' | 'usageEvents'>
>;

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
  const settings: unknown = Reflect.get(value, 'settings');
  return (
    typeof settings === 'object' &&
    settings !== null &&
    ['games', 'interests', 'profiles', 'sessions', 'tableEvents', 'usageEvents'].every((key) => {
      const records: unknown = Reflect.get(value, key);
      return Array.isArray(records) && records.every(isIdentifiedRecord);
    })
  );
};

const isCapturedCandidate = (value: unknown): value is CapturedCandidate =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'playerName' in value &&
  typeof value.playerName === 'string';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];
      if (isCapturedState(value) && value.games.some((candidate) => candidate.id === 'nlh-1-2')) {
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
const accountKey = 'type-007f-test';
const stateKey = `table-manager-state-v1:${accountKey}`;
const game = {
  id: 'nlh-1-2',
  name: '1/2 NLH',
  maxSeats: 8,
  minInRoomForLikely: 2,
  minFlexibleForLikely: 3,
  minTotalForViable: 6
};
const otherGame = {
  id: 'plo',
  name: 'PLO',
  maxSeats: 8,
  minInRoomForLikely: 2,
  minFlexibleForLikely: 3,
  minTotalForViable: 6
};
const existingSession: IdentifiedRecord = {
  id: 'table-existing',
  gameId: game.id,
  label: 'Existing Table',
  status: 'Running',
  seatsFilled: 4,
  maxSeats: 8,
  timeFeeBased: true,
  collectionMode: 'Time',
  plannedPlayerIds: ['interest-existing'],
  tags: ['Action'],
  startedAt: '2026-08-07T18:00:00.000Z',
  manualEdits: { label: '2026-08-07T18:05:00.000Z' }
};
const existingEvent: IdentifiedRecord = {
  id: 'event-existing',
  type: 'Started',
  gameId: game.id,
  tableId: existingSession.id,
  timestamp: '2026-08-07T18:00:00.000Z',
  playerCount: 4,
  note: 'Existing event'
};
const existingUsage: IdentifiedRecord = {
  id: 'usage-existing',
  feature: 'Earlier feature',
  action: 'Earlier action',
  route: 'builder',
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
    authorizationCode: 'TYPE-007F-TEST-CODE',
    expiresAt: '2099-12-31T23:59:59.000Z',
    activatedAt: '2026-08-07T12:00:00.000Z',
    licenseId: 'TYPE-007F-TEST'
  },
  clubAccount: {
    clubName: 'Local Participant Club',
    accountName: 'Local Participant Account',
    contactName: 'Test Operator',
    email: 'type-007f@example.test',
    phone: '',
    address: ''
  },
  staffAccounts: [],
  accountLogin: {
    username: 'type-007f@example.test',
    passwordSalt: 'local-test-salt',
    passwordHash: 'local-test-hash',
    createdAt: '2026-08-07T12:00:00.000Z'
  }
};

const buildProfile = (id: string, name: string, patch: Record<string, unknown> = {}): IdentifiedRecord => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 12,
  lastSessionTimePlayedHours: 2,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: { [game.id]: 3 },
  mostPlayedGameId: game.id,
  preferredStakes: game.name,
  typicalBuyInMin: 200,
  typicalBuyInMax: 500,
  willingnessToMove: true,
  typicalAvailability: 'Evenings',
  usualCompanions: [],
  preferredTags: ['Action'],
  notes: '',
  ...patch
});

const buildInterest = (
  id: string,
  playerName: string,
  status: string,
  patch: Record<string, unknown> = {}
): IdentifiedRecord => ({
  id,
  playerName,
  gameId: game.id,
  status,
  timestamp: '2026-08-07T19:00:00.000Z',
  interestedAt: '2026-08-07T19:00:00.000Z',
  notes: '',
  ...patch
});

const profiledInterest = buildInterest('interest-profiled', 'Profiled Player', 'Arrived', {
  profileId: 'profile-profiled',
  arrivedAt: '2026-08-07T20:00:00.000Z',
  manualEdits: { arrivedAt: '2026-08-07T20:05:00.000Z' }
});
const unprofiledInterest = buildInterest('interest-unprofiled', 'No Profile Player', 'Confirmed Coming', {
  confirmedAt: '2026-08-07T19:30:00.000Z'
});
const inactiveInterest = buildInterest('interest-inactive', 'Inactive Player', 'Declined');
const otherGameInterest = buildInterest('interest-other-game', 'Other Game Player', 'Arrived', { gameId: otherGame.id });
const profiledPlayer = buildProfile('profile-profiled', 'Profiled Player');
const profileOnlyPlayer = buildProfile('profile-only', 'Profile Only Player', {
  preferredStakes: '2/5 NLH',
  typicalBuyInMin: 500,
  typicalBuyInMax: 1500
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
  Reflect.set(globalThis, '__orbitType007fApp', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType007fApp' });
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
    expression: 'globalThis.__orbitType007fApp.toString()',
    returnByValue: true
  });
  const source = sourceResult.result.value;
  if (typeof source !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = source.split(/\r?\n/).findIndex((line) => line.includes('const updateSession'));
  if (relativeLineNumber < 0) throw new Error('Expected the planned-participant boundary in the App source');
  appBreakpointLocation = {
    scriptId: functionLocation.scriptId,
    lineNumber: functionLocation.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  return appBreakpointLocation;
};

const armParticipantCapture = async (session: Session) => {
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
              'globalThis.__orbitType007fAddPlannedSession = addPlannedSession; ' +
              'globalThis.__orbitType007fParticipantPool = participantPool; true'
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

const replaceCapturedState = async (session: Session, fixtures: ParticipantFixtures = {}) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  const capture = await armParticipantCapture(session);
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        interests: fixtures.interests ?? [
          structuredClone(profiledInterest),
          structuredClone(unprofiledInterest),
          structuredClone(inactiveInterest),
          structuredClone(otherGameInterest)
        ],
        profiles: fixtures.profiles ?? [structuredClone(profiledPlayer), structuredClone(profileOnlyPlayer)],
        sessions: fixtures.sessions ?? [structuredClone(existingSession)],
        settings: fixtures.settings ?? structuredClone(baseSettings),
        tableEvents: fixtures.tableEvents ?? [structuredClone(existingEvent)],
        usageEvents: fixtures.usageEvents ?? [structuredClone(existingUsage)]
      };
    });
  });
  await capture.completed;
};

const getCapturedPool = async (session: Session) => {
  const evaluated = await session.post('Runtime.evaluate', {
    expression: 'JSON.parse(JSON.stringify(globalThis.__orbitType007fParticipantPool))',
    returnByValue: true
  });
  const value: unknown = evaluated.result.value;
  if (!Array.isArray(value) || !value.every(isCapturedCandidate)) {
    throw new Error('Expected the participant pool to be captured');
  }
  return value;
};

const invokeAddPlannedSession = async (session: Session) => {
  const evaluated = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType007fAddPlannedSession'
  });
  const functionObjectId = evaluated.result.objectId;
  if (!functionObjectId) throw new Error('Expected the captured addPlannedSession function');
  await act(async () => {
    await session.post('Runtime.callFunctionOn', {
      objectId: functionObjectId,
      functionDeclaration: 'function () { return this(); }',
      returnByValue: true
    });
  });
};

const getPersistedState = () => {
  const stored = localStorage.getItem(stateKey);
  if (!stored) throw new Error('Expected the participant state to be persisted locally');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const candidateCards = () => Array.from(document.querySelectorAll<HTMLElement>('.candidate-card'));

describe('planned participant construction and persistence', () => {
  const inspectorSession = new Session();

  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '#builder';
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
        profiles: [profiledPlayer, profileOnlyPlayer],
        tournaments: [],
        interests: [profiledInterest, unprofiledInterest, inactiveInterest, otherGameInterest],
        sessions: [existingSession],
        playerSessions: [],
        buyIns: [],
        dropLogs: [],
        dealerAssignments: [],
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
        correctionLog: [],
        usageEvents: [existingUsage],
        settings: baseSettings
      })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../components/BuilderView');
      await import('../main');
    });
  });

  afterAll(() => {
    inspectorSession.disconnect();
    Reflect.deleteProperty(globalThis, '__orbitType007fApp');
    Reflect.deleteProperty(globalThis, '__orbitType007fAddPlannedSession');
    Reflect.deleteProperty(globalThis, '__orbitType007fParticipantPool');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders the Tonight route navigation, filters, sections, and primary controls', () => {
    expect(document.querySelector('h1')?.textContent).toBe('Games');
    expect(document.querySelector('.page-subtitle')?.textContent).toBe("Tonight's demand and forming tables");

    const routeTabs = document.querySelector('.route-tabs');
    expect(routeTabs?.getAttribute('aria-label')).toBe('Games sections');
    expect(Array.from(routeTabs?.children ?? [], (tab) => tab.textContent)).toEqual([
      'Tonight',
      'Outreach',
      'Configuration'
    ]);
    expect(routeTabs?.querySelector('[aria-current="page"]')?.textContent).toBe('Tonight');

    const filterLabels = Array.from(
      document.querySelectorAll('.game-filter-bar label'),
      (label) => label.querySelector('span')?.textContent
    );
    expect(filterLabels).toEqual(['Stakes', 'Format', 'Status']);
    expect(
      Array.from(document.querySelectorAll('.game-filter-bar select'), (select) =>
        Array.from(select.querySelectorAll('option'), (option) => option.textContent)
      )
    ).toEqual([
      ['All stakes', '1/2', 'Unspecified'],
      ['All formats', 'NLH', 'PLO'],
      ['All statuses', 'Running', 'Ready', 'Needs players']
    ]);

    expect(Array.from(document.querySelectorAll('.panel h2'), (heading) => heading.textContent)).toEqual([
      'Player Game Requests',
      'Two-Table Balance Option'
    ]);
    expect(Array.from(document.querySelectorAll('.topbar-actions button'), (button) => button.textContent?.trim())).toEqual([
      'Export Pilot',
      'Close'
    ]);
    expect(document.querySelector('.builder-controls button')?.textContent?.trim()).toBe('Start Forming Table');
  });

  it('builds and renders only ranked interest-backed candidates while allowing an absent profile', async () => {
    await replaceCapturedState(inspectorSession);

    const pool = await getCapturedPool(inspectorSession);
    expect(pool.map((candidate) => candidate.id)).toEqual([profiledInterest.id, unprofiledInterest.id]);
    expect(pool.map((candidate) => candidate.playerName)).toEqual(['Profiled Player', 'No Profile Player']);
    expect(pool.every((candidate) => candidate.source === 'interest')).toBe(true);
    expect(pool.every((candidate) => isIdentifiedRecord(candidate.interest))).toBe(true);
    expect(pool[0].interest).toEqual(profiledInterest);
    expect(pool[0].profile).toEqual(profiledPlayer);
    expect(pool[1].interest).toEqual(unprofiledInterest);
    expect(pool[1]).not.toHaveProperty('profile');
    expect(pool.some((candidate) => candidate.id === profileOnlyPlayer.id)).toBe(false);
    expect(pool.some((candidate) => candidate.id === inactiveInterest.id)).toBe(false);
    expect(pool.some((candidate) => candidate.id === otherGameInterest.id)).toBe(false);

    const cards = candidateCards();
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Profiled Player');
    expect(cards[0].textContent).toContain('1/2 NLH');
    expect(cards[0].textContent).toContain('$200-500 buy-in');
    expect(cards[1].textContent).toContain('No Profile Player');
    expect(cards[1].textContent).toContain('No saved stakes');
    expect(cards[1].textContent).toContain('No profile');
    expect(document.body.textContent).not.toContain('Profile Only Player');
  });

  it('persists ranked existing interest IDs without creating interests or mutating input state', async () => {
    await replaceCapturedState(inspectorSession);
    const pool = await getCapturedPool(inspectorSession);
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const previousInterestReferences = [...previousState.interests];

    await invokeAddPlannedSession(inspectorSession);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(nextState).not.toBe(previousState);
    expect(nextState.interests).toEqual(previousState.interests);
    expect(nextState.interests).not.toBe(previousState.interests);
    nextState.interests.forEach((interest, index) => expect(interest).toBe(previousInterestReferences[index]));
    expect(nextState.interests).toHaveLength(4);
    expect(nextState.sessions[0]).toBe(previousState.sessions[0]);
    expect(nextState.sessions[1]).toEqual({
      id: expect.any(String),
      gameId: game.id,
      label: 'Coordinated Table 2',
      status: 'Forming',
      seatsFilled: 0,
      maxSeats: game.maxSeats,
      timeFeeBased: true,
      collectionMode: 'Time',
      plannedPlayerIds: pool.map((candidate) => candidate.id),
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
        playerCount: 2,
        note: 'Staff-created planned table'
      }
    ]);
    expect(nextState.usageEvents).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        feature: 'Table builder',
        action: 'Created planned table',
        route: 'builder',
        timestamp: now,
        accountKey,
        metadata: { gameId: game.id, players: 2 }
      }),
      existingUsage
    ]);
    const persisted = getPersistedState();
    expect(persisted.interests).toEqual(previousState.interests);
    expect(persisted.sessions).toEqual(nextState.sessions);
    expect(persisted.tableEvents).toEqual(nextState.tableEvents);
    expect(persisted.usageEvents).toEqual(nextState.usageEvents);
  });

  it('does not produce or persist a profile-only candidate when no interest exists', async () => {
    await replaceCapturedState(inspectorSession, {
      interests: [],
      profiles: [structuredClone(profileOnlyPlayer)],
      sessions: []
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    expect(await getCapturedPool(inspectorSession)).toEqual([]);
    expect(candidateCards()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Profile Only Player');

    await invokeAddPlannedSession(inspectorSession);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(nextState.interests).toEqual([]);
    expect(nextState.profiles).toEqual([profileOnlyPlayer]);
    expect(nextState.sessions).toEqual([
      {
        id: expect.any(String),
        gameId: game.id,
        label: 'Coordinated Table',
        status: 'Forming',
        seatsFilled: 0,
        maxSeats: game.maxSeats,
        timeFeeBased: true,
        collectionMode: 'Time',
        plannedPlayerIds: [],
        tags: [],
        startedAt: now
      }
    ]);
    expect(nextState.tableEvents.at(-1)).toMatchObject({
      type: 'Created',
      gameId: game.id,
      playerCount: 0,
      note: 'Staff-created empty table'
    });
    expect(getPersistedState().interests).toEqual([]);
  });
});
