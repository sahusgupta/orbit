/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type IdentifiedRecord = Record<string, unknown> & { id: string };

type CapturedState = Record<string, unknown> & {
  buyIns: IdentifiedRecord[];
  games: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  playerLedger: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  sessions: IdentifiedRecord[];
  settings: Record<string, unknown>;
  usageEvents: IdentifiedRecord[];
};

type QuickAddForm = {
  gameId: string;
  initialBuyIn: string;
  notes: string;
  playerName: string;
  seatNumber: string;
  status: string;
  tableId: string;
};

const harness = vi.hoisted(() => ({
  formSetter: undefined as unknown,
  latestForm: undefined as unknown,
  latestState: undefined as unknown,
  panelSetter: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  savedStates: [] as unknown[],
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
    ['buyIns', 'games', 'interests', 'playerLedger', 'playerSessions', 'profiles', 'sessions', 'usageEvents'].every(
      (key) => {
        const records: unknown = Reflect.get(value, key);
        return Array.isArray(records) && records.every(isIdentifiedRecord);
      }
    )
  );
};

const isQuickAddForm = (value: unknown): value is QuickAddForm =>
  typeof value === 'object' &&
  value !== null &&
  ['gameId', 'initialBuyIn', 'notes', 'playerName', 'seatNumber', 'status', 'tableId'].every(
    (key) => typeof Reflect.get(value, key) === 'string'
  );

const isOpenPanels = (value: unknown): value is Record<string, boolean> =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'quickAdd') === 'boolean' &&
  typeof Reflect.get(value, 'currentTables') === 'boolean' &&
  typeof Reflect.get(value, 'waitlist') === 'boolean';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];
      if (isCapturedState(value)) {
        harness.latestState = value;
        harness.stateSetter = result[1];
      }
      if (isQuickAddForm(value)) {
        harness.latestForm = value;
        harness.formSetter = result[1];
      }
      if (isOpenPanels(value)) harness.panelSetter = result[1];
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
const pilotAccess = {
  activatedAt: '2026-08-07T12:00:00.000Z',
  authorizationCode: 'TYPE-014-AUTH',
  authorized: true,
  expiresAt: '2099-12-31T23:59:59.000Z',
  issuedTo: 'TYPE-014 Fixture Club',
  licenseId: 'TYPE-014-LICENSE'
};
const game = {
  id: 'nlh-1-2',
  name: 'Quick Add Holdem',
  maxSeats: 8,
  minInRoomForLikely: 3,
  minFlexibleForLikely: 4,
  minTotalForViable: 6
};
const openSession = {
  id: 'quick-add-table',
  gameId: game.id,
  label: 'Quick Add Table',
  status: 'Forming',
  seatsFilled: 0,
  maxSeats: 8,
  timeFeeBased: false,
  collectionMode: 'Drop',
  tags: [],
  startedAt: '2026-08-07T21:00:00.000Z'
};

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const getReactSubmitHandler = () => {
  const form = document.querySelector<HTMLFormElement>('form.quick-form');
  if (!form) throw new Error('Expected the Quick Add form');
  const reactPropsKey = Reflect.ownKeys(form).find(
    (key) => typeof key === 'string' && key.startsWith('__reactProps$')
  );
  if (!reactPropsKey) throw new Error('Expected React props on the Quick Add form');
  const props: unknown = Reflect.get(form, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected Quick Add form props');
  const onSubmit: unknown = Reflect.get(props, 'onSubmit');
  if (typeof onSubmit !== 'function') throw new Error('Expected the Quick Add submit handler');
  return onSubmit;
};

const resetQuickAdd = async (status: string, sessions: IdentifiedRecord[] = []) => {
  const stateSetter = harness.stateSetter;
  const formSetter = harness.formSetter;
  const panelSetter = harness.panelSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  if (typeof formSetter !== 'function') throw new Error('Expected to capture the Quick Add form setter');
  if (typeof panelSetter !== 'function') throw new Error('Expected to capture the panel setter');

  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        buyIns: [],
        games: [game],
        interests: [],
        playerLedger: [],
        playerSessions: [],
        profiles: [],
        sessions,
        usageEvents: []
      };
    });
    formSetter({
      gameId: game.id,
      initialBuyIn: '',
      notes: '  Quick Add fixture note  ',
      playerName: '  Quick Add Player  ',
      seatNumber: '',
      status,
      tableId: ''
    });
    panelSetter((current: unknown) => {
      if (!isOpenPanels(current)) throw new Error('Expected the current panel state');
      return { ...current, quickAdd: true };
    });
  });
};

const submitQuickAdd = async () => {
  const preventDefault = vi.fn();
  const submit = getReactSubmitHandler();
  await act(async () => {
    submit({ preventDefault });
    await Promise.resolve();
  });
  expect(preventDefault).toHaveBeenCalledOnce();
};

describe('Quick Add interest and direct-seat boundary', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        games: [game],
        settings: {
          pilotAccess,
          accountLogin: { username: 'type-014@example.test' }
        }
      })
    );
    localStorage.setItem(
      'table-manager-state-v1:auth:type-014-license',
      JSON.stringify({ expiresAt: pilotAccess.expiresAt })
    );
    document.body.innerHTML = '<div id="root"></div>';
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => null),
      loadStateForAccount: vi.fn(async () => null),
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
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.spyOn(window, 'prompt').mockImplementation(() => null);
    await act(async () => {
      await import('../main');
    });
  });

  beforeEach(() => {
    harness.savedStates.length = 0;
    localStorage.clear();
    vi.mocked(window.alert).mockClear();
    vi.mocked(window.prompt).mockClear();
  });

  afterAll(() => {
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it.each([
    ['Interested', undefined, undefined, undefined],
    ['Confirmed Coming', now, undefined, undefined],
    ['Arrived', undefined, now, undefined]
  ])('creates a %s interest without a seated timestamp', async (status, confirmedAt, arrivedAt, closedAt) => {
    await resetQuickAdd(status);

    await submitQuickAdd();

    const state = getLatestState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({ name: 'Quick Add Player', preferredGameIds: [game.id] });
    expect(state.interests).toHaveLength(1);
    expect(state.interests[0]).toMatchObject({
      profileId: state.profiles[0].id,
      playerName: 'Quick Add Player',
      gameId: game.id,
      status,
      notes: 'Quick Add fixture note',
      timestamp: now,
      interestedAt: now,
      confirmedAt,
      arrivedAt,
      closedAt
    });
    expect(Reflect.get(state.interests[0], 'seatedAt')).toBeUndefined();
    expect(state.playerSessions).toHaveLength(0);
    expect(harness.savedStates.length).toBeGreaterThanOrEqual(1);
  });

  it.each(['Declined', 'No-Show', 'Left Before Seated', 'Removed'])(
    'creates a closed %s interest without seating it',
    async (status) => {
      await resetQuickAdd(status);

      await submitQuickAdd();

      const state = getLatestState();
      expect(state.profiles).toHaveLength(1);
      expect(state.interests[0]).toMatchObject({ profileId: state.profiles[0].id });
      expect(state.interests).toHaveLength(1);
      expect(state.interests[0]).toMatchObject({ status, closedAt: now });
      expect(Reflect.get(state.interests[0], 'seatedAt')).toBeUndefined();
      expect(state.playerSessions).toHaveLength(0);
    }
  );

  it('routes Seated through the table workflow instead of constructing a seated interest', async () => {
    await resetQuickAdd('Seated', [openSession]);

    await submitQuickAdd();

    const state = getLatestState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]).toMatchObject({ name: 'Quick Add Player', preferredGameIds: [game.id] });
    expect(state.playerSessions).toHaveLength(1);
    expect(state.playerSessions[0]).toMatchObject({
      playerName: 'Quick Add Player',
      profileId: state.profiles[0].id,
      gameId: game.id,
      tableId: openSession.id,
      seatNumber: 1,
      seatedAt: now
    });
    expect(state.sessions[0]).toMatchObject({
      id: openSession.id,
      status: 'Running',
      seatsFilled: 1,
      startedAt: openSession.startedAt
    });
    expect(state.interests).toHaveLength(0);
    expect(window.alert).not.toHaveBeenCalled();
    expect(harness.savedStates.length).toBeGreaterThanOrEqual(1);
  });
});
