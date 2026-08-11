import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipRequest,
  PlayerPrivateGameListing,
  PlayerTournament,
  PlayerTournamentRegistration,
  PlayerWaitlistRequest
} from '../domain/playerSync';

type FakeUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
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

const firebase = vi.hoisted(() => ({
  app: {},
  auth: { currentUser: null as FakeUser | null },
  collection: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  deleteDoc: vi.fn(),
  deleteUser: vi.fn(),
  doc: vi.fn(),
  fetch: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  initializeApp: vi.fn(),
  onAuthStateChanged: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  where: vi.fn()
}));

vi.mock('firebase/app', () => ({
  getApps: () => [firebase.app],
  initializeApp: firebase.initializeApp
}));

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: firebase.createUserWithEmailAndPassword,
  deleteUser: firebase.deleteUser,
  getAuth: () => firebase.auth,
  onAuthStateChanged: firebase.onAuthStateChanged,
  signInWithEmailAndPassword: firebase.signInWithEmailAndPassword,
  signOut: firebase.signOut
}));

vi.mock('firebase/firestore', () => ({
  collection: firebase.collection,
  deleteDoc: firebase.deleteDoc,
  doc: firebase.doc,
  getDoc: firebase.getDoc,
  getDocs: firebase.getDocs,
  getFirestore: () => ({}),
  onSnapshot: firebase.onSnapshot,
  query: firebase.query,
  runTransaction: firebase.runTransaction,
  serverTimestamp: firebase.serverTimestamp,
  setDoc: firebase.setDoc,
  where: firebase.where
}));

import {
  createClubMembershipCheckout,
  createPlayerIdentityVerificationSession,
  deleteCurrentPlayerAccount,
  fetchAllClubSnapshots,
  fetchClubSnapshots,
  getCurrentFirebasePlayer,
  fetchPlayerIdentityStatus,
  fetchPlayerProfile,
  fetchPlayerTournaments,
  fetchPrivateGameListings,
  normalizePublishedGames,
  onFirebasePlayerChanged,
  registerForTournament,
  savePlayerProfile,
  signInOrCreatePlayerWithEmail,
  signInOrCreatePlayerWithPhone,
  signOutCurrentPlayer,
  submitMembershipRequest,
  submitPrivateGameListing,
  submitWaitlistRequest,
  subscribeToAllClubSnapshots,
  subscribeToPlayerTournaments,
  subscribeToPrivateGameListings,
  unregisterFromTournament
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

function signedInUser(uid = 'player-1') {
  const user: FakeUser = {
    uid,
    email: 'alex@example.com',
    displayName: 'Alex',
    photoURL: null,
    getIdToken: vi.fn().mockResolvedValue('player-token')
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
    id: 'join-club-1-player-1',
    type: 'membership-request',
    clubId: 'club-1',
    player: player(),
    plan: 'monthly',
    paymentMethod: 'app',
    priceLabel: '$30',
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
  firebase.setDoc.mockResolvedValue(undefined);
  firebase.deleteDoc.mockResolvedValue(undefined);
  firebase.deleteUser.mockResolvedValue(undefined);
  firebase.signOut.mockResolvedValue(undefined);
  firebase.runTransaction.mockImplementation(async (_database: unknown, operation: (transaction: {
    get: (reference: unknown) => Promise<FakeDocument>;
    set: ReturnType<typeof vi.fn>;
  }) => Promise<unknown>) => operation({
    get: async (reference) => documentDocs.get(referencePath(reference)) ?? fakeDocument('', undefined, false),
    set: vi.fn()
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
    await expect(createPlayerIdentityVerificationSession()).rejects.toThrow('Sign in to your Orbit Player account first.');
    await expect(createClubMembershipCheckout({ clubId: 'club-1', product: 'day', playerName: 'Alex' })).rejects.toThrow('Sign in to your Orbit Player account first.');
    expect(firebase.fetch).not.toHaveBeenCalled();
  });

  it('sends the bearer token, preserves the identity payload, and refreshes verified claims', async () => {
    const user = signedInUser();
    const identity = {
      status: 'verified' as const,
      ageVerified: true,
      ageLevel: 21,
      minimumAge: 21,
      verifiedAt: '2026-08-09T11:00:00.000Z',
      failureCode: null
    };
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, identity }));

    await expect(fetchPlayerIdentityStatus(true)).resolves.toEqual(identity);

    expect(firebase.fetch).toHaveBeenCalledWith(
      'https://orbitapp-one.vercel.app/player/identity/status',
      { headers: { authorization: 'Bearer player-token' } }
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

  it('preserves identity-session and checkout HTTP methods, headers, bodies, and results', async () => {
    signedInUser();
    const identity = {
      status: 'requires_input' as const,
      ageVerified: false,
      ageLevel: 0,
      minimumAge: 21,
      verifiedAt: null,
      failureCode: null
    };
    firebase.fetch
      .mockResolvedValueOnce(jsonResponse({ ok: true, identity, verificationUrl: 'https://verify.example/session' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, checkoutUrl: 'https://checkout.example/session', sessionId: 'session-1' }));

    await expect(createPlayerIdentityVerificationSession()).resolves.toMatchObject({ identity, verificationUrl: 'https://verify.example/session' });
    await expect(createClubMembershipCheckout({ clubId: 'club-1', product: 'monthly', playerName: 'Alex' })).resolves.toEqual({
      ok: true,
      checkoutUrl: 'https://checkout.example/session',
      sessionId: 'session-1'
    });

    expect(firebase.fetch).toHaveBeenNthCalledWith(1, 'https://orbitapp-one.vercel.app/player/identity/session', {
      method: 'POST',
      headers: {
        authorization: 'Bearer player-token',
        'content-type': 'application/json'
      }
    });
    expect(firebase.fetch).toHaveBeenNthCalledWith(2, 'https://orbitapp-one.vercel.app/player/membership-checkout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer player-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ clubId: 'club-1', product: 'monthly', playerName: 'Alex' })
    });
  });

  it('stops account deletion when remote identity cleanup fails and otherwise deletes in order', async () => {
    const user = signedInUser();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ error: 'Recent login required.' }, false));

    await expect(deleteCurrentPlayerAccount()).rejects.toThrow('Recent login required.');
    expect(firebase.deleteDoc).not.toHaveBeenCalled();
    expect(firebase.deleteUser).not.toHaveBeenCalled();

    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(deleteCurrentPlayerAccount()).resolves.toBeUndefined();
    expect(firebase.deleteDoc).toHaveBeenCalledWith(expect.objectContaining({ path: `players/${user.uid}` }));
    expect(firebase.deleteUser).toHaveBeenCalledWith(user);
    expect(firebase.deleteDoc.mock.invocationCallOrder[0]).toBeLessThan(firebase.deleteUser.mock.invocationCallOrder[0]);
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
      name: 'alex',
      photoUrl: 'https://example.com/avatar.png'
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
      name: 'alex',
      photoUrl: 'https://example.com/avatar.png'
    });
    expect(callback).toHaveBeenNthCalledWith(2, null);
  });

  it('normalizes email sign-in, falls back to account creation, and preserves the original sign-in error for an existing email', async () => {
    const signInUser = signedInUser('signed-in');
    firebase.signInWithEmailAndPassword.mockResolvedValueOnce({ user: signInUser });
    await expect(signInOrCreatePlayerWithEmail('  ALEX@Example.COM ', 'secret1')).resolves.toMatchObject({ uid: 'signed-in' });
    expect(firebase.signInWithEmailAndPassword).toHaveBeenCalledWith(firebase.auth, 'alex@example.com', 'secret1');

    const signInFailure = Object.assign(new Error('wrong password'), { code: 'auth/wrong-password' });
    const createdUser = { ...signInUser, uid: 'created' };
    firebase.signInWithEmailAndPassword.mockRejectedValueOnce(signInFailure);
    firebase.createUserWithEmailAndPassword.mockResolvedValueOnce({ user: createdUser });
    await expect(signInOrCreatePlayerWithEmail('new@example.com', 'secret2')).resolves.toMatchObject({ uid: 'created' });

    firebase.signInWithEmailAndPassword.mockRejectedValueOnce(signInFailure);
    firebase.createUserWithEmailAndPassword.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'auth/email-already-in-use' }));
    await expect(signInOrCreatePlayerWithEmail('alex@example.com', 'secret3')).rejects.toBe(signInFailure);
  });

  it('preserves input validation and the Expo-compatible phone-to-email mapping', async () => {
    await expect(signInOrCreatePlayerWithEmail('', 'secret1')).rejects.toThrow('Enter your email and password.');
    await expect(signInOrCreatePlayerWithEmail('alex@example.com', 'short')).rejects.toThrow('Password must be at least 6 characters.');
    await expect(signInOrCreatePlayerWithPhone('555', 'secret1')).rejects.toThrow('Enter a valid phone number.');

    const user = signedInUser();
    firebase.signInWithEmailAndPassword.mockResolvedValueOnce({ user });
    await signInOrCreatePlayerWithPhone('+1 (555) 111-2222', 'secret1');
    expect(firebase.signInWithEmailAndPassword).toHaveBeenCalledWith(firebase.auth, 'phone-15551112222@players.orbit.local', 'secret1');

    await signOutCurrentPlayer();
    expect(firebase.signOut).toHaveBeenCalledWith(firebase.auth);
  });
});

describe('Firestore profile and listing boundaries', () => {
  it('preserves an existing membership map and writes the signed-in identity with a server timestamp', async () => {
    signedInUser();
    setDocument('players/player-1', 'player-1', {
      clubMemberships: {
        existing: { clubId: 'existing', status: 'Active' }
      }
    });
    const membershipPatch = { clubId: 'club-1', status: 'Requested' as const, requestedAt: '2026-08-09T12:00:00.000Z' };

    const result = await savePlayerProfile(player({ id: 'untrusted-local-id' }), membershipPatch);

    expect(result.id).toBe('player-1');
    expect(result.uid).toBe('player-1');
    expect(result.clubMemberships).toEqual({
      existing: { clubId: 'existing', status: 'Active' },
      'club-1': membershipPatch
    });
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'players/player-1' }),
      expect.objectContaining({ id: 'player-1', uid: 'player-1', updatedAt: { __serverTimestamp: true } }),
      { merge: true }
    );
  });

  it('returns valid and malformed profile records unchanged, returns null when missing, and propagates read failure', async () => {
    signedInUser();
    const validProfile = { ...player(), uid: 'player-1', clubMemberships: {} };
    setDocument('players/player-1', 'player-1', validProfile);
    await expect(fetchPlayerProfile()).resolves.toBe(validProfile);

    const malformedProfile = { uid: 42, preferredGameIds: 'not-an-array' };
    setDocument('players/player-1', 'player-1', malformedProfile);
    await expect(fetchPlayerProfile()).resolves.toBe(malformedProfile);

    setDocument('players/player-1', 'player-1', undefined, false);
    await expect(fetchPlayerProfile()).resolves.toBeNull();

    firebase.getDoc.mockRejectedValueOnce(new Error('profile read failed'));
    await expect(fetchPlayerProfile()).rejects.toThrow('profile read failed');
  });

  it('filters and orders private games without mutating records and characterizes missing, malformed, and failed reads', async () => {
    const newer = { id: 'new', status: 'Open', createdAt: '2026-08-09T12:00:00.000Z' };
    const older = { id: 'old', status: 'Open', createdAt: '2026-08-08T12:00:00.000Z' };
    const closed = { id: 'closed', status: 'Closed', createdAt: '2026-08-10T12:00:00.000Z' };
    setCollection('privateGames', [['old', older], ['closed', closed], ['new', newer]]);

    await expect(fetchPrivateGameListings()).resolves.toEqual({ ok: true, games: [newer, older] });
    expect(collectionDocs.get('privateGames')?.map((entry) => entry.data())).toEqual([older, closed, newer]);

    setCollection('privateGames', []);
    await expect(fetchPrivateGameListings()).resolves.toEqual({ ok: true, games: [] });

    setCollection('privateGames', [['malformed', null]]);
    await expect(fetchPrivateGameListings()).resolves.toMatchObject({ ok: false });

    firebase.getDocs.mockRejectedValueOnce(new Error('private games denied'));
    await expect(fetchPrivateGameListings()).resolves.toEqual({ ok: false, error: 'private games denied' });
  });
});

describe('published game normalization boundary', () => {
  it('normalizes numeric fallbacks without mutating the external record', () => {
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

    expect(normalizePublishedGames([fakeDocument('game-doc', external) as never])).toEqual([
      expect.objectContaining({
        id: 'game-doc',
        name: '1/2 NLH',
        maxSeats: 10,
        collectionMode: 'Time',
        waitlistCount: 2,
        formingCount: 0,
        availableSeats: 3,
        knownPlayersCount: 0,
        syncRevision: 'revision-1'
      })
    ]);
    expect(external).toEqual(before);
  });

  it('keeps v2 aggregate order, excludes legacy sessions beside versioned aggregates, and handles missing records', () => {
    const result = normalizePublishedGames([
      fakeDocument('game-b', { id: 'b', name: 'Game B', syncRevision: 'revision-2' }) as never,
      fakeDocument('session', { id: 'session', gameId: 'a', gameName: 'Game A', status: 'Running', updatedAt: new Date().toISOString() }) as never,
      fakeDocument('game-a', { id: 'a', name: 'Game A', syncRevision: 'revision-2' }) as never
    ]);

    expect(result.map((game) => game.id)).toEqual(['b', 'a']);
    expect(normalizePublishedGames([])).toEqual([]);
  });

  it('throws on a null Firestore game record under the current malformed-record policy', () => {
    expect(() => normalizePublishedGames([fakeDocument('bad-game', null) as never])).toThrow();
  });
});

describe('request HTTP boundaries', () => {
  it('uses the authenticated remote membership endpoint first and returns its snapshot unchanged', async () => {
    signedInUser();
    const request = membershipRequest();
    const snapshot = publishedClubSnapshot();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: 'club-1', savedAt: snapshot.generatedAt, snapshot }));

    await expect(submitMembershipRequest(request)).resolves.toEqual({ ok: true, accountKey: 'club-1', savedAt: snapshot.generatedAt, snapshot });

    expect(firebase.fetch).toHaveBeenCalledWith('https://orbitapp-one.vercel.app/player/membership-requests', {
      method: 'POST',
      headers: {
        authorization: 'Bearer player-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ...request, player: { ...request.player, id: 'player-1' } })
    });
    expect(firebase.setDoc).not.toHaveBeenCalled();
  });

  it('falls through malformed remote waitlist success to dual Firestore request writes and the existing missing-snapshot error', async () => {
    signedInUser();
    const request = waitlistRequest();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await expect(submitWaitlistRequest(request)).resolves.toEqual({
      ok: false,
      error: 'Seat request was sent, but no published club snapshot was found.'
    });

    expect(firebase.setDoc).toHaveBeenCalledTimes(2);
    expect(firebase.setDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: `clubs/club-1/waitlistRequests/${request.id}` }),
      expect.objectContaining({
        player: expect.objectContaining({ id: 'player-1' }),
        status: 'pending',
        syncProtocolVersion: 2,
        clientMutationId: request.id,
        clientCreatedAt: request.requestedAt,
        createdAt: { __serverTimestamp: true }
      }),
      { merge: true }
    );
    expect(firebase.setDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: `clubStates/club-1/waitlistRequests/${request.id}` }),
      expect.any(Object),
      { merge: true }
    );
  });
});

describe('published and legacy club snapshot boundaries', () => {
  it('uses a configured local bridge and falls back from malformed and failed local responses without contacting real services', async () => {
    signedInUser();
    vi.stubEnv('EXPO_PUBLIC_ORBIT_LOCAL_API_URL', 'http://127.0.0.1:4629');
    vi.resetModules();
    const localAdapter = await import('./orbitSyncApi');
    const localSnapshot = publishedClubSnapshot({
      club: { id: 'local-club', name: 'Local Room' },
      generatedAt: '2026-08-09T14:00:00.000Z'
    });
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, snapshot: localSnapshot, accountKey: 'local-club' }));
    setCollection('clubs', []);
    setCollection('clubStates', []);

    await expect(localAdapter.fetchAllClubSnapshots(player())).resolves.toEqual({ ok: true, clubs: [localSnapshot] });
    expect(firebase.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4629/player/snapshot?playerId=player-1&playerName=Alex+Player',
      { headers: { authorization: 'Bearer player-token' } }
    );

    setPublishedClubGraph();
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(localAdapter.fetchAllClubSnapshots(player())).resolves.toMatchObject({
      ok: true,
      clubs: [{ club: { id: 'club-1', name: 'River Room' } }]
    });

    firebase.fetch.mockRejectedValueOnce(new Error('local bridge offline'));
    await expect(localAdapter.fetchAllClubSnapshots(player())).resolves.toMatchObject({
      ok: true,
      clubs: [{ club: { id: 'club-1', name: 'River Room' } }]
    });
  });

  it('hydrates a committed v2 club, filters hidden and other-player records, and preserves external documents', async () => {
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
        ['game-1', { id: 'game-1', name: '1/2 NLH', maxSeats: 10, syncRevision: 'revision-2' }],
        ['stress-game', { id: 'stress-game', name: 'Stress Game', maxSeats: 10, syncRevision: 'revision-2' }]
      ],
      memberships: [['membership-player-1', membership], ['membership-other', otherMembership]],
      waitlists: [['wait-player-1', waitlist], ['wait-other', { ...waitlist, id: 'wait-other', playerId: 'other', playerName: 'Other Player' }]],
      notifications: [['notice-player-1', notification], ['notice-other', { ...notification, id: 'notice-other', targetPlayerIds: ['other'] }]]
    });
    const before = structuredClone(membership);

    const result = await fetchAllClubSnapshots(player());

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

  it('holds a published snapshot when a player record is newer than the parent commit', async () => {
    setPublishedClubGraph({
      parent: { syncRevision: 'revision-1', publishedAt: '2026-08-09T12:00:00.000Z' },
      games: [['game-1', { id: 'game-1', name: '1/2 NLH', syncRevision: 'revision-1' }]],
      memberships: [['future', {
        id: 'future',
        playerId: 'player-1',
        playerName: 'Alex Player',
        syncRevision: 'revision-2',
        publishedAt: '2026-08-09T12:00:01.000Z'
      }]]
    });

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({
      ok: false,
      error: 'River Room is publishing newer player records.'
    });
  });

  it('uses the freshest remote duplicate while retaining published ordering and bearer authentication', async () => {
    const user = signedInUser();
    setPublishedClubGraph();
    const remote = publishedClubSnapshot({
      club: { id: 'club-1', name: 'River Room Remote', publishedAt: '2026-08-09T13:00:00.000Z' },
      generatedAt: '2026-08-09T13:00:00.000Z'
    });
    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true, snapshot: remote, accountKey: 'club-1' }));

    const result = await fetchAllClubSnapshots(player());

    expect(result).toEqual({ ok: true, clubs: [remote] });
    expect(user.getIdToken).toHaveBeenCalledWith(false);
    expect(firebase.fetch).toHaveBeenCalledWith(
      'https://orbitapp-one.vercel.app/player/snapshot?accountKey=club-1&playerName=Alex+Player',
      { headers: { authorization: 'Bearer player-token' } }
    );

    firebase.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({
      ok: true,
      clubs: [{ club: { id: 'club-1', name: 'River Room' } }]
    });

    firebase.fetch.mockRejectedValueOnce(new Error('remote snapshot offline'));
    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({
      ok: true,
      clubs: [{ club: { id: 'club-1', name: 'River Room' } }]
    });
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

    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({ ok: true, clubs: [legacy] });

    setCollection('clubStates', []);
    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({ ok: true, clubs: [] });

    setCollection('clubStates', [['malformed', null]]);
    await expect(fetchAllClubSnapshots(player())).resolves.toMatchObject({ ok: false });

    firebase.getDocs.mockRejectedValueOnce(new Error('clubs permission denied'));
    await expect(fetchAllClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'clubs permission denied' });
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
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'No card houses have been published yet.' });

    setCollection('clubStates', [['malformed', { snapshot: null }]]);
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'No card houses have been published yet.' });

    firebase.getDocs.mockRejectedValueOnce(new Error('legacy read failed'));
    await expect(fetchClubSnapshots(player())).resolves.toEqual({ ok: false, error: 'legacy read failed' });
  });
});

describe('tournament Firestore boundaries', () => {
  it('filters hidden clubs, maps document IDs, and reads registrations only for the matching signed-in player', async () => {
    signedInUser();
    const tournament = { name: 'Sunday Major', startsAt: '2026-08-10T18:00:00.000Z' };
    const registration = { id: 'registration-source', playerId: 'player-1', tournamentId: 'event-doc' };
    setCollection('clubs', [['club-1', { name: 'River Room' }], ['hidden', { name: 'Test Club' }], ['malformed', null]]);
    setCollection('clubs/club-1/tournaments', [['event-doc', tournament]]);
    setCollection('clubs/club-1/tournamentRegistrations', [['registration-doc', registration]]);

    const result = await fetchPlayerTournaments('player-1');

    expect(result).toEqual({
      tournaments: [{ ...tournament, id: 'event-doc', clubId: 'club-1' }],
      registrations: [registration]
    });
    expect(firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference))).not.toContain('clubs/hidden/tournaments');
    expect(firebase.query).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'clubs/club-1/tournamentRegistrations' }),
      { field: 'playerId', operator: '==', value: 'player-1' }
    );
  });

  it('skips private registrations for an identity mismatch and preserves missing, malformed-event, and failure behavior', async () => {
    signedInUser('different-player');
    setCollection('clubs', [['club-1', { name: 'River Room' }]]);
    setCollection('clubs/club-1/tournaments', [['malformed-event', null]]);

    await expect(fetchPlayerTournaments('player-1')).resolves.toEqual({
      tournaments: [{ id: 'malformed-event', clubId: 'club-1' }],
      registrations: []
    });
    expect(firebase.getDocs.mock.calls.map(([reference]) => referencePath(reference))).not.toContain('clubs/club-1/tournamentRegistrations');

    setCollection('clubs', []);
    await expect(fetchPlayerTournaments('player-1')).resolves.toEqual({ tournaments: [], registrations: [] });

    firebase.getDocs.mockRejectedValueOnce(new Error('tournaments denied'));
    await expect(fetchPlayerTournaments('player-1')).rejects.toThrow('tournaments denied');
  });
});

describe('Firestore mutation boundaries', () => {
  function tournament(overrides: Partial<PlayerTournament> = {}): PlayerTournament {
    return {
      id: 'event-1',
      clubId: 'club-1',
      name: 'Sunday Major',
      startsAt: '2026-08-10T18:00:00.000Z',
      registrationOpensAt: '2026-08-01T00:00:00.000Z',
      registrationClosesAt: '2026-08-10T17:00:00.000Z',
      registrationStatus: 'open',
      buyIn: 100,
      prizePoolLabel: '$10,000',
      startingStack: 20_000,
      levelMinutes: 20,
      lateRegistrationThroughLevel: 6,
      rebuyPrice: 100,
      rebuyStack: 20_000,
      unlimitedRebuys: false,
      addOnPrice: 50,
      addOnStack: 10_000,
      rules: [],
      unregisterAllowed: true,
      entrantCount: 0,
      totalRebuys: 0,
      totalAddOns: 0,
      ...overrides
    };
  }

  it('writes a registration with authoritative identity/timestamps and enforces identity and close-time gates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    signedInUser();

    const result = await registerForTournament(tournament(), player());
    expect(result).toEqual(expect.objectContaining({
      id: 'event-1:player-1',
      tournamentId: 'event-1',
      clubId: 'club-1',
      playerId: 'player-1',
      status: 'registered',
      registeredAt: '2026-08-09T12:00:00.000Z',
      updatedAt: '2026-08-09T12:00:00.000Z'
    }));
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'clubs/club-1/tournamentRegistrations/event-1:player-1' }),
      expect.objectContaining({ id: 'event-1:player-1', updatedAt: { __serverTimestamp: true } })
    );

    await expect(registerForTournament(tournament(), player({ id: 'other' }))).rejects.toThrow('does not match this profile');
    await expect(registerForTournament(tournament({ registrationStatus: 'closed' }), player())).rejects.toThrow('Registration for this tournament is closed.');
    await expect(registerForTournament(tournament({ registrationClosesAt: '2026-08-09T11:00:00.000Z' }), player())).rejects.toThrow('Registration for this tournament is closed.');
  });

  it('deletes only the signed-in player registration while self-unregistration remains open', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
    signedInUser();
    const registration: PlayerTournamentRegistration = {
      id: 'event-1:player-1',
      tournamentId: 'event-1',
      clubId: 'club-1',
      playerId: 'player-1',
      playerName: 'Alex Player',
      playerEmail: 'alex@example.com',
      status: 'registered',
      rebuys: 0,
      addOns: 0,
      registeredAt: '2026-08-09T10:00:00.000Z',
      updatedAt: '2026-08-09T10:00:00.000Z'
    };

    await unregisterFromTournament(tournament(), registration);
    expect(firebase.deleteDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'clubs/club-1/tournamentRegistrations/event-1:player-1' }));

    await expect(unregisterFromTournament(tournament(), { ...registration, playerId: 'other' })).rejects.toThrow('only remove your own registration');
    await expect(unregisterFromTournament(tournament({ unregisterAllowed: false }), registration)).rejects.toThrow('Self-unregistration is no longer available');
    await expect(unregisterFromTournament(tournament({ startsAt: '2026-08-09T11:00:00.000Z' }), registration)).rejects.toThrow('Self-unregistration is no longer available');
  });

  it('writes private games with a server timestamp and returns current failure results', async () => {
    const listing: PlayerPrivateGameListing = {
      id: 'private-1',
      name: 'Friday Game',
      location: 'Austin',
      startsAt: '2026-08-14T19:00:00.000Z',
      seats: '8',
      note: '',
      hostPlayerId: 'player-1',
      hostPlayerPath: 'players/player-1',
      hostPlayerName: 'Alex Player',
      hostPlayerEmail: 'alex@example.com',
      createdAt: '2026-08-09T12:00:00.000Z',
      status: 'Open'
    };

    await expect(submitPrivateGameListing(listing)).resolves.toEqual({ ok: true, game: listing });
    expect(firebase.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'privateGames/private-1' }),
      { ...listing, updatedAt: { __serverTimestamp: true } },
      { merge: false }
    );

    firebase.setDoc.mockRejectedValueOnce(new Error('private game write denied'));
    await expect(submitPrivateGameListing(listing)).resolves.toEqual({ ok: false, error: 'private game write denied' });
  });
});

describe('private-game subscription lifecycle', () => {
  it('orders open records, reports listener errors, preserves malformed throws, and returns the SDK unsubscriber', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeToPrivateGameListings(callback);
    const listener = listenersAt('privateGames')[0];
    const newer = { id: 'new', status: 'Open', createdAt: '2026-08-09T12:00:00.000Z' };
    const older = { id: 'old', status: 'Open', createdAt: '2026-08-08T12:00:00.000Z' };

    emitSnapshot('privateGames', [['old', older], ['closed', { id: 'closed', status: 'Closed' }], ['new', newer]]);
    expect(callback).toHaveBeenLastCalledWith({ ok: true, games: [newer, older] });

    emitSnapshotError('privateGames', 'private listener denied');
    expect(callback).toHaveBeenLastCalledWith({ ok: false, error: 'private listener denied' });

    expect(() => emitSnapshot('privateGames', [['malformed', null]])).toThrow();
    unsubscribe();
    expect(listener.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('tournament subscription lifecycle', () => {
  it('replaces child listeners on every visible-club snapshot and tears down root/current children', async () => {
    signedInUser();
    setCollection('clubs', [['club-1', { name: 'River Room' }]]);
    setCollection('clubs/club-1/tournaments', [['event-1', { name: 'Sunday Major' }]]);
    setCollection('clubs/club-1/tournamentRegistrations', [['registration-1', { id: 'registration-1', playerId: 'player-1' }]]);
    const callback = vi.fn();
    const unsubscribe = subscribeToPlayerTournaments('player-1', callback);
    const root = listenersAt('clubs')[0];

    root.next(fakeSnapshot([['club-1', { name: 'River Room' }], ['hidden', { name: 'Stress Club' }]]));
    await flushPromises();
    const firstEventListener = listenersAt('clubs/club-1/tournaments')[0];
    const firstRegistrationListener = listenersAt('clubs/club-1/tournamentRegistrations')[0];
    expect(callback).toHaveBeenCalledWith({
      tournaments: [{ name: 'Sunday Major', id: 'event-1', clubId: 'club-1' }],
      registrations: [{ id: 'registration-1', playerId: 'player-1' }]
    });

    root.next(fakeSnapshot([['club-1', { name: 'River Room Updated' }]]));
    await flushPromises();
    expect(firstEventListener.unsubscribe).toHaveBeenCalledOnce();
    expect(firstRegistrationListener.unsubscribe).toHaveBeenCalledOnce();
    expect(listenersAt('clubs/club-1/tournaments')).toHaveLength(2);
    expect(listenersAt('clubs/club-1/tournamentRegistrations')).toHaveLength(2);

    unsubscribe();
    expect(root.unsubscribe).toHaveBeenCalledOnce();
    expect(listenersAt('clubs/club-1/tournaments')[1].unsubscribe).toHaveBeenCalledOnce();
    expect(listenersAt('clubs/club-1/tournamentRegistrations')[1].unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not subscribe to private registrations for a mismatched identity and suppresses late results after unsubscribe', async () => {
    signedInUser('different-player');
    setCollection('clubs', [['club-1', { name: 'River Room' }]]);
    setCollection('clubs/club-1/tournaments', []);
    const callback = vi.fn();
    const unsubscribe = subscribeToPlayerTournaments('player-1', callback);
    const root = listenersAt('clubs')[0];

    root.next(fakeSnapshot([['club-1', { name: 'River Room' }]]));
    unsubscribe();
    await flushPromises();

    expect(listenersAt('clubs/club-1/tournaments')).toHaveLength(1);
    expect(listenersAt('clubs/club-1/tournamentRegistrations')).toHaveLength(0);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('live club subscription lifecycle and revisions', () => {
  it('deduplicates club listeners, emits only committed revisions, detaches removed clubs, and tears down every listener', () => {
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);
    const root = listenersAt('clubs')[0];
    const parent = {
      id: 'club-1',
      name: 'River Room',
      syncProtocolVersion: 2,
      syncRevision: 'revision-2',
      publishedAt: '2026-08-09T12:00:00.000Z',
      entityCounts: { games: 1 }
    };

    root.next(fakeSnapshot([['club-1', parent], ['hidden', { id: 'hidden', name: 'Stress Club' }]]));
    expect(callback).not.toHaveBeenCalled();
    expect(listenersAt('clubs/club-1/games')).toHaveLength(1);
    expect(listenersAt('clubs/club-1/memberships')).toHaveLength(1);
    expect(listenersAt('clubs/club-1/waitlists')).toHaveLength(1);
    expect(listenersAt('clubs/club-1/notifications')).toHaveLength(1);

    emitSnapshot('clubs/club-1/games', [['game-1', { id: 'game-1', name: '1/2 NLH', syncRevision: 'revision-2' }]]);
    expect(callback).toHaveBeenLastCalledWith({
      ok: true,
      clubs: [expect.objectContaining({ club: expect.objectContaining({ id: 'club-1', syncRevision: 'revision-2' }), games: [expect.objectContaining({ id: 'game-1' })] })]
    });
    const committedCallCount = callback.mock.calls.length;

    emitSnapshot('clubs/club-1/memberships', [['future-membership', {
      id: 'future-membership',
      playerId: 'player-1',
      playerName: 'Alex Player',
      syncRevision: 'revision-3',
      publishedAt: '2026-08-09T12:00:01.000Z'
    }]]);
    expect(callback).toHaveBeenCalledTimes(committedCallCount);

    root.next(fakeSnapshot([['club-1', { ...parent, address: '2 River Road' }]]));
    expect(listenersAt('clubs/club-1/games')).toHaveLength(1);

    const childListeners = snapshotListeners.filter((listener) => listener.reference.path.startsWith('clubs/club-1/'));
    root.next(fakeSnapshot([]));
    childListeners.forEach((listener) => expect(listener.unsubscribe).toHaveBeenCalledOnce());

    subscription.unsubscribe();
    expect(root.unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports root failure before data, re-emits cached data after failure, and characterizes malformed child records', () => {
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);
    const root = listenersAt('clubs')[0];

    root.error?.(new Error('club listener denied'));
    expect(callback).toHaveBeenLastCalledWith({ ok: false, error: 'club listener denied' });

    root.next(fakeSnapshot([['club-1', { id: 'club-1', name: 'River Room' }]]));
    emitSnapshot('clubs/club-1/games', [['game-1', { id: 'game-1', name: '1/2 NLH' }]]);
    const beforeError = callback.mock.calls.length;
    root.error?.(new Error('transient listener error'));
    expect(callback).toHaveBeenCalledTimes(beforeError + 1);
    expect(callback.mock.calls.at(-1)?.[0]).toMatchObject({ ok: true });

    expect(() => emitSnapshot('clubs/club-1/games', [['malformed', null]])).toThrow();
    subscription.unsubscribe();
  });

  it('deduplicates concurrent refreshes and owns one restartable polling timer', async () => {
    vi.useFakeTimers();
    setPublishedClubGraph();
    const callback = vi.fn();
    const subscription = subscribeToAllClubSnapshots(player(), callback);

    const firstRefresh = subscription.refresh();
    const secondRefresh = subscription.refresh();
    await Promise.all([firstRefresh, secondRefresh]);
    expect(firebase.getDocs.mock.calls.filter(([reference]) => referencePath(reference) === 'clubs')).toHaveLength(1);

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
