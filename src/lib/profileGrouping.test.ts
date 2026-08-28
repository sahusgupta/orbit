/**
 * @vitest-environment jsdom
 */
import type { DependencyList } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  memoResults: [] as unknown[],
  root: undefined as { unmount: () => void } | undefined
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo<T>(factory: () => T, dependencies: DependencyList) {
      const result = actual.useMemo(factory, dependencies);
      harness.memoResults.push(result);
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
  syncPlayerUpdatesToClubState: vi.fn(async <T>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const makeProfile = (id: string, name: string) => ({
  id,
  name,
  phone: `555-${id}`,
  address: '',
  birthday: '1990-01-02',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2099-12-31',
  membershipExpiresAt: '2099-12-31T23:59:59.000Z',
  membershipPlan: 'monthly',
  membershipPaymentMethod: 'core',
  membershipPaymentStatus: 'Paid',
  membershipStatus: 'Active',
  membershipRequestedAt: '2026-01-01T10:00:00.000Z',
  membershipPriceLabel: '$40/mo',
  membershipPlanName: 'Monthly Membership',
  membershipDurationDays: 30,
  savedTimeCreditMinutes: 0,
  totalTimePlayedHours: id.length,
  lastSessionTimePlayedHours: 2,
  commonlyPlaysWithProfileIds: [`companion-${id}`],
  preferredGameId: 'nlh-1-2',
  preferredGameIds: ['nlh-1-2'],
  gamePlayCounts: {},
  mostPlayedGameId: 'nlh-1-2',
  preferredStakes: '$1/$2',
  typicalBuyInMin: 100,
  typicalBuyInMax: 500,
  willingnessToMove: true,
  typicalAvailability: 'Friday evening',
  usualCompanions: [`Friend ${id}`],
  preferredTags: ['Action'],
  notes: `Notes for ${id}`,
  identityReviewStatus: 'Not required'
});

const aliceOne = makeProfile('alice-1', ' Alice ');
const unique = makeProfile('unique-1', 'Unique Player');
const bobOne = makeProfile('bob-1', 'BOB');
const carolOne = makeProfile('carol-1', 'Carol');
const aliceTwo = makeProfile('alice-2', 'alice');
const bobTwo = makeProfile('bob-2', ' bob ');
const aliceThree = makeProfile('alice-3', 'ALICE');
const carolTwo = makeProfile('carol-2', '  cArOl  ');
const sourceProfiles = [aliceOne, unique, bobOne, carolOne, aliceTwo, bobTwo, aliceThree, carolTwo];
const expectedGroupIds = [
  ['alice-1', 'alice-2', 'alice-3'],
  ['bob-1', 'bob-2'],
  ['carol-1', 'carol-2']
];

type IdentifiedRecord = Record<string, unknown> & { id: string };

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isExpectedDuplicateGroups = (value: unknown): value is IdentifiedRecord[][] =>
  Array.isArray(value) &&
  value.every(
    (group: unknown) => Array.isArray(group) && group.every((profile: unknown) => isIdentifiedRecord(profile))
  ) &&
  value.length === expectedGroupIds.length &&
  value.every((group, groupIndex) =>
    group.length === expectedGroupIds[groupIndex].length &&
    group.every((profile, profileIndex) => profile.id === expectedGroupIds[groupIndex][profileIndex])
  );

describe('duplicate profile grouping', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    const accountKey = 'type-007a-test';
    const stateKey = `table-manager-state-v1:${accountKey}`;

    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '/profiles';
    localStorage.clear();
    localStorage.setItem('table-manager-state-v1:last-account', stateKey);
    localStorage.setItem(
      `table-manager-state-v1:auth:${accountKey}`,
      JSON.stringify({ expiresAt, savedAt: '2026-08-06T12:00:00.000Z' })
    );
    localStorage.setItem(
      stateKey,
      JSON.stringify({
        games: [],
        profiles: sourceProfiles,
        tournaments: [],
        interests: [],
        sessions: [],
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
          defaultTableCap: 10,
          defaultHourlyFee: 0,
          defaultEstimatedDropPerSeatHour: 0,
          collectionProfiles: [],
          membershipPlans: [],
          showPlayerGrid: true,
          showDashboardKpis: false,
          showRecentPlayers: true,
          pilotAccess: {
            authorized: true,
            authorizationCode: 'TYPE-007A-TEST-CODE',
            expiresAt,
            activatedAt: '2026-08-06T12:00:00.000Z',
            licenseId: 'TYPE-007A-TEST'
          },
          clubAccount: {
            clubName: 'Local Test Club',
            accountName: 'Local Test Account',
            contactName: 'Test Operator',
            email: 'type-007a@example.test',
            phone: '',
            address: ''
          },
          staffAccounts: [],
          accountLogin: {
            username: 'type-007a@example.test',
            passwordSalt: 'local-test-salt',
            passwordHash: 'local-test-hash',
            createdAt: '2026-08-06T12:00:00.000Z'
          }
        }
      })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    await act(async () => {
      await import('../components/ProfilesView');
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('normalizes names, retains complete profiles, and preserves source and first-seen group order', () => {
    const duplicateGroups = harness.memoResults.find(isExpectedDuplicateGroups);

    expect(duplicateGroups).toEqual([
      [aliceOne, aliceTwo, aliceThree],
      [bobOne, bobTwo],
      [carolOne, carolTwo]
    ]);
    expect(duplicateGroups?.flat()).not.toContainEqual(unique);

    const renderedGroups = Array.from(document.querySelectorAll('.duplicate-card span')).map((element) => element.textContent);
    expect(renderedGroups).toEqual([
      'Possible duplicate:  Alice , alice, ALICE',
      'Possible duplicate: BOB,  bob ',
      'Possible duplicate: Carol,   cArOl  '
    ]);
  });
});
