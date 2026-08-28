import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredDocument = Record<string, unknown>;

type DocumentSnapshot = {
  data: () => unknown;
  id: string;
  ref: { path: string };
};

type WriteOperation = {
  data?: StoredDocument;
  options?: unknown;
  path: string;
  type: 'delete' | 'set';
};

const firebaseHarness = vi.hoisted(() => ({
  auth: {
    authStateReady: vi.fn(async () => undefined),
    currentUser: { uid: 'type-003-user' } as { uid: string } | null
  },
  batchCommits: 0,
  batchOperations: [] as WriteOperation[],
  documentsByPath: new Map<string, unknown[]>(),
  loadedDocument: { exists: false, data: undefined as unknown },
  setDocCalls: [] as Array<{ data: StoredDocument; options?: unknown; path: string }>,
  updateDocCalls: [] as Array<{ data: StoredDocument; path: string }>
}));

const pathFrom = (parts: unknown[]) => parts.filter((part): part is string => typeof part === 'string').join('/');

const snapshotsFor = (path: string): DocumentSnapshot[] =>
  (firebaseHarness.documentsByPath.get(path) ?? []).map((record, index) => {
    const id = record && typeof record === 'object' && !Array.isArray(record) && typeof (record as { id?: unknown }).id === 'string'
      ? (record as { id: string }).id
      : `document-${index}`;
    return {
      data: () => structuredClone(record),
      id,
      ref: { path: `${path}/${id}` }
    };
  });

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => [{ name: 'type-003-app' }]),
  initializeApp: vi.fn(() => ({ name: 'type-003-app' }))
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(async () => ({ user: firebaseHarness.auth.currentUser })),
  getAuth: vi.fn(() => firebaseHarness.auth),
  signInWithEmailAndPassword: vi.fn(async () => ({ user: firebaseHarness.auth.currentUser })),
  signOut: vi.fn(async () => undefined)
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...parts: unknown[]) => ({ path: pathFrom(parts) })),
  doc: vi.fn((...parts: unknown[]) => ({ path: pathFrom(parts) })),
  getDoc: vi.fn(async () => ({
    exists: () => firebaseHarness.loadedDocument.exists,
    data: () => structuredClone(firebaseHarness.loadedDocument.data)
  })),
  getDocs: vi.fn(async (reference: { path: string }) => ({ docs: snapshotsFor(reference.path) })),
  getFirestore: vi.fn(() => ({ name: 'type-003-firestore' })),
  initializeFirestore: vi.fn(() => ({ name: 'type-003-firestore' })),
  onSnapshot: vi.fn(() => () => undefined),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  setDoc: vi.fn(async (reference: { path: string }, data: StoredDocument, options?: unknown) => {
    firebaseHarness.setDocCalls.push({ path: reference.path, data: structuredClone(data), options });
  }),
  updateDoc: vi.fn(async (reference: { path: string }, data: StoredDocument) => {
    firebaseHarness.updateDocCalls.push({ path: reference.path, data: structuredClone(data) });
  }),
  writeBatch: vi.fn(() => ({
    delete(reference: { path: string }) {
      firebaseHarness.batchOperations.push({ type: 'delete', path: reference.path });
    },
    set(reference: { path: string }, data: StoredDocument, options?: unknown) {
      firebaseHarness.batchOperations.push({ type: 'set', path: reference.path, data: structuredClone(data), options });
    },
    async commit() {
      firebaseHarness.batchCommits += 1;
    }
  }))
}));

vi.mock('./firebaseConfig', () => ({
  firebaseConfig: { projectId: 'type-003-project' }
}));

import {
  loadClubStateFromFirebase,
  saveClubStateToFirebase,
  syncPlayerUpdatesToClubState,
  type FirebaseSyncState,
  type ManagementRevenueTransaction,
  type ManagementTournament,
  type ManagementTournamentPlayer
} from './firebaseClubSync';
import {
  decodeFirebaseClubStateRecord,
  decodeMembershipRequest,
  decodeWaitlistRequest,
  readPendingRequestMarker
} from './firebaseClubDecoders';

const clubId = 'type-003-fixture';
const paths = {
  membershipRequests: `clubs/${clubId}/membershipRequests`,
  legacyMembershipRequests: `clubStates/${clubId}/membershipRequests`,
  waitlistRequests: `clubs/${clubId}/waitlistRequests`,
  legacyWaitlistRequests: `clubStates/${clubId}/waitlistRequests`,
  registrations: `clubs/${clubId}/tournamentRegistrations`,
  transactions: `clubs/${clubId}/transactions`
};

const game = {
  id: 'game-one',
  name: '1/2 Holdem',
  maxSeats: 8,
  minInRoomForLikely: 3,
  minFlexibleForLikely: 4,
  minTotalForViable: 6
};

const buildProfile = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '',
  membershipExpirationDate: '',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: {},
  mostPlayedGameId: game.id,
  preferredStakes: '1/2',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: false,
  typicalAvailability: 'Evenings',
  preferredTags: [],
  usualCompanions: [],
  notes: `${id} notes`,
  ...overrides
});

type TestTournament = ManagementTournament & { preservedTournamentField: string };

const buildTournament = (id: string, players: ManagementTournamentPlayer[] = []): TestTournament => ({
  id,
  name: `Tournament ${id}`,
  status: 'Draft',
  createdAt: '2026-08-01T12:00:00.000Z',
  scheduledAt: '2026-08-08T18:00:00.000Z',
  registrationOpensAt: '2026-08-01T18:00:00.000Z',
  registrationClosesAt: '2026-08-08T18:30:00.000Z',
  registrationStatus: 'open',
  currentLevelIndex: 0,
  buyIn: 100,
  startingStack: 20_000,
  rebuyPrizePercent: 100,
  rebuyPrice: 100,
  addOnPrice: 50,
  lateRegistrationThroughLevel: 4,
  tableSize: 9,
  levels: [
    {
      id: `${id}-level-one`,
      level: 1,
      smallBlind: 100,
      bigBlind: 200,
      ante: 0,
      durationMinutes: 20,
      breakAfter: false,
      breakMinutes: 0
    }
  ],
  players,
  payouts: [{ place: 1, percent: 100 }],
  rules: ['Published rule'],
  featured: false,
  preservedTournamentField: `${id}-preserved`
});

type TestState = Omit<FirebaseSyncState, 'tournaments'> & {
  preservedRootField: { enabled: boolean };
  settings: NonNullable<FirebaseSyncState['settings']> & {
    clubAccount: { clubName: string; email: string };
    defaultCollectionMode: 'Time' | 'Drop';
    pilotAccess: { licenseId: string };
  };
  tournaments: TestTournament[];
};

const buildState = (overrides: Partial<TestState> = {}): TestState => ({
  games: [game],
  sessions: [],
  playerSessions: [],
  interests: [],
  profiles: [buildProfile('profile-existing', 'Existing Player')],
  tournaments: [],
  revenueTransactions: [],
  inAppNotifications: [],
  settings: {
    defaultCollectionMode: 'Time',
    collectionProfiles: [],
    membershipPlans: [],
    staffAccounts: [],
    pilotAccess: { licenseId: clubId },
    clubAccount: { clubName: 'TYPE-003 Club', email: 'type-003@example.test' }
  },
  preservedRootField: { enabled: true },
  ...overrides
});

const setRemoteDocuments = (path: string, documents: unknown[]) => {
  firebaseHarness.documentsByPath.set(path, documents);
};

const getSetOperation = (path: string) => {
  const operation = firebaseHarness.batchOperations.find((candidate) => candidate.type === 'set' && candidate.path === path);
  if (!operation?.data) throw new Error(`Expected batch set for ${path}`);
  return operation;
};

beforeEach(() => {
  vi.useRealTimers();
  firebaseHarness.auth.currentUser = { uid: 'type-003-user' };
  firebaseHarness.auth.authStateReady.mockClear();
  firebaseHarness.batchCommits = 0;
  firebaseHarness.batchOperations.length = 0;
  firebaseHarness.documentsByPath.clear();
  firebaseHarness.loadedDocument = { exists: false, data: undefined };
  firebaseHarness.setDocCalls.length = 0;
  firebaseHarness.updateDocCalls.length = 0;
});

describe('Firebase state and Player request input characterization', () => {
  it('returns canonical decoder results, validates state containers, and retains known legacy fallbacks', () => {
    expect(decodeFirebaseClubStateRecord({ state: { profiles: 'not-an-array' } })).toBeNull();
    expect(decodeFirebaseClubStateRecord({ state: { profiles: [], settings: [] } })).toBeNull();
    expect(decodeFirebaseClubStateRecord({ state: { physicalTables: 'not-an-array' } })).toBeNull();
    expect(decodeFirebaseClubStateRecord({
      state: { physicalTables: [{ id: 'physical-1', label: 'Table 1', maxSeats: 8 }] }
    })?.state.physicalTables).toEqual([{ id: 'physical-1', label: 'Table 1', maxSeats: 8 }]);
    expect(decodeMembershipRequest({
      id: 'membership-decoded',
      clubId,
      player: { id: 'player-decoded', name: 'Decoded Player', email: 'decoded@example.test' },
      plan: 'day',
      paymentMethod: 'app',
      requestedAt: '2026-08-10T05:01:00.000Z'
    })).toMatchObject({
      id: 'membership-decoded',
      type: 'membership-request',
      player: { preferredGameIds: [] }
    });
    expect(decodeWaitlistRequest({
      id: 'waitlist-decoded',
      clubId,
      player: { id: 'player-decoded', name: 'Decoded Player', email: 'decoded@example.test' },
      gameId: game.id,
      action: 'legacy-action',
      attendance: 'legacy-attendance',
      requestedAt: '2026-08-10T05:02:00.000Z'
    })).toMatchObject({
      id: 'waitlist-decoded',
      type: 'waitlist-request',
      action: undefined,
      attendance: undefined
    });
    expect(() => decodeMembershipRequest({ type: 'waitlist-request' })).toThrow('Membership request record is malformed.');
    expect(readPendingRequestMarker({ id: 'duplicate', status: 'applied' })).toEqual({ id: 'duplicate', status: 'applied' });
    expect(readPendingRequestMarker(null)).toEqual({ id: undefined, status: undefined });
  });

  it('returns a valid cloud envelope unchanged and treats an existing null document as the current null fallback', async () => {
    const record = {
      accountKey: clubId,
      savedAt: '2026-08-10T05:00:00.000Z',
      state: { profiles: [], interests: [] },
      snapshot: { club: { id: clubId, name: 'TYPE-003 Club' } }
    };
    firebaseHarness.loadedDocument = { exists: true, data: record };

    await expect(loadClubStateFromFirebase(clubId)).resolves.toEqual(record);

    firebaseHarness.loadedDocument = { exists: true, data: null };
    await expect(loadClubStateFromFirebase(clubId)).resolves.toBeNull();
  });

  it('accepts legacy requests without discriminators, deduplicates current/legacy IDs, and skips malformed applied records', async () => {
    const membership = {
      id: 'membership-legacy',
      clubId,
      player: {
        id: 'player-membership',
        name: 'Membership Player',
        email: 'membership@example.test',
        preferredGameIds: [game.id]
      },
      plan: 'monthly',
      paymentMethod: 'in-person',
      requestedAt: '2026-08-10T05:05:00.000Z'
    };
    const waitlist = {
      id: 'waitlist-legacy',
      clubId,
      player: {
        id: 'player-waitlist',
        name: 'Waitlist Player',
        email: 'waitlist@example.test'
      },
      gameId: game.id,
      requestedAt: '2026-08-10T05:06:00.000Z'
    };
    setRemoteDocuments(paths.membershipRequests, [membership]);
    setRemoteDocuments(paths.legacyMembershipRequests, [membership]);
    setRemoteDocuments(paths.waitlistRequests, [waitlist]);
    setRemoteDocuments(paths.legacyWaitlistRequests, [{ status: 'applied' }]);

    const result = await syncPlayerUpdatesToClubState(buildState());

    expect(result.profiles.filter((profile) => profile.id === 'player-membership')).toHaveLength(1);
    expect(result.profiles.filter((profile) => profile.id === 'player-waitlist')).toHaveLength(1);
    expect(result.interests.filter((interest) => interest.id === 'waitlist-legacy')).toHaveLength(1);
    expect(firebaseHarness.setDocCalls.filter((call) => call.path === `clubs/${clubId}/memberships/player-membership`)).toHaveLength(1);
    expect(firebaseHarness.updateDocCalls).toHaveLength(4);
  });

  it('rejects a malformed null pending request before mutating or acknowledging state', async () => {
    setRemoteDocuments(paths.membershipRequests, [null]);

    await expect(syncPlayerUpdatesToClubState(buildState())).rejects.toThrow();
    expect(firebaseHarness.setDocCalls).toHaveLength(0);
    expect(firebaseHarness.updateDocCalls).toHaveLength(0);
  });
});

describe('Firebase club synchronization transforms', () => {
  it('preserves canonical revenue fields, time-package, authoritative transaction IDs, order, and idempotency', async () => {
    const existing: ManagementRevenueTransaction = {
      id: 'transaction-existing',
      type: 'other',
      amountCents: 100,
      occurredAt: '2026-08-01T10:00:00.000Z',
      paymentStatus: 'paid',
      source: 'manual',
      playerName: 'Mutable Display'
    };
    const untouched: ManagementRevenueTransaction = {
      id: 'transaction-untouched',
      type: 'refund',
      amountCents: 50,
      occurredAt: '2026-08-01T11:00:00.000Z',
      paymentStatus: 'refunded',
      source: 'manual'
    };
    const replacement = {
      ...existing,
      amountCents: 275,
      playerName: 'Changed Display',
      stripeEventId: 'event-existing'
    };
    const sameDisplayDifferentId = {
      ...replacement,
      id: 'transaction-distinct',
      amountCents: 325
    };
    const timePackage = {
      id: 'transaction-time-package',
      type: 'time-package',
      amountCents: 12_500,
      currency: 'usd',
      occurredAt: '2026-08-02T10:00:00.000Z',
      paymentStatus: 'paid',
      source: 'stripe',
      playerId: 'profile-time-buyer',
      playerName: 'Time Buyer',
      playerEmail: 'time@example.test',
      membershipPlan: null,
      accessProduct: 'time-5',
      fulfilledByClubId: clubId,
      stripeEventId: 'event-time-package'
    };
    const remoteRecords = [replacement, sameDisplayDifferentId, timePackage];
    const remoteSnapshot = structuredClone(remoteRecords);
    const state = buildState({ revenueTransactions: [existing, untouched] });
    const stateSnapshot = structuredClone(state);
    setRemoteDocuments(paths.transactions, remoteRecords);

    const first = await syncPlayerUpdatesToClubState(state);
    const second = await syncPlayerUpdatesToClubState(first);

    expect(state).toEqual(stateSnapshot);
    expect(remoteRecords).toEqual(remoteSnapshot);
    expect(first.revenueTransactions).toEqual([replacement, untouched, sameDisplayDifferentId, timePackage]);
    expect(second).toEqual(first);
    expect(first.preservedRootField).toEqual({ enabled: true });
    expect(first.profiles).toEqual(state.profiles);
  });

  it('applies paid membership only by authoritative player ID without bypassing an unset ID review', async () => {
    const wrongSameName = buildProfile('profile-wrong-name', 'Paid Player');
    const wrongEmailNote = buildProfile('profile-wrong-email', 'Another Player', { notes: 'Contact payer@example.test' });
    const authoritative = buildProfile('profile-authoritative', 'Authoritative Player');
    const payment = {
      id: 'transaction-membership',
      type: 'membership',
      amountCents: 5000,
      occurredAt: '2026-08-03T10:00:00.000Z',
      paymentStatus: 'paid',
      source: 'stripe',
      playerId: authoritative.id,
      playerName: wrongSameName.name,
      playerEmail: 'payer@example.test',
      membershipPlan: 'monthly'
    };
    const missingPlayerId = {
      id: 'transaction-missing-player',
      type: 'membership',
      amountCents: 2000,
      occurredAt: '2026-08-04T10:00:00.000Z',
      paymentStatus: 'paid',
      source: 'stripe',
      playerName: 'Created From Payment',
      playerEmail: 'created@example.test',
      membershipPlan: 'day'
    };
    const state = buildState({ profiles: [wrongSameName, wrongEmailNote, authoritative] });
    const stateSnapshot = structuredClone(state);
    setRemoteDocuments(paths.transactions, [payment, missingPlayerId]);

    const result = await syncPlayerUpdatesToClubState(state);

    expect(state).toEqual(stateSnapshot);
    expect(result.profiles[0]).toBe(state.profiles[0]);
    expect(result.profiles[1]).toBe(state.profiles[1]);
    expect(result.profiles[2]).toEqual({
      ...authoritative,
      membershipStartDate: '',
      membershipExpirationDate: '',
      membershipExpiresAt: undefined,
      membershipPaymentAmountCents: 5000,
      membershipPaymentStatus: 'Paid',
      membershipPaymentTransactionId: 'transaction-membership',
      membershipStatus: 'Approved'
    });
    expect(result.profiles).toHaveLength(3);
    expect(result.revenueTransactions).toEqual([payment, missingPlayerId]);
  });

  it('skips unknown payment types and records without authoritative transaction IDs', async () => {
    const unknownType = {
      id: 'transaction-unknown',
      type: 'invented-payment-type',
      amountCents: 1234,
      occurredAt: '2026-08-05T10:00:00.000Z',
      paymentStatus: 'paid',
      source: 'import'
    };
    const missingId = {
      type: 'other',
      amountCents: 5678,
      occurredAt: '2026-08-05T11:00:00.000Z',
      paymentStatus: 'paid',
      source: 'import'
    };
    setRemoteDocuments(paths.transactions, [unknownType, missingId]);

    const state = buildState();
    const result = await syncPlayerUpdatesToClubState(state);

    expect(result).toBe(state);
    expect(result.revenueTransactions).toEqual([]);
  });

  it('imports every valid registration status and skips unknown or missing authoritative identity', async () => {
    const tournament = buildTournament('tournament-one');
    const unrelatedTournament = buildTournament('tournament-unrelated');
    const registrations = [
      {
        id: 'registration-registered',
        tournamentId: tournament.id,
        playerId: 'profile-registered',
        playerName: 'Registered Player',
        playerEmail: 'registered@example.test',
        status: 'registered',
        rebuys: 0,
        addOns: 0,
        registeredAt: '2026-08-05T12:00:00.000Z'
      },
      {
        id: 'registration-checked-in',
        tournamentId: tournament.id,
        playerId: 'profile-checked-in',
        playerName: 'Checked Player',
        status: 'checked-in',
        rebuys: 1,
        addOns: 0,
        registeredAt: '2026-08-05T12:01:00.000Z'
      },
      {
        id: 'registration-eliminated',
        tournamentId: tournament.id,
        playerId: 'profile-eliminated',
        playerName: 'Eliminated Player',
        status: 'eliminated',
        rebuys: 2,
        addOns: 1,
        registeredAt: '2026-08-05T12:02:00.000Z'
      },
      {
        id: 'registration-finished',
        tournamentId: tournament.id,
        playerId: 'profile-finished',
        playerName: 'Finished Player',
        status: 'finished',
        rebuys: 0,
        addOns: 1,
        registeredAt: '2026-08-05T12:03:00.000Z'
      },
      {
        id: 'registration-rebought',
        tournamentId: tournament.id,
        playerId: 'profile-rebought',
        playerName: 'Rebuy Player',
        status: 'rebought',
        rebuys: 2,
        addOns: 0,
        registeredAt: '2026-08-05T12:03:30.000Z'
      },
      {
        id: 'registration-add-on',
        tournamentId: tournament.id,
        playerId: 'profile-add-on',
        playerName: 'Add-on Player',
        status: 'add-on-purchased',
        rebuys: 0,
        addOns: 1,
        registeredAt: '2026-08-05T12:03:45.000Z'
      },
      {
        id: 'registration-unknown',
        tournamentId: tournament.id,
        playerId: 'profile-unknown',
        playerName: 'Unknown Status Player',
        status: 'not-a-status',
        rebuys: 0,
        addOns: 0,
        registeredAt: '2026-08-05T12:04:00.000Z'
      },
      {
        tournamentId: tournament.id,
        playerId: 'profile-missing-id',
        playerName: 'Missing ID Player',
        status: 'registered',
        rebuys: 0,
        addOns: 0,
        registeredAt: '2026-08-05T12:05:00.000Z'
      },
      {
        id: 'registration-missing-tournament',
        playerId: 'profile-missing-tournament',
        playerName: 'Missing Tournament Player',
        status: 'registered'
      }
    ];
    const rawSnapshot = structuredClone(registrations);
    const state = buildState({ tournaments: [tournament, unrelatedTournament] });
    const stateSnapshot = structuredClone(state);
    setRemoteDocuments(paths.registrations, registrations);

    const result = await syncPlayerUpdatesToClubState(state);

    expect(state).toEqual(stateSnapshot);
    expect(registrations).toEqual(rawSnapshot);
    expect(result.tournaments[0]).toMatchObject({
      id: tournament.id,
      preservedTournamentField: tournament.preservedTournamentField
    });
    expect(result.tournaments[0].players.map((player) => [player.id, player.status])).toEqual([
      ['registration-registered', 'Registered'],
      ['registration-checked-in', 'Checked In'],
      ['registration-eliminated', 'Eliminated'],
      ['registration-finished', 'Finished'],
      ['registration-rebought', 'Registered'],
      ['registration-add-on', 'Registered']
    ]);
    expect(result.tournaments[0].players[2]).toMatchObject({
      profileId: 'profile-eliminated',
      name: 'Eliminated Player',
      buyIn: 100,
      rebuys: 2,
      addOns: 1,
      startingStack: 20_000,
      registeredAt: '2026-08-05T12:02:00.000Z'
    });
    expect(result.tournaments[1]).toBe(state.tournaments[1]);
  });

  it('updates existing registrations by authoritative ID while preserving unrelated player fields and idempotency', async () => {
    const existingPlayer: ManagementTournamentPlayer = {
      id: 'registration-existing',
      registrationId: 'registration-existing',
      profileId: 'profile-existing-player',
      name: 'Existing Tournament Player',
      email: 'existing@example.test',
      buyIn: 100,
      rebuys: 0,
      addOns: 0,
      startingStack: 20_000,
      currentStack: 17_500,
      status: 'Registered',
      registeredAt: '2026-08-01T10:00:00.000Z',
      tableNumber: 2,
      seatNumber: 4
    };
    const registrationUpdate = {
      id: existingPlayer.registrationId,
      tournamentId: 'tournament-one',
      playerId: existingPlayer.profileId,
      playerName: existingPlayer.name,
      status: 'finished',
      rebuys: 3,
      addOns: 1,
      registeredAt: existingPlayer.registeredAt
    };
    const state = buildState({ tournaments: [buildTournament('tournament-one', [existingPlayer])] });
    const stateSnapshot = structuredClone(state);
    setRemoteDocuments(paths.registrations, [registrationUpdate]);

    const first = await syncPlayerUpdatesToClubState(state);
    const second = await syncPlayerUpdatesToClubState(first);

    expect(state).toEqual(stateSnapshot);
    expect(first.tournaments[0]).not.toBe(state.tournaments[0]);
    expect(first.tournaments[0].players[0]).toEqual({
      ...existingPlayer,
      rebuys: 3,
      addOns: 1,
      status: 'Finished'
    });
    expect(second).toEqual(first);
  });

  it('treats rebuy and add-on statuses as count updates without replacing the established tournament status', async () => {
    const rebuyPlayer: ManagementTournamentPlayer = {
      id: 'registration-rebuy-update',
      registrationId: 'registration-rebuy-update',
      profileId: 'profile-rebuy-update',
      name: 'Rebuy Update Player',
      buyIn: 100,
      rebuys: 0,
      addOns: 0,
      startingStack: 20_000,
      status: 'Checked In',
      registeredAt: '2026-08-01T10:00:00.000Z'
    };
    const addOnPlayer: ManagementTournamentPlayer = {
      id: 'registration-add-on-update',
      registrationId: 'registration-add-on-update',
      profileId: 'profile-add-on-update',
      name: 'Add-on Update Player',
      buyIn: 100,
      rebuys: 1,
      addOns: 0,
      startingStack: 20_000,
      status: 'Active',
      registeredAt: '2026-08-01T10:05:00.000Z'
    };
    const state = buildState({ tournaments: [buildTournament('tournament-one', [rebuyPlayer, addOnPlayer])] });
    setRemoteDocuments(paths.registrations, [
      {
        id: rebuyPlayer.registrationId,
        tournamentId: 'tournament-one',
        playerId: rebuyPlayer.profileId,
        playerName: rebuyPlayer.name,
        status: 'rebought',
        rebuys: 2,
        addOns: 0,
        registeredAt: rebuyPlayer.registeredAt
      },
      {
        id: addOnPlayer.registrationId,
        tournamentId: 'tournament-one',
        playerId: addOnPlayer.profileId,
        playerName: addOnPlayer.name,
        status: 'add-on-purchased',
        rebuys: 1,
        addOns: 1,
        registeredAt: addOnPlayer.registeredAt
      }
    ]);

    const result = await syncPlayerUpdatesToClubState(state);

    expect(result.tournaments[0].players).toEqual([
      { ...rebuyPlayer, rebuys: 2, status: 'Checked In' },
      { ...addOnPlayer, addOns: 1, status: 'Active' }
    ]);
  });
});

describe('Firebase club publication', () => {
  it('publishes protocol-v2 metadata, complete tournament projections, and canonical registration statuses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
    const state = buildState({
      profiles: [
        buildProfile('profile-member', 'Member Player', {
          membershipStatus: 'Active',
          membershipStartDate: '2026-08-01',
          membershipExpirationDate: '2026-09-01'
        })
      ],
      tournaments: [
        {
          ...buildTournament('tournament-published', [
            {
              id: 'player-checked',
              registrationId: 'registration-checked',
              profileId: 'profile-checked',
              name: 'Checked Player',
              buyIn: 100,
              rebuys: 1,
              addOns: 0,
              startingStack: 20_000,
              status: 'Checked In',
              registeredAt: '2026-08-07T18:00:00.000Z'
            },
            {
              id: 'player-finished',
              registrationId: 'registration-finished',
              profileId: 'profile-finished',
              name: 'Finished Player',
              buyIn: 100,
              rebuys: 2,
              addOns: 1,
              startingStack: 20_000,
              status: 'Finished',
              registeredAt: '2026-08-07T18:05:00.000Z'
            },
            {
              id: 'player-local-only',
              name: 'Local Only Player',
              buyIn: 100,
              rebuys: 0,
              addOns: 0,
              startingStack: 20_000,
              status: 'Registered',
              registeredAt: '2026-08-07T18:10:00.000Z'
            }
          ]),
          scheduledAt: '2026-08-08T18:00:00.000Z',
          registrationOpensAt: '2026-08-01T18:00:00.000Z',
          registrationClosesAt: '2026-08-08T18:30:00.000Z',
          registrationStatus: 'open',
          lateRegistrationThroughLevel: 4,
          rules: ['Published rule'],
          featured: true
        }
      ]
    });
    const stateSnapshot = structuredClone(state);

    const result = await saveClubStateToFirebase(state);

    expect(state).toEqual(stateSnapshot);
    expect(result).toMatchObject({
      accountKey: clubId,
      savedAt: '2026-08-07T22:00:00.000Z',
      synced: true,
      syncRevision: expect.stringContaining('2026-08-07T22:00:00.000Z:')
    });
    expect(firebaseHarness.batchCommits).toBe(1);
    const stateWrite = firebaseHarness.setDocCalls.find((call) => call.path === `clubStates/${clubId}`);
    expect(stateWrite).toMatchObject({
      options: { merge: true },
      data: {
        accountKey: clubId,
        savedAt: '2026-08-07T22:00:00.000Z',
        syncProtocolVersion: 2,
        syncRevision: result.syncRevision,
        syncSource: 'orbit-desktop',
        state: expect.objectContaining({
          preservedRootField: { enabled: true },
          tournaments: state.tournaments
        }),
        snapshot: expect.objectContaining({
          games: expect.any(Array),
          memberships: expect.any(Array),
          social: expect.any(Object)
        })
      }
    });
    const clubWrite = getSetOperation(`clubs/${clubId}`);
    expect(clubWrite.data).toMatchObject({
      savedAt: '2026-08-07T22:00:00.000Z',
      syncProtocolVersion: 2,
      syncRevision: result.syncRevision,
      syncSource: 'orbit-desktop',
      entityCounts: {
        games: 1,
        memberships: 1,
        waitlists: 0,
        notifications: 0,
        tournaments: 1
      }
    });
    expect(getSetOperation(`clubs/${clubId}/tournaments/tournament-published`).data).toMatchObject({
      id: 'tournament-published',
      name: 'Tournament tournament-published',
      startsAt: '2026-08-08T18:00:00.000Z',
      registrationStatus: 'open',
      buyIn: 100,
      entrantCount: 3,
      totalRebuys: 3,
      totalAddOns: 1,
      featured: true,
      syncProtocolVersion: 2,
      syncRevision: result.syncRevision
    });
    expect(getSetOperation(`clubs/${clubId}/tournamentRegistrations/registration-checked`).data).toMatchObject({
      status: 'checked-in',
      rebuys: 1,
      addOns: 0
    });
    expect(getSetOperation(`clubs/${clubId}/tournamentRegistrations/registration-finished`).data).toMatchObject({
      status: 'finished',
      rebuys: 2,
      addOns: 1
    });
    expect(firebaseHarness.batchOperations.some((operation) => operation.path.endsWith('/player-local-only'))).toBe(false);
    vi.useRealTimers();
  });
});
