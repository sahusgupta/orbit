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
  games: IdentifiedRecord[];
  inAppNotifications: IdentifiedRecord[];
  interests: IdentifiedRecord[];
  playerLedger: IdentifiedRecord[];
  playerSessions: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  revenueTransactions: IdentifiedRecord[];
  settings: Record<string, unknown>;
  usageEvents: IdentifiedRecord[];
};

const harness = vi.hoisted(() => ({
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'id') === 'string';

const isCapturedState = (value: unknown): value is CapturedState => {
  if (typeof value !== 'object' || value === null) return false;
  const settings: unknown = Reflect.get(value, 'settings');
  return (
    ['games', 'inAppNotifications', 'interests', 'playerLedger', 'playerSessions', 'profiles', 'revenueTransactions', 'usageEvents'].every((key) => {
      const records: unknown = Reflect.get(value, key);
      return Array.isArray(records) && records.every(isIdentifiedRecord);
    }) &&
    typeof settings === 'object' &&
    settings !== null
  );
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isCapturedState(result[0])) {
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
const games = [
  {
    id: 'game-primary',
    name: 'Primary Holdem',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  },
  {
    id: 'game-secondary',
    name: 'Secondary Omaha',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  }
];
const pilotAccess = {
  activatedAt: '2026-08-07T12:00:00.000Z',
  authorizationCode: 'TYPE-007H-AUTH',
  authorized: true,
  expiresAt: '2099-12-31T23:59:59.000Z',
  issuedTo: 'TYPE-007H Fixture Club',
  licenseId: 'TYPE-007H-LICENSE'
};

const buildProfile = (id: string, name: string, overrides: Record<string, unknown> = {}): IdentifiedRecord => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 10,
  lastSessionTimePlayedHours: 2,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: games[0].id,
  preferredGameIds: [games[0].id],
  gamePlayCounts: {},
  mostPlayedGameId: games[0].id,
  preferredStakes: '1/2',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: false,
  typicalAvailability: 'Evenings',
  usualCompanions: [],
  preferredTags: [],
  notes: `${id} notes`,
  ...overrides
});

const buildInterest = (
  id: string,
  playerName: string,
  profileId?: string,
  overrides: Record<string, unknown> = {}
): IdentifiedRecord => ({
  id,
  ...(profileId ? { profileId } : {}),
  playerName,
  gameId: games[0].id,
  status: 'Arrived',
  timestamp: '2026-08-07T20:00:00.000Z',
  interestedAt: '2026-08-07T19:00:00.000Z',
  arrivedAt: '2026-08-07T20:00:00.000Z',
  notes: `${id} notes`,
  ...overrides
});

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const getReactClickHandler = (element: Element) => {
  const reactPropsKey = Reflect.ownKeys(element).find(
    (key) => typeof key === 'string' && key.startsWith('__reactProps$')
  );
  if (!reactPropsKey) throw new Error(`Expected React props for ${element.tagName}`);
  const props: unknown = Reflect.get(element, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected rendered React props');
  const handler: unknown = Reflect.get(props, 'onClick');
  if (typeof handler !== 'function') throw new Error('Expected onClick');
  return () => Reflect.apply(handler, undefined, []);
};

const click = async (element: Element) => {
  const handler = getReactClickHandler(element);
  await act(async () => {
    handler();
    await Promise.resolve();
  });
};

const invokeReactHandler = async (element: Element, name: 'onChange' | 'onSubmit', event: unknown) => {
  const reactPropsKey = Reflect.ownKeys(element).find(
    (key) => typeof key === 'string' && key.startsWith('__reactProps$')
  );
  if (!reactPropsKey) throw new Error(`Expected React props for ${element.tagName}`);
  const props: unknown = Reflect.get(element, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected rendered React props');
  const handler: unknown = Reflect.get(props, name);
  if (typeof handler !== 'function') throw new Error(`Expected ${name}`);
  await act(async () => {
    Reflect.apply(handler, undefined, [event]);
    await Promise.resolve();
  });
};

const changeInput = (input: Element, value: string) =>
  invokeReactHandler(input, 'onChange', { target: { value } });

const submitForm = (form: Element) =>
  invokeReactHandler(form, 'onSubmit', { preventDefault: vi.fn() });

const getButton = (label: string) => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label
  );
  if (!button) throw new Error(`Expected ${label} button`);
  return button;
};

const getLabeledInput = (form: Element, label: string) => {
  const field = Array.from(form.querySelectorAll('label')).find(
    (candidate) => candidate.querySelector('span')?.textContent?.trim() === label
  )?.querySelector('input, select');
  if (!field) throw new Error(`Expected ${label} field`);
  return field;
};

const getProfileCards = () => Array.from(document.querySelectorAll<HTMLElement>('article.profile-card'));

const getProfileCard = (index = 0) => {
  const card = getProfileCards()[index];
  if (!card) throw new Error(`Expected profile card ${index}`);
  return card;
};

const getProfileAction = (card: Element, label: string) => {
  const button = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.title === label
  );
  if (!button) throw new Error(`Expected ${label} action`);
  return button;
};

const getPersistedState = () => {
  const accountKey = localStorage.getItem('table-manager-state-v1:last-account');
  if (!accountKey) throw new Error('Expected the account storage key');
  const stored = localStorage.getItem(accountKey);
  if (!stored) throw new Error('Expected persisted state');
  const parsed: unknown = JSON.parse(stored);
  if (!isCapturedState(parsed)) throw new Error('Expected a complete persisted application state');
  return parsed;
};

const resetState = async ({
  profiles,
  interests = [],
  playerSessions = [],
  inAppNotifications = [],
  revenueTransactions = []
}: {
  profiles: IdentifiedRecord[];
  interests?: IdentifiedRecord[];
  playerSessions?: IdentifiedRecord[];
  inAppNotifications?: IdentifiedRecord[];
  revenueTransactions?: IdentifiedRecord[];
}) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return {
        ...current,
        games,
        inAppNotifications,
        interests,
        playerLedger: [],
        playerSessions,
        profiles,
        revenueTransactions,
        usageEvents: []
      };
    });
  });
};

const expectProfileInClub = (index: number, expected: boolean) => {
  const card = getProfileCard(index);
  expect(card.querySelector('.status-pill')?.textContent?.trim()).toBe(expected ? 'In club' : undefined);
  expect(getProfileAction(card, expected ? 'Remove' : 'Check in')).toBeTruthy();
};

describe('profile relationship mutations', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#profiles';
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        games,
        settings: {
          pilotAccess,
          accountLogin: { username: 'type-007h@example.test' }
        }
      })
    );
    localStorage.setItem(
      'table-manager-state-v1:auth:type-007h-license',
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
      saveState: vi.fn(async () => ({ ok: true, path: 'fixture' })),
      sendTextMessages: vi.fn(async () => ({ ok: true })),
      submitAnalyticalReport: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: false, active: true }))
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => {
      await import('../main');
    });
  });

  beforeEach(() => {
    vi.mocked(globalThis.confirm).mockClear();
  });

  afterAll(() => {
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('clears only the deleted profile ID while preserving record order, history, and inputs', async () => {
    const target = buildProfile('profile-target', 'Shared Name');
    const sameName = buildProfile('profile-other', 'Shared Name');
    const unrelated = buildProfile('profile-unrelated', 'Unrelated Player');
    const targetInterest = buildInterest('interest-target', target.name as string, target.id);
    const sameNameInterest = buildInterest('interest-other', sameName.name as string, sameName.id);
    const unlinkedInterest = buildInterest('interest-unlinked', target.name as string);
    const unrelatedInterest = buildInterest('interest-unrelated', unrelated.name as string, unrelated.id);
    const historicalSession: IdentifiedRecord = {
      id: 'session-target',
      profileId: target.id,
      playerName: target.name,
      gameId: games[0].id,
      tableId: 'table-closed',
      seatedAt: '2026-08-06T20:00:00.000Z',
      leftAt: '2026-08-06T22:00:00.000Z'
    };
    await resetState({
      profiles: [target, sameName, unrelated],
      interests: [targetInterest, sameNameInterest, unlinkedInterest, unrelatedInterest],
      playerSessions: [historicalSession]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    await click(getProfileAction(getProfileCard(0), 'Remove profile'));

    const nextState = getLatestState();
    expect(globalThis.confirm).toHaveBeenCalledOnce();
    expect(previousState).toEqual(previousSnapshot);
    expect(nextState.profiles).toEqual([sameName, unrelated]);
    expect(nextState.interests).toEqual([
      { ...targetInterest, profileId: undefined },
      sameNameInterest,
      unlinkedInterest,
      unrelatedInterest
    ]);
    expect(nextState.playerSessions).toEqual([historicalSession]);
    expect(nextState.interests[1]).toBe(previousState.interests[1]);
    expect(nextState.interests[2]).toBe(previousState.interests[2]);
    expect(nextState.interests[3]).toBe(previousState.interests[3]);
    expect(getPersistedState().profiles).toEqual(nextState.profiles);
    expect(getPersistedState().interests).toEqual(nextState.interests);
    expect(getPersistedState().playerSessions).toEqual(nextState.playerSessions);
  });

  it('merges explicitly selected duplicate IDs and retargets only their references', async () => {
    const primary = buildProfile('profile-primary', 'Duplicate Player', {
      birthday: '',
      membershipStartDate: '2026-03-01',
      membershipExpirationDate: '2026-12-31',
      totalTimePlayedHours: 4,
      lastSessionTimePlayedHours: 1,
      commonlyPlaysWithProfileIds: ['profile-duplicate-two', 'profile-friend'],
      preferredGameIds: [games[0].id],
      gamePlayCounts: { [games[0].id]: 1 },
      preferredStakes: '1/2',
      typicalBuyInMin: 200,
      typicalBuyInMax: 400,
      usualCompanions: ['Friend One'],
      preferredTags: ['Action'],
      notes: 'Primary note'
    });
    const unrelated = buildProfile('profile-unrelated', 'Other Player');
    const duplicateOne = buildProfile('profile-duplicate-one', 'Duplicate Player', {
      birthday: '1990-02-03',
      membershipStartDate: '2025-01-01',
      membershipExpirationDate: '2027-06-01',
      totalTimePlayedHours: 6,
      lastSessionTimePlayedHours: 3,
      commonlyPlaysWithProfileIds: ['profile-primary', 'profile-friend-two'],
      preferredGameId: games[1].id,
      preferredGameIds: [games[1].id],
      gamePlayCounts: { [games[1].id]: 5 },
      preferredStakes: '2/5',
      typicalBuyInMin: 100,
      typicalBuyInMax: 700,
      willingnessToMove: true,
      typicalAvailability: 'Weekends',
      usualCompanions: ['Friend Two'],
      preferredTags: ['Social'],
      notes: 'Duplicate note'
    });
    const duplicateTwo = buildProfile('profile-duplicate-two', 'Duplicate Player', {
      totalTimePlayedHours: 2,
      lastSessionTimePlayedHours: 2,
      preferredGameIds: [games[0].id, games[1].id],
      gamePlayCounts: { [games[0].id]: 2 }
    });
    const primaryInterest = buildInterest('interest-primary', primary.name as string, primary.id);
    const duplicateInterest = buildInterest('interest-duplicate', duplicateOne.name as string, duplicateOne.id);
    const unrelatedInterest = buildInterest('interest-unrelated', unrelated.name as string, unrelated.id);
    const unlinkedSameName = buildInterest('interest-unlinked', primary.name as string);
    const duplicateSession: IdentifiedRecord = {
      id: 'session-duplicate',
      profileId: duplicateTwo.id,
      playerName: duplicateTwo.name,
      gameId: games[1].id,
      tableId: 'table-one',
      seatedAt: '2026-08-07T18:00:00.000Z'
    };
    const unrelatedSession: IdentifiedRecord = {
      id: 'session-unrelated',
      profileId: unrelated.id,
      playerName: unrelated.name,
      gameId: games[0].id,
      tableId: 'table-two',
      seatedAt: '2026-08-07T19:00:00.000Z'
    };
    await resetState({
      profiles: [primary, unrelated, duplicateOne, duplicateTwo],
      interests: [primaryInterest, duplicateInterest, unrelatedInterest, unlinkedSameName],
      playerSessions: [duplicateSession, unrelatedSession]
    });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);
    const mergeButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.duplicate-card button')).find(
      (button) => button.textContent?.trim() === 'Merge'
    );
    if (!mergeButton) throw new Error('Expected duplicate merge action');

    await click(mergeButton);

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(nextState.profiles.map((profile) => profile.id)).toEqual([primary.id, unrelated.id]);
    expect(nextState.profiles[0]).toMatchObject({
      id: primary.id,
      birthday: '1990-02-03',
      membershipStartDate: '2025-01-01',
      membershipExpirationDate: '2027-06-01',
      totalTimePlayedHours: 12,
      lastSessionTimePlayedHours: 3,
      commonlyPlaysWithProfileIds: ['profile-friend', 'profile-friend-two'],
      preferredGameId: games[0].id,
      preferredGameIds: [games[0].id, games[1].id],
      gamePlayCounts: { [games[0].id]: 3, [games[1].id]: 5 },
      mostPlayedGameId: games[1].id,
      preferredStakes: '1/2, 2/5',
      typicalBuyInMin: 100,
      typicalBuyInMax: 700,
      willingnessToMove: true,
      typicalAvailability: 'Evenings, Weekends',
      usualCompanions: ['Friend One', 'Friend Two'],
      preferredTags: ['Action', 'Social'],
      notes: 'Primary note | Duplicate note | profile-duplicate-two notes'
    });
    expect(nextState.profiles[1]).toBe(previousState.profiles[1]);
    expect(nextState.interests).toEqual([
      primaryInterest,
      { ...duplicateInterest, profileId: primary.id },
      unrelatedInterest,
      unlinkedSameName
    ]);
    expect(nextState.playerSessions).toEqual([
      { ...duplicateSession, profileId: primary.id },
      unrelatedSession
    ]);
    expect(nextState.interests[0]).toBe(previousState.interests[0]);
    expect(nextState.interests[2]).toBe(previousState.interests[2]);
    expect(nextState.interests[3]).toBe(previousState.interests[3]);
    expect(nextState.playerSessions[1]).toBe(previousState.playerSessions[1]);
    expect(getPersistedState().profiles).toEqual(nextState.profiles);
    expect(getPersistedState().interests).toEqual(nextState.interests);
    expect(getPersistedState().playerSessions).toEqual(nextState.playerSessions);
  });

  it('uses an authoritative matching profile ID even when the stored name differs', async () => {
    const target = buildProfile('profile-target', 'Target Player');
    const nameMatch = buildProfile('profile-name-match', 'Stored Other Name');
    const authoritative = buildInterest('interest-authoritative', nameMatch.name as string, target.id);
    await resetState({ profiles: [target, nameMatch], interests: [authoritative] });

    expectProfileInClub(0, true);
    expectProfileInClub(1, false);
    await click(getProfileAction(getProfileCard(0), 'Remove'));

    expect(getLatestState().interests).toEqual([]);
    expect(getPersistedState().interests).toEqual([]);
  });

  it('preserves an unresolved authoritative profile ID without falling back by name', async () => {
    const target = buildProfile('profile-target', 'Broken Link Player');
    const broken = buildInterest('interest-broken', target.name as string, 'profile-missing');
    await resetState({ profiles: [target], interests: [broken] });
    const previousState = getLatestState();

    expectProfileInClub(0, false);
    await click(getProfileAction(getProfileCard(0), 'Check in'));

    expect(getLatestState().interests).toEqual([
      expect.objectContaining({ profileId: target.id, playerName: target.name, status: 'Arrived' }),
      broken
    ]);
    expect(getLatestState().interests[1]).toBe(previousState.interests[0]);
    expect(getPersistedState().interests).toEqual(getLatestState().interests);
  });

  it('uses one case-insensitive unlinked name match as the fallback relationship', async () => {
    const target = buildProfile('profile-target', 'Unique Player');
    const unlinked = buildInterest('interest-unlinked', '  UNIQUE PLAYER  ');
    await resetState({ profiles: [target], interests: [unlinked] });

    expectProfileInClub(0, true);
    await click(getProfileAction(getProfileCard(0), 'Remove'));

    expect(getLatestState().interests).toEqual([]);
    expect(getPersistedState().interests).toEqual([]);
  });

  it('creates a new authoritative check-in when no ID or name relationship exists', async () => {
    const target = buildProfile('profile-target', 'New Arrival', { preferredGameIds: [games[1].id] });
    const unrelated = buildInterest('interest-unrelated', 'Other Player', 'profile-other');
    await resetState({ profiles: [target], interests: [unrelated] });
    const previousState = getLatestState();
    const previousSnapshot = structuredClone(previousState);

    expectProfileInClub(0, false);
    await click(getProfileAction(getProfileCard(0), 'Check in'));

    const nextState = getLatestState();
    expect(previousState).toEqual(previousSnapshot);
    expect(nextState.interests).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        profileId: target.id,
        playerName: target.name,
        gameId: games[1].id,
        status: 'Arrived',
        timestamp: now,
        interestedAt: now,
        arrivedAt: now,
        notes: 'Checked in at club entry'
      }),
      unrelated
    ]);
    expect(nextState.interests[1]).toBe(previousState.interests[0]);
    expect(nextState.playerLedger).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'Check-In',
        profileId: target.id,
        playerName: target.name,
        gameId: games[1].id,
        timestamp: now
      })
    ]);
    expect(getPersistedState().interests).toEqual(nextState.interests);
    expect(getPersistedState().playerLedger).toEqual(nextState.playerLedger);
  });

  it('does not infer a relationship from duplicate unlinked same-name interests', async () => {
    const target = buildProfile('profile-target', 'Ambiguous Player');
    const first = buildInterest('interest-first', target.name as string);
    const second = buildInterest('interest-second', target.name as string, undefined, { gameId: games[1].id });
    await resetState({ profiles: [target], interests: [first, second] });
    const previousState = getLatestState();

    expectProfileInClub(0, false);
    await click(getProfileAction(getProfileCard(0), 'Check in'));

    expect(getLatestState().interests).toEqual([
      expect.objectContaining({ profileId: target.id, playerName: target.name, status: 'Arrived' }),
      first,
      second
    ]);
    expect(getLatestState().interests[1]).toBe(previousState.interests[0]);
    expect(getLatestState().interests[2]).toBe(previousState.interests[1]);
    expect(getPersistedState().interests).toEqual(getLatestState().interests);
  });

  it('does not overwrite a same-name interest linked authoritatively to another profile', async () => {
    const target = buildProfile('profile-target', 'Same Name');
    const linkedProfile = buildProfile('profile-linked', 'Same Name');
    const incompatible = buildInterest('interest-incompatible', target.name as string, linkedProfile.id);
    await resetState({ profiles: [target, linkedProfile], interests: [incompatible] });
    const previousState = getLatestState();

    expectProfileInClub(0, false);
    expectProfileInClub(1, true);
    await click(getProfileAction(getProfileCard(0), 'Check in'));

    expect(getLatestState().interests).toEqual([
      expect.objectContaining({ profileId: target.id, playerName: target.name, status: 'Arrived' }),
      incompatible
    ]);
    expect(getLatestState().interests[1]).toBe(previousState.interests[0]);
    expect(getPersistedState().interests).toEqual(getLatestState().interests);
  });

  it('creates a paid walk-in member and one exact manual membership revenue record', async () => {
    await resetState({ profiles: [] });
    await click(getButton('Add player'));
    const form = document.querySelector('.player-popup-form');
    if (!form) throw new Error('Expected add-member form');

    await changeInput(getLabeledInput(form, 'Player name'), '  Paid Walk-In  ');
    await changeInput(getLabeledInput(form, 'Amount paid in person'), '42.75');
    await submitForm(form);

    const nextState = getLatestState();
    expect(nextState.profiles).toHaveLength(1);
    expect(nextState.profiles[0]).toMatchObject({
      id: expect.any(String),
      name: 'Paid Walk-In',
      membershipPlan: 'monthly',
      membershipPaymentMethod: 'core',
      membershipStatus: 'Active',
      membershipRequestedAt: now,
      membershipPriceLabel: '$42.75'
    });
    expect(nextState.revenueTransactions).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'membership',
        amountCents: 4275,
        occurredAt: now,
        paymentStatus: 'paid',
        source: 'manual',
        playerName: 'Paid Walk-In',
        membershipPlan: 'monthly'
      })
    ]);
    expect(nextState.revenueTransactions[0]).not.toHaveProperty('playerId');
    expect(getPersistedState().profiles).toEqual(nextState.profiles);
    expect(getPersistedState().revenueTransactions).toEqual(nextState.revenueTransactions);
  });

  it('approves a request without revenue and emits the established targeted notification', async () => {
    const request = buildProfile('profile-requested', 'Requested Player', {
      membershipStatus: 'Requested',
      membershipPlan: 'day',
      membershipRequestedAt: '2026-08-07T20:00:00.000Z',
      membershipExpiresAt: '2026-08-08T20:00:00.000Z'
    });
    await resetState({ profiles: [request] });
    await click(getButton('Requests 1'));
    await click(getButton('Approve application'));

    const nextState = getLatestState();
    expect(nextState.profiles[0]).toMatchObject({
      id: request.id,
      membershipStatus: 'Approved',
      membershipStartDate: '',
      membershipExpirationDate: '',
      membershipExpiresAt: undefined
    });
    expect(nextState.revenueTransactions).toEqual([]);
    expect(nextState.inAppNotifications[0]).toMatchObject({
      id: expect.any(String),
      gameId: '',
      title: 'Membership approved',
      reason: 'membership-approved',
      createdAt: now,
      expiresAt: '2026-08-14T22:00:00.000Z',
      targetPlayerIds: [request.id],
      targetPlayerNames: [request.name]
    });
    expect(getPersistedState().profiles).toEqual(nextState.profiles);
    expect(getPersistedState().inAppNotifications).toEqual(nextState.inAppNotifications);
  });

  it('activates an approved member and records price-label revenue with authoritative identity', async () => {
    const approved = buildProfile('profile-approved', 'Approved Player', {
      membershipStatus: 'Approved',
      membershipPlan: 'monthly',
      membershipDurationDays: 30,
      membershipPriceLabel: '$49.00/mo'
    });
    await resetState({ profiles: [approved] });
    if (!document.querySelector('.membership-requests-layout')) await click(getButton('Requests 1'));
    await click(getButton('Verify ID, mark paid & activate'));

    const nextState = getLatestState();
    expect(nextState.profiles[0]).toMatchObject({
      id: approved.id,
      membershipStartDate: '2026-08-07',
      membershipExpirationDate: '2026-09-06',
      membershipExpiresAt: '2026-09-06T22:00:00.000Z',
      membershipPaymentMethod: 'in-person',
      membershipStatus: 'Active'
    });
    expect(nextState.revenueTransactions).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        type: 'membership',
        amountCents: 4900,
        occurredAt: now,
        paymentStatus: 'paid',
        source: 'manual',
        playerId: approved.id,
        playerName: approved.name,
        membershipPlan: 'monthly'
      })
    ]);
    expect(nextState.inAppNotifications[0]).toMatchObject({
      id: expect.any(String),
      title: 'Membership active',
      reason: 'membership-activated',
      createdAt: now,
      expiresAt: '2026-08-14T22:00:00.000Z',
      targetPlayerIds: [approved.id],
      targetPlayerNames: [approved.name]
    });
    expect(getPersistedState().profiles).toEqual(nextState.profiles);
    expect(getPersistedState().revenueTransactions).toEqual(nextState.revenueTransactions);
    expect(getPersistedState().inAppNotifications).toEqual(nextState.inAppNotifications);
  });
});
