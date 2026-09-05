import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipRequest,
  PlayerTournament,
  PlayerTournamentInterest,
  PlayerWaitlistRequest
} from '../domain/playerSync';

type FakeUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber: string | null;
  emailVerified: boolean;
  getIdToken: ReturnType<typeof vi.fn>;
};

type FakeReference = {
  kind: 'collection' | 'doc' | 'query';
  path: string;
  constraints?: unknown[];
};

type FakeDocument = {
  id: string;
  data: () => unknown;
  exists: () => boolean;
};

type FakeSnapshot = {
  docs: FakeDocument[];
};

type SnapshotListener = {
  reference: FakeReference;
  next: (snapshot: FakeSnapshot) => void;
  error?: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const firebase = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_ORBIT_API_URL = 'http://127.0.0.1:4629';
  return ({
  app: {},
  auth: { currentUser: null as FakeUser | null },
  collection: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  deleteField: vi.fn(),
  deleteDoc: vi.fn(),
  deleteUser: vi.fn(),
  doc: vi.fn(),
  fetch: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  initializeApp: vi.fn(),
  limit: vi.fn(),
  onAuthStateChanged: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  transactionSet: vi.fn(),
  transactionUpdate: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  where: vi.fn()
  });
});

vi.mock('firebase/app', () => ({
  getApps: () => [firebase.app],
  initializeApp: firebase.initializeApp
}));

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: { type: 'LOCAL' },
  createUserWithEmailAndPassword: firebase.createUserWithEmailAndPassword,
  deleteUser: firebase.deleteUser,
  getAuth: () => firebase.auth,
  initializeAuth: () => firebase.auth,
  onAuthStateChanged: firebase.onAuthStateChanged,
  sendEmailVerification: firebase.sendEmailVerification,
  sendPasswordResetEmail: firebase.sendPasswordResetEmail,
  signInWithCustomToken: firebase.signInWithCustomToken,
  signInWithEmailAndPassword: firebase.signInWithEmailAndPassword,
  signOut: firebase.signOut
}));

vi.mock('firebase/firestore', () => ({
  collection: firebase.collection,
  deleteField: firebase.deleteField,
  deleteDoc: firebase.deleteDoc,
  doc: firebase.doc,
  getDoc: firebase.getDoc,
  getDocs: firebase.getDocs,
  getFirestore: () => ({}),
  limit: firebase.limit,
  onSnapshot: firebase.onSnapshot,
  orderBy: firebase.orderBy,
  query: firebase.query,
  runTransaction: firebase.runTransaction,
  serverTimestamp: firebase.serverTimestamp,
  setDoc: firebase.setDoc,
  where: firebase.where
}));

import {
  completePlayerAdultDeclarationIfMissing,
  completePlayerPhoneSignIn,
  createPlayerProfileIfMissing,
  deleteCurrentPlayerAccount,
  fetchAllClubSnapshots,
  fetchClubSnapshots,
  getCurrentFirebasePlayer,
  fetchPlayerIdentityStatus,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  issueRemoteMembershipQr,
  normalizePublishedGames,
  onFirebasePlayerChanged,
  requestPlayerPasswordReset,
  startPlayerPhoneSignIn,
  expressTournamentInterest,
  savePlayerProfile,
  savePlayerIdentityCapture,
  signInOrCreatePlayerWithEmail,
  signOutCurrentPlayer,
  submitMembershipRequest,
  submitWaitlistRequest,
  subscribeToAllClubSnapshots,
  subscribeToPlayerTournaments,
  withdrawTournamentInterest
} from './orbitSyncApi';

const collectionDocs = new Map<string, FakeDocument[]>();
const documentDocs = new Map<string, FakeDocument>();
let snapshotListeners: SnapshotListener[] = [];

function referencePath(value: unknown) {
  return (value as FakeReference).path;
}

function fakeDocument(id: string, value: unknown, exists = true): FakeDocument {
  return {
    id,
    data: () => value,
    exists: () => exists
  };
}

function fakeSnapshot(entries: Array<[string, unknown]>): FakeSnapshot {
  return { docs: entries.map(([id, value]) => fakeDocument(id, value)) };
}

function setCollection(path: string, entries: Array<[string, unknown]>) {
  collectionDocs.set(path, fakeSnapshot(entries).docs);
}

function setDocument(path: string, id: string, value: unknown, exists = true) {
  documentDocs.set(path, fakeDocument(id, value, exists));
}

function listenersAt(path: string) {
  return snapshotListeners.filter((listener) => listener.reference.path === path);
}

function emitSnapshot(path: string, entries: Array<[string, unknown]>) {
  listenersAt(path).forEach((listener) => listener.next(fakeSnapshot(entries)));
}

function emitSnapshotError(path: string, message: string) {
  listenersAt(path).forEach((listener) => listener.error?.(new Error(message)));
}

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload)
  } as unknown as Response;
}

function rejectedJsonResponse(ok = true) {
  return {
    ok,
    json: vi.fn().mockRejectedValue(new Error('invalid json'))
  } as unknown as Response;
}

function signedInUser(uid = 'player-1', overrides: Partial<FakeUser> = {}) {
  const user: FakeUser = {
    uid,
    email: 'alex@example.com',
    displayName: 'Alex',
    photoURL: null,
    phoneNumber: null,
    emailVerified: true,
    getIdToken: vi.fn().mockResolvedValue('player-token'),
    ...overrides
  };
  firebase.auth.currentUser = user;
  return user;
}

function player(overrides: Partial<PlayerAccount> = {}): PlayerAccount {
  return {
    id: 'player-1',
    name: 'Alex Player',
    email: 'alex@example.com',
    phone: '5551112222',
    homeLocation: 'Austin, TX',
    searchRadiusMiles: 20,
    preferredGameIds: ['nlh'],
    favoriteClubIds: [],
    preferredStakes: '1/2',
    typicalAvailability: 'Evenings',
    adultDeclaredAt: '2026-08-09T11:00:00.000Z',
    adultDeclarationVersion: 'v1',
    ...overrides
  };
}

function tournament(overrides: Partial<PlayerTournament> = {}): PlayerTournament {
  return {
    id: 'event-1',
    clubId: 'club-1',
    name: 'Sunday Major',
    startsAt: '2026-08-10T18:00:00.000Z',
    interestOpensAt: '2026-08-01T00:00:00.000Z',
    interestClosesAt: '2026-08-10T17:00:00.000Z',
    interestStatus: 'open',
    buyIn: 100,
    prizePoolLabel: '$10,000',
    startingStack: 20_000,
    levelMinutes: 20,
    lateRegistrationThroughLevel: 6,
    rebuyPrice: 100,
    rebuyStack: 20_000,
    unlimitedRebuys: false,
    rebuysAllowed: true,
    addOnPrice: 50,
    addOnStack: 10_000,
    addOnsAllowed: true,
    rules: [],
    withdrawalAllowed: true,
    entrantCount: 0,
    totalRebuys: 0,
    totalAddOns: 0,
    ...overrides
  };
}

function tournamentInterest(overrides: Partial<PlayerTournamentInterest> = {}): PlayerTournamentInterest {
  return {
    id: 'opaque-interest-1',
    tournamentId: 'event-1',
    clubId: 'club-1',
    playerId: 'player-1',
    status: 'interested',
    createdAt: '2026-08-09T10:00:00.000Z',
    updatedAt: '2026-08-09T10:00:00.000Z',
    ...overrides
  };
}

function publishedClubSnapshot(overrides: Partial<PlayerClubSnapshot> = {}): PlayerClubSnapshot {
  return {
    club: { id: 'club-1', name: 'River Room', publishedAt: '2026-08-09T12:00:00.000Z' },
    games: [],
    memberships: [],
    waitlists: [],
    notifications: [],
    social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
    generatedAt: '2026-08-09T12:00:00.000Z',
    ...overrides
  };
}

function setPublishedClubGraph({
  parent = {},
  games = [],
  memberships = [],
  waitlists = [],
  notifications = []
}: {
  parent?: Record<string, unknown>;
  games?: Array<[string, unknown]>;
  memberships?: Array<[string, unknown]>;
  waitlists?: Array<[string, unknown]>;
  notifications?: Array<[string, unknown]>;
} = {}) {
  const club = {
    id: 'club-1',
    name: 'River Room',
    address: '1 River Road',
    publishedAt: '2026-08-09T12:00:00.000Z',
    syncProtocolVersion: 2,
    syncRevision: 'revision-2',
    entityCounts: { games: 1 },
    ...parent
  };
  setCollection('clubs', [['club-1', club], ['hidden', { id: 'hidden', name: 'Stress Club' }]]);
  setCollection('clubs/club-1/games', games.length ? games : [[
    'game-1',
    {
      id: 'game-1',
      name: '1/2 NLH',
      maxSeats: 10,
      openTables: [],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 10,
      knownPlayersCount: 0,
      syncRevision: 'revision-2',
      publishedAt: '2026-08-09T12:00:00.000Z'
    }
  ]]);
  setCollection('clubs/club-1/memberships', memberships);
  setCollection('clubs/club-1/waitlists', waitlists);
  setCollection('clubs/club-1/notifications', notifications);
  return club;
}

function membershipRequest(): PlayerMembershipRequest {
  return {
    id: 'join_opaque_membership_1',
    type: 'membership-request',
    clubId: 'club-1',
    player: player(),
    paymentMethod: 'in-person',
    priceLabel: '$30',
    planId: 'venue-annual',
    planName: 'Venue annual access',
    planPriceLabel: '$30',
    membershipDurationDays: 365,
    requestedAt: '2026-08-09T12:00:00.000Z'
  };
}

function waitlistRequest(): PlayerWaitlistRequest {
  return {
    id: 'wait-club-1-game-1-player-1',
    type: 'waitlist-request',
    clubId: 'club-1',
    player: player(),
    gameId: 'game-1',
    action: 'join',
    attendance: 'confirmed',
    requestedAt: '2026-08-09T12:00:00.000Z'
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  collectionDocs.clear();
  documentDocs.clear();
  snapshotListeners = [];
  firebase.auth.currentUser = null;
  firebase.collection.mockImplementation((_database: unknown, ...segments: string[]) => ({
    kind: 'collection',
    path: segments.join('/')
  } satisfies FakeReference));
  firebase.doc.mockImplementation((_database: unknown, ...segments: string[]) => ({
    kind: 'doc',
    path: segments.join('/')
  } satisfies FakeReference));
  firebase.where.mockImplementation((field: string, operator: string, value: unknown) => ({ field, operator, value }));
  firebase.limit.mockImplementation((count: number) => ({ type: 'limit', count }));
  firebase.orderBy.mockImplementation((field: string, direction: string) => ({ type: 'orderBy', field, direction }));
  firebase.query.mockImplementation((source: FakeReference, ...constraints: unknown[]) => ({
    kind: 'query',
    path: source.path,
    constraints
  } satisfies FakeReference));
  firebase.getDocs.mockImplementation(async (reference: unknown) => ({
    docs: collectionDocs.get(referencePath(reference)) ?? []
  }));
  firebase.getDoc.mockImplementation(async (reference: unknown) => (
    documentDocs.get(referencePath(reference)) ?? fakeDocument(referencePath(reference).split('/').at(-1) ?? '', undefined, false)
  ));
  firebase.onSnapshot.mockImplementation((reference: FakeReference, next: SnapshotListener['next'], error?: SnapshotListener['error']) => {
    const unsubscribe = vi.fn();
    snapshotListeners.push({ reference, next, error, unsubscribe });
    return unsubscribe;
  });
  firebase.serverTimestamp.mockReturnValue({ __serverTimestamp: true });
  firebase.deleteField.mockReturnValue({ __deleteField: true });
  firebase.setDoc.mockResolvedValue(undefined);
  firebase.deleteDoc.mockResolvedValue(undefined);
  firebase.deleteUser.mockResolvedValue(undefined);
  firebase.sendEmailVerification.mockResolvedValue(undefined);
  firebase.sendPasswordResetEmail.mockResolvedValue(undefined);
  firebase.signOut.mockResolvedValue(undefined);
  firebase.runTransaction.mockImplementation(async (_database: unknown, operation: (transaction: {
    get: (reference: unknown) => Promise<FakeDocument>;
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }) => Promise<unknown>) => operation({
    get: async (reference) => documentDocs.get(referencePath(reference)) ?? fakeDocument('', undefined, false),
    set: firebase.transactionSet,
    update: firebase.transactionUpdate
  }));
  firebase.fetch.mockReset();
  vi.stubGlobal('fetch', firebase.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('authenticated Orbit API boundaries', () => {
  it('requires a signed-in account without contacting fetch', async () => {
    await expect(fetchPlayerIdentityStatus()).rejects.toThrow('Sign in to your Orbit Player account first.');
    await expect(savePlayerIdentityCapture({
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'identity:attempt-1'
    }, 'player-1')).rejects.toThrow('Sign in to your Orbit Player account first.');
    await expect(issueRemoteMembershipQr('club-1', 'qr-mutation-1', 'player-1')).rejects.toThrow('Sign in to your Orbit Player account first.');
    expect(firebase.fetch).not.toHaveBeenCalled();
  });

  it('sends the bearer token, preserves the identity payload, and refreshes verified claims', async () => {
    const user = signedInUser();
    const identity = {
      status: 'verified' as const,
      ageVerified: true,
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 21,
      verifiedAt: '2026-08-09T11:00:00.000Z',
      capturedAt: '2026-08-09T10:00:00.000Z',
      failureCode: null,
      reviewStatus: 'approved' as const
    };
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, identity }));

    await expect(fetchPlayerIdentityStatus(true)).resolves.toEqual(identity);

    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/identity/status',
      expect.objectContaining({ headers: { authorization: 'Bearer player-token' }, signal: expect.any(AbortSignal) })
    );
    expect(user.getIdToken).toHaveBeenNthCalledWith(1, true);
    expect(user.getIdToken).toHaveBeenNthCalledWith(2, true);
  });

  it('keeps current missing, malformed-JSON, and server-error messages', async () => {
    signedInUser();
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(rejectedJsonResponse())
      .mockResolvedValueOnce(jsonResponse({ error: 'Identity provider unavailable.' }, false));

    await expect(fetchPlayerIdentityStatus()).rejects.toThrow('Unable to check age-verification status.');
    await expect(fetchPlayerIdentityStatus()).rejects.toThrow('Unable to check age-verification status.');
    await expect(fetchPlayerIdentityStatus()).rejects.toThrow('Identity provider unavailable.');
  });

  it('issues only an online opaque membership QR with an explicit mutation ID', async () => {
    signedInUser();
    const qr = {
      ok: true as const,
      token: 'opaque-qr-token',
      issuedAt: '2026-08-09T12:00:00.000Z',
      expiresAt: '2026-08-09T12:05:00.000Z'
    };
    firebase.fetch.mockResolvedValueOnce(jsonResponse(qr));

    await expect(issueRemoteMembershipQr('club-1', 'qr-mutation-1', 'player-1')).resolves.toEqual(qr);
    expect(firebase.fetch).toHaveBeenCalledWith('http://127.0.0.1:4629/player/membership-qr', expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer player-token', 'content-type': 'application/json' },
      body: JSON.stringify({ clubId: 'club-1', mutationId: 'qr-mutation-1' })
    }));
  });

  it('sends only confirmed identity fields with bearer auth and decodes the provisional response', async () => {
    signedInUser();
    const identity = {
      status: 'provisional' as const,
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 18,
      verifiedAt: null,
      capturedAt: '2026-08-28T12:00:00.000Z',
      failureCode: null,
      reviewStatus: 'pending-in-person' as const,
      verifiedDetails: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St'
      }
    };
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, identity }));
    const confirmedInput = {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'identity:attempt-1',
      rawBarcode: 'RAW-PDF417-SECRET',
      idNumber: 'ID-NUMBER-SECRET',
      photo: 'PHOTO-SECRET',
      selfie: 'SELFIE-SECRET'
    };

    await expect(savePlayerIdentityCapture(confirmedInput, 'player-1')).resolves.toEqual(identity);

    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/identity/capture',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer player-token',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          fullName: 'Jordan Rivera',
          dateOfBirth: '1990-01-02',
          address: '100 Main St',
          mutationId: 'identity:attempt-1'
        })
      })
    );
    const requestBody = JSON.parse(firebase.fetch.mock.calls[0][1].body as string) as Record<string, unknown>;
    expect(Object.keys(requestBody).sort()).toEqual(['address', 'dateOfBirth', 'fullName', 'mutationId']);
    expect(JSON.stringify(requestBody)).not.toMatch(/RAW-PDF417-SECRET|ID-NUMBER-SECRET|PHOTO-SECRET|SELFIE-SECRET/);
  });

  it('never sends an identity capture, membership QR, or account deletion after the signed-in account changes', async () => {
    const identityUser = signedInUser();
    identityUser.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });
    await expect(savePlayerIdentityCapture({
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'identity:attempt-race'
    }, 'player-1')).rejects.toThrow('account changed before the request was sent');
    expect(firebase.fetch).not.toHaveBeenCalled();

    const qrUser = signedInUser();
    qrUser.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });
    await expect(issueRemoteMembershipQr('club-1', 'qr-mutation-race', 'player-1'))
      .rejects.toThrow('account changed before the request was sent');
    expect(firebase.fetch).not.toHaveBeenCalled();

    const deletingUser = signedInUser();
    deletingUser.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });
    await expect(deleteCurrentPlayerAccount()).rejects.toThrow('account changed before deletion');
    expect(firebase.fetch).not.toHaveBeenCalled();
    expect(firebase.signOut).not.toHaveBeenCalled();
  });

  it('rejects stale identity, request, tournament, and QR responses after the account changes', async () => {
    const identity = {
      status: 'provisional' as const,
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 18,
      verifiedAt: null,
      capturedAt: '2026-08-28T12:00:00.000Z',
      failureCode: null,
      reviewStatus: 'pending-in-person' as const
    };
    const snapshot = publishedClubSnapshot();
    const futureTournament = tournament({
      startsAt: '2099-08-10T18:00:00.000Z',
      interestOpensAt: '2020-08-01T00:00:00.000Z',
      interestClosesAt: '2099-08-10T17:00:00.000Z'
    });
    const futureInterest = tournamentInterest();
    const cases: Array<{
      name: string;
      payload: unknown;
      run(): Promise<unknown>;
      syncFailure?: boolean;
    }> = [
      {
        name: 'identity refresh',
        payload: { ok: true, identity },
        run: () => fetchPlayerIdentityStatus(false, 'player-1')
      },
      {
        name: 'identity capture',
        payload: { ok: true, identity },
        run: () => savePlayerIdentityCapture({
          fullName: 'Jordan Rivera',
          dateOfBirth: '1990-01-02',
          address: '100 Main St',
          mutationId: 'identity-race'
        }, 'player-1')
      },
      {
        name: 'membership request',
        payload: { ok: true, accountKey: 'club-1', snapshot },
        run: () => submitMembershipRequest(membershipRequest()),
        syncFailure: true
      },
      {
        name: 'waitlist request',
        payload: { ok: true, accountKey: 'club-1', snapshot },
        run: () => submitWaitlistRequest(waitlistRequest()),
        syncFailure: true
      },
      {
        name: 'tournament interest',
        payload: { ok: true, interest: futureInterest },
        run: () => expressTournamentInterest(futureTournament, player(), 'tournament-race')
      },
      {
        name: 'tournament withdrawal',
        payload: { ok: true, interest: { ...futureInterest, status: 'withdrawn' } },
        run: () => withdrawTournamentInterest(futureTournament, futureInterest, 'withdraw-race')
      },
      {
        name: 'membership QR',
        payload: {
          ok: true,
          token: 'stale-qr',
          issuedAt: '2026-08-09T12:00:00.000Z',
          expiresAt: '2099-08-09T12:05:00.000Z'
        },
        run: () => issueRemoteMembershipQr('club-1', 'qr-race', 'player-1')
      }
    ];

    for (const testCase of cases) {
      firebase.fetch.mockReset();
      signedInUser('player-1');
      const response = deferred<Response>();
      firebase.fetch.mockReturnValueOnce(response.promise);
      const pending = testCase.run();
      await vi.waitFor(() => expect(firebase.fetch, testCase.name).toHaveBeenCalledOnce());
      signedInUser('player-2');
      response.resolve(jsonResponse(testCase.payload));
      if (testCase.syncFailure) {
        await expect(pending, testCase.name).resolves.toEqual({
          ok: false,
          error: 'The signed-in Orbit Player account changed before the response was applied.'
        });
      } else {
        await expect(pending, testCase.name).rejects.toThrow('account changed before the response was applied');
      }
    }
  });

  it('delegates deletion to the trusted API and never claims completion while server finalization is pending', async () => {
    const user = signedInUser();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: false, code: 'RECENT_LOGIN_REQUIRED', error: 'Recent login required.' }, false));

    await expect(deleteCurrentPlayerAccount()).rejects.toMatchObject({ message: 'Recent login required.', code: 'RECENT_LOGIN_REQUIRED' });
    expect(firebase.deleteDoc).not.toHaveBeenCalled();
    expect(firebase.deleteUser).not.toHaveBeenCalled();
    expect(firebase.signOut).not.toHaveBeenCalled();

    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      status: 'pending',
      jobFinalization: 'scheduled'
    }));
    firebase.signOut.mockImplementationOnce(async () => { firebase.auth.currentUser = null; });
    await expect(deleteCurrentPlayerAccount()).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: [],
      currentAccountPreserved: false,
      signedOut: true
    });
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);

    signedInUser();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'complete', jobFinalization: 'pending', retainedCategories: ['audit-records:anonymize'] }));
    firebase.signOut.mockImplementationOnce(async () => { firebase.auth.currentUser = null; });
    await expect(deleteCurrentPlayerAccount()).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: ['audit-records:anonymize'],
      currentAccountPreserved: false,
      signedOut: true
    });
    expect(firebase.fetch).toHaveBeenLastCalledWith('http://127.0.0.1:4629/player/account', expect.objectContaining({
      method: 'DELETE',
      headers: { authorization: 'Bearer player-token' }
    }));
    expect(user.getIdToken).toHaveBeenLastCalledWith(true);
    expect(firebase.deleteDoc).not.toHaveBeenCalled();
    expect(firebase.deleteUser).not.toHaveBeenCalled();
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });

  it('does not claim sign-out when Firebase resolves but the initiating UID remains current', async () => {
    signedInUser('player-1');
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'pending', retainedCategories: [] }));

    await expect(deleteCurrentPlayerAccount('player-1')).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: [],
      currentAccountPreserved: false,
      signedOut: false
    });
    expect(firebase.auth.currentUser?.uid).toBe('player-1');
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });

  it('accepts deletion for the initiating UID without signing out a newer account', async () => {
    signedInUser('player-1');
    const response = deferred<Response>();
    firebase.fetch.mockReturnValueOnce(response.promise);
    const deletion = deleteCurrentPlayerAccount('player-1');
    await vi.waitFor(() => expect(firebase.fetch).toHaveBeenCalledOnce());

    signedInUser('player-2');
    response.resolve(jsonResponse({ ok: true, status: 'pending', retainedCategories: [] }));

    await expect(deletion).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: [],
      currentAccountPreserved: true,
      signedOut: false
    });
    expect(firebase.auth.currentUser?.uid).toBe('player-2');
    expect(firebase.signOut).not.toHaveBeenCalled();
  });

  it('reports incomplete local sign-out after the server accepts deletion so durable cleanup can take over', async () => {
    signedInUser('player-1');
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'pending', retainedCategories: [] }));
    firebase.signOut.mockRejectedValueOnce(new Error('auth persistence unavailable'));

    await expect(deleteCurrentPlayerAccount('player-1')).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: [],
      currentAccountPreserved: false,
      signedOut: false
    });
    expect(firebase.auth.currentUser?.uid).toBe('player-1');
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });
});

describe('Firebase authentication boundary', () => {
  it('maps current and changed users without inventing missing identity fields and returns the SDK unsubscriber', () => {
    const user = signedInUser();
    user.displayName = null;
    user.photoURL = 'https://example.com/avatar.png';
    expect(getCurrentFirebasePlayer()).toEqual({
      uid: 'player-1',
      email: 'alex@example.com',
      name: '',
      photoUrl: 'https://example.com/avatar.png',
      provider: 'email',
      verified: true
    });

    const unsubscribe = vi.fn();
    firebase.onAuthStateChanged.mockImplementation((_auth: unknown, callback: (nextUser: FakeUser | null) => void) => {
      callback(user);
      callback(null);
      return unsubscribe;
    });
    const callback = vi.fn();
    expect(onFirebasePlayerChanged(callback)).toBe(unsubscribe);
    expect(callback).toHaveBeenNthCalledWith(1, {
      uid: 'player-1',
      email: 'alex@example.com',
      name: '',
      photoUrl: 'https://example.com/avatar.png',
      provider: 'email',
      verified: true
    });
    expect(callback).toHaveBeenNthCalledWith(2, null);
  });

  it('normalizes email sign-in, falls back to account creation, and preserves the original sign-in error for an existing email', async () => {
    const signInUser = signedInUser('signed-in');
    firebase.signInWithEmailAndPassword.mockResolvedValueOnce({ user: signInUser });
    await expect(signInOrCreatePlayerWithEmail('  ALEX@Example.COM ', 'a-secure-passphrase')).resolves.toMatchObject({ uid: 'signed-in' });
    expect(firebase.signInWithEmailAndPassword).toHaveBeenCalledWith(firebase.auth, 'alex@example.com', 'a-secure-passphrase');

    const signInFailure = Object.assign(new Error('wrong password'), { code: 'auth/wrong-password' });
    const createdUser = { ...signInUser, uid: 'created', emailVerified: false };
    firebase.signInWithEmailAndPassword.mockRejectedValueOnce(signInFailure);
    firebase.createUserWithEmailAndPassword.mockResolvedValueOnce({ user: createdUser });
    await expect(signInOrCreatePlayerWithEmail('new@example.com', 'another-secure-passphrase')).rejects.toThrow(
      'Check your email to verify the account before signing in.'
    );
    expect(firebase.sendEmailVerification).toHaveBeenCalledWith(createdUser);

    firebase.signInWithEmailAndPassword.mockRejectedValueOnce(signInFailure);
    firebase.createUserWithEmailAndPassword.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'auth/email-already-in-use' }));
    await expect(signInOrCreatePlayerWithEmail('alex@example.com', 'third-secure-passphrase')).rejects.toBe(signInFailure);
  });

  it('requires verified email or an SMS OTP and offers generic email recovery', async () => {
    await expect(signInOrCreatePlayerWithEmail('', 'a-secure-passphrase')).rejects.toThrow('Enter your email and password.');
    await expect(signInOrCreatePlayerWithEmail('alex@example.com', 'short')).rejects.toThrow('at least 12 characters');
    expect(() => startPlayerPhoneSignIn('555 555 0123')).toThrow('Start with + and the country code.');

    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, challenge: 'signed-challenge', expiresAt: '2026-08-09T12:10:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, challenge: 'international-challenge', expiresAt: '2026-08-09T12:10:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, firebaseToken: 'custom-token' }));
    await expect(startPlayerPhoneSignIn('+1 555 555 0123')).resolves.toMatchObject({ challenge: 'signed-challenge' });
    expect(JSON.parse(String(firebase.fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ phone: '+15555550123' });
    await expect(startPlayerPhoneSignIn('+44 20 7946 0958')).resolves.toMatchObject({ challenge: 'international-challenge' });
    expect(JSON.parse(String(firebase.fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ phone: '+442079460958' });

    const phoneUser = { ...signedInUser(), email: null, emailVerified: false, phoneNumber: '+15551112222' };
    firebase.signInWithCustomToken.mockResolvedValueOnce({ user: phoneUser });
    await expect(completePlayerPhoneSignIn('+1 (555) 111-2222', '123456', 'signed-challenge')).resolves.toMatchObject({
      uid: 'player-1',
      phone: '+15551112222',
      provider: 'phone',
      verified: true
    });
    expect(JSON.parse(String(firebase.fetch.mock.calls[2]?.[1]?.body))).toMatchObject({ phone: '+15551112222' });
    expect(firebase.signInWithCustomToken).toHaveBeenCalledWith(firebase.auth, 'custom-token');

    await expect(requestPlayerPasswordReset('alex@example.com')).resolves.toContain('If that email belongs');
    expect(firebase.sendPasswordResetEmail).toHaveBeenCalledWith(firebase.auth, 'alex@example.com');

    await signOutCurrentPlayer();
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });
});

describe('Firestore profile boundaries', () => {
  it('writes only player-owned profile fields and never rewrites the server-authored membership map', async () => {
    signedInUser();
    setDocument('players/player-1', 'player-1', {
      clubMemberships: {
        existing: { clubId: 'existing', status: 'Active' }
      }
    });
    const result = await savePlayerProfile({
      ...player({
        id: 'player-1',
        phone: undefined,
        homeLocation: ' ',
        searchRadiusMiles: undefined,
        preferredStakes: '',
        typicalAvailability: undefined
      }),
      injected: 'discard',
      clubMemberships: { asserted: { clubId: 'asserted', status: 'Active' } }
    } as PlayerAccount, 'player-1');

    expect(result.id).toBe('player-1');
    expect(result.uid).toBe('player-1');
    expect(result).not.toHaveProperty('clubMemberships');
    expect(result).not.toHaveProperty('phone');
    expect(result).not.toHaveProperty('homeLocation');
    expect(result).not.toHaveProperty('searchRadiusMiles');
    expect(result).not.toHaveProperty('preferredStakes');
    expect(result).not.toHaveProperty('typicalAvailability');
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/player-1' }),
      expect.objectContaining({
        id: 'player-1',
        uid: 'player-1',
        adultDeclaredAt: '2026-08-09T11:00:00.000Z',
        adultDeclarationVersion: 'v1',
        updatedAt: { __serverTimestamp: true }
      }),
      { merge: true }
    );
    const writtenProfile = firebase.setDoc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(writtenProfile).not.toHaveProperty('clubMemberships');
    expect(writtenProfile).not.toHaveProperty('injected');
    expect(writtenProfile.phone).toEqual({ __deleteField: true });
    expect(writtenProfile.homeLocation).toEqual({ __deleteField: true });
    expect(writtenProfile.searchRadiusMiles).toEqual({ __deleteField: true });
    expect(writtenProfile.preferredStakes).toEqual({ __deleteField: true });
    expect(writtenProfile.typicalAvailability).toEqual({ __deleteField: true });
    expect(Object.values(writtenProfile)).not.toContain(undefined);

    firebase.setDoc.mockClear();
    await expect(savePlayerProfile(player({ adultDeclaredAt: undefined, adultDeclarationVersion: undefined }), 'player-1'))
      .rejects.toThrow('18 or older');
    expect(firebase.setDoc).not.toHaveBeenCalled();
  });

  it('clears a durable unverified session when verification email delivery fails', async () => {
    const signInFailure = Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    const createdUser = { ...signedInUser(), uid: 'unverified-created', emailVerified: false };
    firebase.signInWithEmailAndPassword.mockRejectedValueOnce(signInFailure);
    firebase.createUserWithEmailAndPassword.mockResolvedValueOnce({ user: createdUser });
    firebase.sendEmailVerification.mockRejectedValueOnce(new Error('verification service unavailable'));

    await expect(signInOrCreatePlayerWithEmail('new@example.test', 'a-secure-passphrase'))
      .rejects.toThrow('verification service unavailable');
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });

  it('fails closed when the local profile or current Firebase account changes before a write', async () => {
    signedInUser('player-1');
    await expect(savePlayerProfile(player({ id: 'player-2' }), 'player-1'))
      .rejects.toThrow('local player profile does not match');
    expect(firebase.setDoc).not.toHaveBeenCalled();

    firebase.doc.mockImplementationOnce((_database: unknown, ...segments: string[]) => {
      signedInUser('player-2', { email: 'other@example.test' });
      return { kind: 'doc', path: segments.join('/') } satisfies FakeReference;
    });
    await expect(savePlayerProfile(player(), 'player-1'))
      .rejects.toThrow('account changed before syncing');
    expect(firebase.setDoc).not.toHaveBeenCalled();

    signedInUser('player-1');
    firebase.runTransaction.mockImplementationOnce(async (_database: unknown, operation: (transaction: {
      get: (reference: unknown) => Promise<FakeDocument>;
      set: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      signedInUser('player-2', { email: 'other@example.test' });
      return operation({
        get: async (reference) => documentDocs.get(referencePath(reference)) ?? fakeDocument('', undefined, false),
        set: firebase.transactionSet,
        update: firebase.transactionUpdate
      });
    });
    await expect(createPlayerProfileIfMissing(player(), 'player-1'))
      .rejects.toThrow('account changed before syncing');
    expect(firebase.transactionSet).not.toHaveBeenCalled();
  });

  it('binds profile contact fields to the verified Firebase provider', async () => {
    signedInUser('phone-player', {
      email: null,
      emailVerified: false,
      phoneNumber: '+15551112222'
    });
    const result = await savePlayerProfile(player({
      id: 'phone-player',
      email: 'unverified-local@example.test',
      phone: '5559990000'
    }), 'phone-player');

    expect(result).toMatchObject({
      id: 'phone-player',
      uid: 'phone-player',
      email: '',
      phone: '+15551112222'
    });
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/phone-player' }),
      expect.objectContaining({ email: '', phone: '+15551112222' }),
      { merge: true }
    );
  });

  it('prefers a verified email claim when the Firebase account also has a linked phone', async () => {
    signedInUser('linked-player', { phoneNumber: '+15551112222' });
    expect(getCurrentFirebasePlayer()).toMatchObject({
      uid: 'linked-player',
      email: 'alex@example.com',
      phone: '+15551112222',
      provider: 'email'
    });

    await savePlayerProfile(player({ id: 'linked-player', email: 'unverified-local@example.test' }), 'linked-player');
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/linked-player' }),
      expect.objectContaining({ email: 'alex@example.com', phone: '+15551112222' }),
      { merge: true }
    );
  });

  it('returns a valid profile, fails closed for an existing malformed profile, and returns null only when missing', async () => {
    signedInUser();
    const validProfile = { ...player(), uid: 'player-1', clubMemberships: {} };
    setDocument('players/player-1', 'player-1', validProfile);
    await expect(fetchPlayerProfile('player-1')).resolves.toEqual(validProfile);

    const malformedProfile = { uid: 42, preferredGameIds: 'not-an-array' };
    setDocument('players/player-1', 'player-1', malformedProfile);
    await expect(fetchPlayerProfile('player-1')).rejects.toThrow('invalid and was not changed');

    setDocument('players/player-1', 'player-1', undefined, false);
    await expect(fetchPlayerProfile('player-1')).resolves.toBeNull();

    firebase.getDoc.mockRejectedValueOnce(new Error('profile read failed'));
    await expect(fetchPlayerProfile('player-1')).rejects.toThrow('profile read failed');
  });

  it('atomically creates only a missing profile and preserves one that appears concurrently', async () => {
    signedInUser();
    const concurrentProfile = { ...player({ name: 'Concurrent Profile' }), uid: 'player-1' };
    setDocument('players/player-1', 'player-1', concurrentProfile);

    await expect(createPlayerProfileIfMissing(player({ name: 'Local Profile' }), 'player-1')).resolves.toEqual({
      created: false,
      profile: concurrentProfile
    });
    expect(firebase.transactionSet).not.toHaveBeenCalled();

    setDocument('players/player-1', 'player-1', undefined, false);
    await expect(createPlayerProfileIfMissing(player({ name: 'New Profile' }), 'player-1')).resolves.toMatchObject({
      created: true,
      profile: { id: 'player-1', uid: 'player-1', name: 'New Profile' }
    });
    expect(firebase.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/player-1' }),
      expect.objectContaining({ id: 'player-1', uid: 'player-1', name: 'New Profile', updatedAt: { __serverTimestamp: true } })
    );
  });

  it('does not overwrite an existing malformed profile during atomic creation', async () => {
    signedInUser();
    setDocument('players/player-1', 'player-1', { uid: 42, preferredGameIds: 'not-an-array' });
    await expect(createPlayerProfileIfMissing(player({ name: 'Local Profile' }), 'player-1'))
      .rejects.toThrow('invalid and was not changed');
    expect(firebase.transactionSet).not.toHaveBeenCalled();
  });

  it('atomically adds only a missing adult declaration to a valid legacy profile', async () => {
    signedInUser();
    const legacyProfile = {
      id: 'player-1',
      uid: 'player-1',
      name: 'Remote Legacy Name',
      email: 'alex@example.com',
      preferredGameIds: ['omaha']
    };
    setDocument('players/player-1', 'player-1', legacyProfile);

    await expect(completePlayerAdultDeclarationIfMissing(player(), 'player-1')).resolves.toMatchObject({
      ...legacyProfile,
      adultDeclaredAt: '2026-08-09T11:00:00.000Z',
      adultDeclarationVersion: 'v1'
    });
    expect(firebase.transactionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/player-1' }),
      {
        adultDeclaredAt: '2026-08-09T11:00:00.000Z',
        adultDeclarationVersion: 'v1',
        updatedAt: { __serverTimestamp: true }
      }
    );
    expect(firebase.transactionSet).not.toHaveBeenCalled();

    firebase.transactionUpdate.mockClear();
    await expect(completePlayerAdultDeclarationIfMissing(player({ id: 'different-local-player' }), 'player-1'))
      .rejects.toThrow('same Orbit Player account');
    expect(firebase.transactionUpdate).not.toHaveBeenCalled();
  });

  it('does not repair malformed or wrong-identity existing declarations', async () => {
    signedInUser();
    setDocument('players/player-1', 'player-1', {
      id: 'player-1', uid: 'player-1', name: 'Malformed', email: 'alex@example.com', preferredGameIds: [],
      adultDeclaredAt: 'not-a-date', adultDeclarationVersion: 'v1'
    });
    await expect(completePlayerAdultDeclarationIfMissing(player(), 'player-1')).rejects.toThrow('adult declaration is invalid');
    expect(firebase.transactionUpdate).not.toHaveBeenCalled();

    setDocument('players/player-1', 'player-1', {
      id: 'other', uid: 'other', name: 'Wrong account', email: 'alex@example.com', preferredGameIds: []
    });
    await expect(completePlayerAdultDeclarationIfMissing(player(), 'player-1')).rejects.toThrow('profile is invalid');
    expect(firebase.transactionUpdate).not.toHaveBeenCalled();
  });

});

describe('published game normalization boundary', () => {
  it('filters malformed numeric fields without mutating the external record', () => {
    const external = {
      id: '',
      name: '  1/2 NLH  ',
      maxSeats: 'invalid',
      collectionMode: 'unknown',
      openTables: [{ availableSeats: '3', collectionMode: 'Time' }],
      waitlistCount: '2',
      formingCount: null,
      availableSeats: 'invalid',
      knownPlayersCount: undefined,
      syncRevision: 'revision-1'
    };
    const before = structuredClone(external);

    expect(normalizePublishedGames([fakeDocument('game-doc', external) as never])).toEqual([]);
    expect(external).toEqual(before);
  });

  it('keeps complete v2 aggregate order and filters partial legacy sessions', () => {
    const complete = (id: string, name: string) => ({
      id,
      name,
      maxSeats: 10,
      openTables: [],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 0,
      knownPlayersCount: 0,
      syncRevision: 'revision-2'
    });
    const result = normalizePublishedGames([
      fakeDocument('game-b', complete('b', 'Game B')) as never,
      fakeDocument('session', { id: 'session', gameId: 'a', gameName: 'Game A', status: 'Running', updatedAt: new Date().toISOString() }) as never,
      fakeDocument('game-a', complete('a', 'Game A')) as never
    ]);

    expect(result.map((game) => game.id)).toEqual(['b', 'a']);
    expect(normalizePublishedGames([])).toEqual([]);
  });

  it('filters a null Firestore game record', () => {
    expect(normalizePublishedGames([fakeDocument('bad-game', null) as never])).toEqual([]);
  });
});

describe('request HTTP boundaries', () => {
  it('uses the authenticated remote membership endpoint first and returns its snapshot unchanged', async () => {
    signedInUser();
    const request = membershipRequest();
    const snapshot = publishedClubSnapshot();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: 'club-1', savedAt: snapshot.generatedAt, snapshot }));

    await expect(submitMembershipRequest(request)).resolves.toEqual({ ok: true, accountKey: 'club-1', savedAt: snapshot.generatedAt, snapshot });

    expect(firebase.fetch).toHaveBeenCalledWith('http://127.0.0.1:4629/player/membership-requests', expect.objectContaining({
      method: 'POST',
      headers: {
        authorization: 'Bearer player-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ...request, player: { ...request.player, id: 'player-1' } })
    }));
    expect(firebase.setDoc).not.toHaveBeenCalled();
  });

  it('fails closed on malformed authoritative waitlist responses without direct Firestore writes', async () => {
    signedInUser();
    const request = waitlistRequest();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(submitWaitlistRequest(request)).resolves.toEqual({
      ok: false,
      error: 'Orbit API request failed.'
    });
    expect(firebase.setDoc).not.toHaveBeenCalled();
  });

  it('never rewrites or sends a stale membership or waitlist request for a different signed-in account', async () => {
    signedInUser('player-2');

    await expect(submitMembershipRequest(membershipRequest())).resolves.toEqual({
      ok: false,
      error: 'The signed-in Orbit Player account does not match this request.'
    });
    await expect(submitWaitlistRequest(waitlistRequest())).resolves.toEqual({
      ok: false,
      error: 'The signed-in Orbit Player account does not match this request.'
    });
    expect(firebase.fetch).not.toHaveBeenCalled();
  });

  it('never sends a bound membership or waitlist request when auth changes while obtaining its token', async () => {
    const membershipUser = signedInUser();
    membershipUser.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });
    await expect(submitMembershipRequest(membershipRequest())).resolves.toEqual({
      ok: false,
      error: 'The signed-in Orbit Player account changed before the request was sent.'
    });
    expect(firebase.fetch).not.toHaveBeenCalled();

    const waitlistUser = signedInUser();
    waitlistUser.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });
    await expect(submitWaitlistRequest(waitlistRequest())).resolves.toEqual({
      ok: false,
      error: 'The signed-in Orbit Player account changed before the request was sent.'
    });
    expect(firebase.fetch).not.toHaveBeenCalled();
  });
});

describe('published and legacy club snapshot boundaries', () => {
  it('uses a configured local bridge only through the explicit development fallback path', async () => {
    signedInUser();
    vi.stubEnv('EXPO_PUBLIC_ORBIT_LOCAL_API_URL', 'http://127.0.0.1:4629');
    vi.resetModules();
    const localAdapter = await import('./orbitSyncApi');
    const localSnapshot = publishedClubSnapshot({
      club: { id: 'local-club', name: 'Local Room' },
      generatedAt: '2026-08-09T14:00:00.000Z'
    });
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, snapshot: localSnapshot, accountKey: 'local-club' }));
    setCollection('clubs', []);
    setCollection('clubStates', []);

    await expect(localAdapter.fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: true, clubs: [localSnapshot] });
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/snapshot',
      expect.objectContaining({ headers: { authorization: 'Bearer player-token' }, signal: expect.any(AbortSignal) })
    );

    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('hydrates a committed v2 club, filters hidden and other-player records, and preserves external documents', async () => {
    signedInUser();
    const membership = {
      id: 'membership-player-1',
      clubId: 'club-1',
      playerId: 'player-1',
      playerName: 'Alex Player',
      status: 'Active',
      joinedAt: '2026-08-01',
      loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New', nextTierAtHours: 12 },
      preferredGameIds: [],
      syncRevision: 'revision-2',
      publishedAt: '2026-08-09T12:00:00.000Z'
    };
    const otherMembership = { ...membership, id: 'membership-other', playerId: 'other', playerName: 'Other Player' };
    const waitlist = {
      id: 'wait-player-1',
      clubId: 'club-1',
      gameId: 'game-1',
      playerId: 'player-1',
      playerName: 'Alex Player',
      status: 'Interested',
      position: 1,
      requestedAt: '2026-08-09T11:00:00.000Z',
      syncRevision: 'revision-2',
      publishedAt: '2026-08-09T12:00:00.000Z'
    };
    const notification = {
      id: 'notice-player-1',
      clubId: 'club-1',
      gameId: 'game-1',
      title: 'Seat open',
      body: 'A seat opened.',
      reason: 'seat-opened',
      createdAt: '2026-08-09T12:00:00.000Z',
      targetPlayerIds: ['player-1'],
      targetPlayerNames: [],
      syncRevision: 'revision-2',
      publishedAt: '2026-08-09T12:00:00.000Z'
    };
    setPublishedClubGraph({
      parent: { entityCounts: { games: 2 } },
      games: [
        ['game-1', { id: 'game-1', name: '1/2 NLH', maxSeats: 10, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 0, knownPlayersCount: 0, syncRevision: 'revision-2' }],
        ['stress-game', { id: 'stress-game', name: 'Stress Game', maxSeats: 10, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 0, knownPlayersCount: 0, syncRevision: 'revision-2' }]
      ],
      memberships: [['membership-player-1', membership], ['membership-other', otherMembership]],
      waitlists: [['wait-player-1', waitlist], ['wait-other', { ...waitlist, id: 'wait-other', playerId: 'other', playerName: 'Other Player' }]],
      notifications: [['notice-player-1', notification], ['notice-other', { ...notification, id: 'notice-other', targetPlayerIds: ['other'] }]]
    });
    const before = structuredClone(membership);
    firebase.fetch
      .mockRejectedValueOnce(new Error('authenticated discovery offline'))
      .mockRejectedValueOnce(new Error('public discovery offline'));

    const result = await fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0]).toMatchObject({
      club: { id: 'club-1', name: 'River Room', syncRevision: 'revision-2' },
      games: [{ id: 'game-1', name: '1/2 NLH' }],
      memberships: [{ id: 'membership-player-1' }],
      waitlists: [{ id: 'wait-player-1' }],
      notifications: [{ id: 'notice-player-1' }]
    });
    expect(membership).toEqual(before);
    expect(firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference))).not.toContain('clubs/hidden/games');
  });

  it('strictly drops malformed direct-fallback clubs and child records while preserving a valid minimum age', async () => {
    signedInUser();
    const parent = setPublishedClubGraph({
      parent: { minimumAge: 18, entityCounts: { games: 1 } },
      games: [
        ['valid-game', { id: 'valid-game', name: '1/2 NLH', maxSeats: 9, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 0, knownPlayersCount: 0, syncRevision: 'revision-2' }],
        ['bad-game', { id: 'bad-game', name: 'Broken', maxSeats: 9, openTables: {}, waitlistCount: 0, formingCount: 0, availableSeats: 0, knownPlayersCount: 0, syncRevision: 'revision-2' }]
      ],
      memberships: [
        ['valid-membership', { id: 'valid-membership', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Active', preferredGameIds: [], syncRevision: 'revision-2' }],
        ['bad-membership', { id: 'bad-membership', clubId: 'club-1', playerId: {}, playerName: 'Alex', status: 'Active', preferredGameIds: [], syncRevision: 'revision-2' }]
      ],
      waitlists: [['bad-waitlist', { id: 'bad-waitlist', clubId: 'club-1', gameId: [], playerId: 'player-1', playerName: 'Alex', status: 'Interested', position: 0, requestedAt: '2026-08-09T12:00:00.000Z' }]],
      notifications: [['bad-notice', { id: 'bad-notice', clubId: 'club-1', gameId: 'valid-game', title: 'Bad', body: 'Bad', reason: 'seat-opened', createdAt: '2026-08-09T12:00:00.000Z', targetPlayerIds: {} }]]
    });
    setCollection('clubs', [['club-1', parent], ['bad-club', { id: 'bad-club', name: {} }]]);
    firebase.fetch
      .mockRejectedValueOnce(new Error('authenticated discovery offline'))
      .mockRejectedValueOnce(new Error('public discovery offline'));

    const result = await fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.error);
    expect(result.clubs).toHaveLength(1);
    expect(result.clubs[0].club).toMatchObject({ id: 'club-1', name: 'River Room', minimumAge: 18 });
    expect(result.clubs[0].games.map(({ id }) => id)).toEqual(['valid-game']);
    expect(result.clubs[0].memberships.map(({ id }) => id)).toEqual(['valid-membership']);
    expect(result.clubs[0].waitlists).toEqual([]);
    expect(result.clubs[0].notifications).toEqual([]);
    expect(firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference))).not.toContain('clubs/bad-club/games');
  });

  it('holds a published snapshot when a player record is newer than the parent commit', async () => {
    signedInUser();
    setPublishedClubGraph({
      parent: { syncRevision: 'revision-1', publishedAt: '2026-08-09T12:00:00.000Z' },
      games: [['game-1', { id: 'game-1', name: '1/2 NLH', maxSeats: 10, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 0, knownPlayersCount: 0, syncRevision: 'revision-1' }]],
      memberships: [['future', {
        id: 'future',
        clubId: 'club-1',
        playerId: 'player-1',
        playerName: 'Alex Player',
        status: 'Active',
        preferredGameIds: [],
        syncRevision: 'revision-2',
        publishedAt: '2026-08-09T12:00:01.000Z'
      }]]
    });
    firebase.fetch
      .mockRejectedValueOnce(new Error('authenticated discovery offline'))
      .mockRejectedValueOnce(new Error('public discovery offline'));

    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: true, clubs: [] });
  });

  it('uses authenticated/public API discovery without falling back to Firestore projections', async () => {
    const user = signedInUser();
    setPublishedClubGraph();
    const remote = publishedClubSnapshot({
      club: { id: 'club-1', name: 'River Room Remote', publishedAt: '2026-08-09T13:00:00.000Z' },
      generatedAt: '2026-08-09T13:00:00.000Z'
    });
    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      clubs: [remote],
      tournaments: [],
      interests: [],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));

    const result = await fetchAllClubSnapshots(player());

    expect(result).toEqual({
      ok: true,
      clubs: [remote],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
    });
    expect(user.getIdToken).toHaveBeenCalledWith(false);
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/discovery?limit=50',
      expect.objectContaining({ headers: { authorization: 'Bearer player-token' }, signal: expect.any(AbortSignal) })
    );

    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({ ok: false });

    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({ ok: false });
    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('loads every bounded discovery page and removes non-player fixture games', async () => {
    signedInUser();
    const first = publishedClubSnapshot({
      club: { id: 'club-1', name: 'First Room', publishedAt: '2026-08-09T12:00:00.000Z' }
    });
    const second = publishedClubSnapshot({
      club: { id: 'club-2', name: 'Second Room', publishedAt: '2026-08-09T13:00:00.000Z' },
      games: [
        {
          id: 'game-2',
          name: '2/5 NLH',
          maxSeats: 9,
          openTables: [],
          waitlistCount: 0,
          formingCount: 0,
          availableSeats: 0,
          knownPlayersCount: 0
        },
        {
          id: 'stress-game',
          name: 'Stress Game 99',
          maxSeats: 9,
          openTables: [],
          waitlistCount: 0,
          formingCount: 0,
          availableSeats: 0,
          knownPlayersCount: 0
        }
      ]
    });
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [first],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'club-1', databaseQueries: 2 }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [second],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
      }));

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs: [first, { ...second, games: [second.games[0]] }],
      page: { count: 2, hasMore: false, nextCursor: null, databaseQueries: 4 }
    });
    expect(firebase.fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4629/player/discovery?limit=50',
      expect.objectContaining({ headers: { authorization: 'Bearer player-token' }, signal: expect.any(AbortSignal) })
    );
    expect(firebase.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4629/player/discovery?limit=50&cursor=club-1',
      expect.objectContaining({ headers: { authorization: 'Bearer player-token' }, signal: expect.any(AbortSignal) })
    );
  });

  it('keeps completed discovery pages when a later page fails', async () => {
    signedInUser();
    const first = publishedClubSnapshot({
      club: { id: 'club-1', name: 'First Room', publishedAt: '2026-08-09T12:00:00.000Z' }
    });
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [first],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'club-1', databaseQueries: 2 }
      }))
      .mockRejectedValueOnce(new Error('second page unavailable'));

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs: [first],
      page: { count: 1, hasMore: true, nextCursor: 'club-1', databaseQueries: 2 }
    });
    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('stops on an invalid discovery cursor and keeps the sanitized page already loaded', async () => {
    const first = publishedClubSnapshot();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      clubs: [first],
      tournaments: [],
      interests: [],
      page: { count: 1, hasMore: true, nextCursor: null }
    }));

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs: [first],
      page: { count: 1, hasMore: true, nextCursor: null, databaseQueries: undefined }
    });
    expect(firebase.fetch).toHaveBeenCalledTimes(1);
    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('stops on a repeated discovery cursor without refetching it', async () => {
    const first = publishedClubSnapshot({ club: { id: 'club-1', name: 'First Room' } });
    const second = publishedClubSnapshot({ club: { id: 'club-2', name: 'Second Room' } });
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [first],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'cursor-1' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [second],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'cursor-1' }
      }));

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs: [first, second],
      page: { count: 2, hasMore: true, nextCursor: null, databaseQueries: undefined }
    });
    expect(firebase.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns the first twenty sanitized pages as partial instead of discarding them at the safety cap', async () => {
    signedInUser();
    const clubs = Array.from({ length: 20 }, (_, index) => publishedClubSnapshot({
      club: { id: `club-${index + 1}`, name: `Room ${index + 1}` }
    }));
    clubs.forEach((club, index) => {
      firebase.fetch.mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [club],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: `cursor-${index + 1}`, databaseQueries: 2 }
      }));
    });

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs,
      page: { count: 20, hasMore: true, nextCursor: 'cursor-20', databaseQueries: 40 }
    });
    expect(firebase.fetch).toHaveBeenCalledTimes(20);
  });

  it('loads sanitized public discovery without a Firebase session and does not query player-scoped collections', async () => {
    const publicClub = publishedClubSnapshot({
      games: [{
        id: 'planned-game',
        name: '1/3 NLH',
        maxSeats: 9,
        openTables: [],
        waitlistCount: 0,
        formingCount: 0,
        availableSeats: 0,
        knownPlayersCount: 0
      }]
    });
    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      clubs: [publicClub],
      tournaments: [],
      interests: [],
      page: { count: 1, hasMore: false, nextCursor: null }
    }));

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: true,
      clubs: [publicClub],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: undefined }
    });
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/public/discovery?limit=50',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect((firebase.fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toBeUndefined();
    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('loads every public discovery page without adding an authorization header', async () => {
    const first = publishedClubSnapshot({ club: { id: 'club-1', name: 'First Room' } });
    const second = publishedClubSnapshot({ club: { id: 'club-2', name: 'Second Room' } });
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [first],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'club-1' }
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [second],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: false, nextCursor: null }
      }));

    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({ ok: true, clubs: [first, second] });
    expect(firebase.fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4629/player/public/discovery?limit=50&cursor=club-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(firebase.fetch.mock.calls.every(([, init]) => (init as RequestInit | undefined)?.headers === undefined)).toBe(true);
  });

  it('uses only public club and game documents for unsigned Firestore fallback', async () => {
    setPublishedClubGraph({
      memberships: [['membership-player-1', { id: 'membership-player-1', playerId: 'player-1' }]],
      waitlists: [['wait-player-1', { id: 'wait-player-1', playerId: 'player-1' }]],
      notifications: [['notice-player-1', { id: 'notice-player-1', targetPlayerIds: ['player-1'] }]]
    });
    firebase.fetch.mockRejectedValueOnce(new Error('public API offline'));

    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toMatchObject({
      ok: true,
      clubs: [{ memberships: [], waitlists: [], notifications: [] }]
    });
    const queriedPaths = firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference));
    expect(queriedPaths).toContain('clubs');
    expect(queriedPaths).toContain('clubs/club-1/games');
    expect(queriedPaths).not.toContain('clubs/club-1/memberships');
    expect(queriedPaths).not.toContain('clubs/club-1/waitlists');
    expect(queriedPaths).not.toContain('clubs/club-1/notifications');
  });

  it('preserves public Firestore games when the signed-in identity does not match the local profile', async () => {
    signedInUser('different-player');
    setPublishedClubGraph();
    firebase.fetch
      .mockRejectedValueOnce(new Error('authenticated API offline'))
      .mockRejectedValueOnce(new Error('public API offline'));

    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toMatchObject({
      ok: true,
      clubs: [{ games: [{ id: 'game-1' }], memberships: [], waitlists: [], notifications: [] }]
    });
    const queriedPaths = firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference));
    expect(queriedPaths).toContain('clubs/club-1/games');
    expect(queriedPaths).not.toContain('clubs/club-1/memberships');
    expect(queriedPaths).not.toContain('clubs/club-1/waitlists');
    expect(queriedPaths).not.toContain('clubs/club-1/notifications');
  });

  it('falls back to visible legacy clubStates, returns an empty missing result, and exposes malformed/failure errors', async () => {
    const legacy = publishedClubSnapshot({
      memberships: [{
        id: 'legacy-membership',
        clubId: 'club-1',
        playerId: 'player-1',
        playerName: 'Alex Player',
        status: 'Requested',
        joinedAt: '',
        loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New', nextTierAtHours: 12 },
        preferredGameIds: []
      }]
    });
    setCollection('clubs', []);
    setCollection('clubStates', [
      ['club-1', { accountKey: 'club-1', savedAt: legacy.generatedAt, snapshot: legacy }],
      ['hidden', { accountKey: 'hidden', savedAt: legacy.generatedAt, snapshot: publishedClubSnapshot({ club: { id: 'hidden', name: 'Test Club' } }) }]
    ]);
    firebase.fetch.mockRejectedValue(new Error('public API offline'));

    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: true, clubs: [legacy] });

    setCollection('clubStates', []);
    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: true, clubs: [] });

    setCollection('clubStates', [['malformed', null]]);
    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: true, clubs: [] });

    firebase.getDocs.mockRejectedValueOnce(new Error('clubs permission denied'));
    await expect(fetchAllClubSnapshots(player(), { allowLocalDevelopmentFallback: true })).resolves.toEqual({ ok: false, error: 'clubs permission denied' });
  });

  it('characterizes the legacy aggregate facade for valid, missing, malformed, and failed inputs', async () => {
    const visible = publishedClubSnapshot({
      games: [
        { id: 'visible', name: '1/2 NLH', maxSeats: 10, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 10, knownPlayersCount: 0 },
        { id: 'hidden', name: 'Stress Game', maxSeats: 10, openTables: [], waitlistCount: 0, formingCount: 0, availableSeats: 10, knownPlayersCount: 0 }
      ]
    });
    setCollection('clubStates', [['club-1', { snapshot: visible }]]);
    const result = await fetchClubSnapshots(player());
    expect(result).toMatchObject({ ok: true, snapshot: { games: [{ id: 'visible' }] } });

    setCollection('clubStates', []);
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'No venues have been published yet.' });

    setCollection('clubStates', [['malformed', { snapshot: null }]]);
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'No venues have been published yet.' });

    firebase.getDocs.mockRejectedValueOnce(new Error('legacy read failed'));
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'legacy read failed' });
  });
});

describe('bounded tournament discovery boundary', () => {
  it('loads valid tournaments and only the signed-in player active interests', async () => {
    signedInUser();
    const event = tournament();
    const interest = tournamentInterest();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      clubs: [],
      tournaments: [event],
      interests: [interest, { ...interest, id: 'other-interest', playerId: 'other' }],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));

    await expect(fetchPlayerTournaments('player-1')).resolves.toEqual({
      tournaments: [event],
      interests: [interest],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 }
    });
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/discovery?limit=50',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(firebase.getDocs).not.toHaveBeenCalled();
  });

  it('rejects a mismatched signed-in identity before making a discovery request', async () => {
    signedInUser('different-player');
    await expect(fetchPlayerTournaments('player-1')).rejects.toThrow('does not match this profile');
    expect(firebase.fetch).not.toHaveBeenCalled();
  });
});

describe('tournament interest mutation boundaries', () => {
  it('posts an opaque stable mutation ID and enforces identity and interest-window gates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    signedInUser();
    const interest = tournamentInterest();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({
      ok: true,
      interest
    }));

    await expect(expressTournamentInterest(tournament(), player(), 'mutation-random-123')).resolves.toEqual(interest);
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/tournament-interests',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer player-token' }),
        body: JSON.stringify({ clubId: 'club-1', tournamentId: 'event-1', mutationId: 'mutation-random-123' })
      })
    );

    await expect(expressTournamentInterest(tournament(), player({ id: 'other' }), 'mutation-random-456')).rejects.toThrow('does not match this profile');
    await expect(expressTournamentInterest(tournament({ interestStatus: 'closed' }), player(), 'mutation-random-789')).rejects.toThrow('interest window');
    await expect(expressTournamentInterest(tournament({ interestOpensAt: '2026-08-09T13:00:00.000Z' }), player(), 'mutation-random-future')).rejects.toThrow('interest window');
    await expect(expressTournamentInterest(tournament({ interestClosesAt: '2026-08-09T11:00:00.000Z' }), player(), 'mutation-random-999')).rejects.toThrow('interest window');
    await expect(expressTournamentInterest(tournament({ startsAt: '2026-08-09T11:00:00.000Z', interestClosesAt: '2026-08-10T17:00:00.000Z' }), player(), 'mutation-random-started')).rejects.toThrow('interest window');
  });

  it('withdraws only the immutable signed-in player interest while withdrawal is open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    signedInUser();
    const interest = tournamentInterest();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, interest: { ...interest, status: 'withdrawn' } }));
    await withdrawTournamentInterest(tournament(), interest, 'mutation-random-delete');
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/tournament-interests',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ clubId: 'club-1', tournamentId: 'event-1', mutationId: 'mutation-random-delete' })
      })
    );

    await expect(withdrawTournamentInterest(tournament(), { ...interest, playerId: 'other' }, 'mutation-random-other')).rejects.toThrow('only withdraw your own');
    await expect(withdrawTournamentInterest(tournament({ withdrawalAllowed: false }), interest, 'mutation-random-closed')).rejects.toThrow('can no longer be withdrawn');
    await expect(withdrawTournamentInterest(tournament({ startsAt: '2026-08-09T11:00:00.000Z' }), interest, 'mutation-random-started')).rejects.toThrow('can no longer be withdrawn');
  });

  it('never sends tournament mutations after the signed-in account changes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    const user = signedInUser();
    user.getIdToken.mockImplementationOnce(async () => {
      signedInUser('player-2');
      return 'player-token';
    });

    await expect(expressTournamentInterest(tournament(), player(), 'mutation-random-race'))
      .rejects.toThrow('account changed before the request was sent');
    expect(firebase.fetch).not.toHaveBeenCalled();
  });
});

describe('tournament subscription lifecycle', () => {
  it('polls authoritative discovery without installing a Firestore listener', async () => {
    vi.useFakeTimers();
    signedInUser();
    const payload = {
      ok: true,
      clubs: [],
      tournaments: [tournament()],
      interests: [tournamentInterest()],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 }
    };
    firebase.fetch.mockResolvedValue(jsonResponse(payload));
    const callback = vi.fn();
    const subscription = subscribeToPlayerTournaments('player-1', callback);

    expect(listenersAt('clubs')).toHaveLength(0);
    subscription.startPolling();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ tournaments: payload.tournaments, interests: payload.interests }));

    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expose player interests for a mismatched identity and suppresses late results after unsubscribe', async () => {
    vi.useFakeTimers();
    signedInUser('different-player');
    const callback = vi.fn();
    const subscription = subscribeToPlayerTournaments('player-1', callback);
    subscription.startPolling();
    await vi.advanceTimersByTimeAsync(60_000);
    subscription.unsubscribe();
    await flushPromises();

    expect(listenersAt('clubs')).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('live club subscription lifecycle and revisions', () => {
  it('uses API refreshes without installing an anonymous Firestore listener', async () => {
    signedInUser();
    firebase.fetch.mockResolvedValue(jsonResponse({
      ok: true,
      clubs: [],
      tournaments: [],
      interests: [],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));
    const clubSubscription = subscribeToAllClubSnapshots(player(), vi.fn());
    await clubSubscription.refresh();
    expect(firebase.fetch).toHaveBeenCalledOnce();
    expect(listenersAt('clubs')).toHaveLength(0);

    clubSubscription.unsubscribe();
  });

  it('deduplicates API refreshes and tears down cleanly', async () => {
    signedInUser();
    const snapshot = publishedClubSnapshot();
    firebase.fetch.mockResolvedValue(jsonResponse({
      ok: true,
      clubs: [snapshot],
      tournaments: [],
      interests: [],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);
    await subscription.refresh();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenLastCalledWith({ ok: true, clubs: [snapshot] });
    expect(snapshotListeners.filter((listener) => listener.reference.path.startsWith('clubs/club-1/'))).toHaveLength(0);

    subscription.unsubscribe();
    expect(listenersAt('clubs')).toHaveLength(0);
  });

  it('publishes completed pages as partial when a later discovery page is unavailable', async () => {
    signedInUser();
    const snapshot = publishedClubSnapshot();
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        clubs: [snapshot],
        tournaments: [],
        interests: [],
        page: { count: 1, hasMore: true, nextCursor: 'club-1', databaseQueries: 2 }
      }))
      .mockRejectedValueOnce(new Error('second page unavailable'));
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);

    await subscription.refresh();

    expect(callback).toHaveBeenLastCalledWith({ ok: true, clubs: [snapshot], partial: true });
    subscription.unsubscribe();
  });

  it('reports an API refresh failure with prior data explicitly marked stale', async () => {
    signedInUser();
    const snapshot = publishedClubSnapshot();
    firebase.fetch.mockResolvedValue(jsonResponse({
      ok: true,
      clubs: [snapshot],
      tournaments: [],
      interests: [],
      page: { count: 1, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);
    await subscription.refresh();
    firebase.fetch.mockRejectedValue(new Error('authoritative discovery offline'));
    await subscription.refresh();
    expect(callback).toHaveBeenLastCalledWith({
      ok: false,
      error: 'authoritative discovery offline',
      clubs: [snapshot],
      stale: true
    });
    expect(listenersAt('clubs')).toHaveLength(0);

    subscription.unsubscribe();
  });

  it('deduplicates concurrent refreshes and owns one restartable polling timer', async () => {
    vi.useFakeTimers();
    signedInUser();
    firebase.fetch.mockResolvedValue(jsonResponse({
      ok: true,
      clubs: [],
      tournaments: [],
      interests: [],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 }
    }));
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);

    const firstRefresh = subscription.refresh();
    const secondRefresh = subscription.refresh();
    await Promise.all([firstRefresh, secondRefresh]);
    expect(firebase.fetch).toHaveBeenCalledTimes(1);

    subscription.startPolling();
    expect(vi.getTimerCount()).toBe(1);
    subscription.startPolling();
    expect(vi.getTimerCount()).toBe(1);
    subscription.stopPolling();
    expect(vi.getTimerCount()).toBe(0);

    subscription.startPolling();
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
