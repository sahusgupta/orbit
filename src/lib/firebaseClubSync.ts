import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, initializeFirestore, getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp, updateDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';
import {
  applyMembershipRequestToClubState,
  applyWaitlistRequestToClubState,
  buildPlayerClubSnapshot,
  getClubIdFromState,
  type PlayerClubSnapshot,
  type PlayerMembershipRequest,
  type PlayerWaitlistRequest
} from './playerSync';

type FirebaseClubStateRecord<TState> = {
  accountKey: string;
  savedAt: string;
  state: TState;
  snapshot: PlayerClubSnapshot;
};

const firebaseSyncTimeoutMs = 2500;

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
let db: ReturnType<typeof getFirestore>;

try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
} catch {
  db = getFirestore(app);
}

function stripUndefinedForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : stripUndefinedForFirestore(item))) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedForFirestore(item)])
    ) as T;
  }
  return value;
}

function withFirebaseTimeout<T>(operation: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((resolve) => {
      globalThis.setTimeout(() => resolve(fallback), firebaseSyncTimeoutMs);
    })
  ]);
}

async function ensureFirebaseSession() {
  if (auth.currentUser) return auth.currentUser;
  throw new Error('Firebase email/password authentication is required before synchronization.');
}

export async function signInToFirebaseWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return credential.user;
}

export async function createFirebaseEmailAccount(email: string, password: string) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return credential.user;
}

/**
 * Migrates an existing Orbit login into Firebase Auth without an extra user
 * workflow. Call this only after Orbit's local password hash and pilot access
 * have already been verified.
 */
export async function signInOrCreateFirebaseEmailAccount(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  try {
    return await signInToFirebaseWithEmail(normalizedEmail, password);
  } catch (signInError) {
    try {
      return await createFirebaseEmailAccount(normalizedEmail, password);
    } catch (createError) {
      if ((createError as { code?: string }).code === 'auth/email-already-in-use') {
        throw signInError;
      }
      throw createError;
    }
  }
}

export async function signOutOfFirebase() {
  await signOut(auth);
}

export function getFirebaseSyncStatus() {
  return {
    enabled: true,
    projectId: firebaseConfig.projectId
  };
}

export async function saveClubStateToFirebase<TState extends object>(state: TState) {
  const user = await withFirebaseTimeout(ensureFirebaseSession(), null);
  if (!user) throw new Error('Firebase authentication timed out before synchronization.');
  const syncedState = await syncPlayerUpdatesToClubState(state);
  const accountKey = getClubIdFromState(syncedState as Parameters<typeof getClubIdFromState>[0]);
  const savedAt = new Date().toISOString();
  const snapshot = buildPlayerClubSnapshot(syncedState as Parameters<typeof buildPlayerClubSnapshot>[0]);
  const record = {
    accountKey,
    savedAt,
    state: stripUndefinedForFirestore(syncedState),
    snapshot: stripUndefinedForFirestore(snapshot),
    updatedAt: serverTimestamp()
  };
  return withFirebaseTimeout(
    setDoc(doc(db, 'clubStates', accountKey), record, { merge: true })
      .then(() => publishClubSnapshot(accountKey, snapshot, savedAt))
      .then(() => ({ accountKey, savedAt, snapshot, synced: true })),
    { accountKey, savedAt, snapshot, synced: false }
  );
}

export async function loadClubStateFromFirebase<TState = unknown>(accountKey: string) {
  const user = await withFirebaseTimeout(ensureFirebaseSession(), null);
  if (!user) throw new Error('Firebase authentication timed out before synchronization.');
  const normalizedKey = accountKey.trim().toLowerCase();
  if (!normalizedKey) return null;
  const snapshot = await withFirebaseTimeout(getDoc(doc(db, 'clubStates', normalizedKey)), null);
  if (!snapshot) return null;
  if (!snapshot.exists()) return null;
  return snapshot.data() as FirebaseClubStateRecord<TState>;
}

export async function syncPlayerUpdatesToClubState<TState extends object>(state: TState): Promise<TState> {
  const accountKey = getClubIdFromState(state as Parameters<typeof getClubIdFromState>[0]);
  let nextState = state as Parameters<typeof applyMembershipRequestToClubState>[0];

  const membershipRequests = await fetchPendingRequestDocs(accountKey, 'membershipRequests');
  if (membershipRequests.length) {
    const appliedIds = new Set<string>();
    for (const requestDoc of membershipRequests) {
      const request = requestDoc.data() as PlayerMembershipRequest & { status?: string };
      if (appliedIds.has(request.id)) continue;
      if (request.status === 'applied') continue;
      appliedIds.add(request.id);
      nextState = applyMembershipRequestToClubState(nextState, request);
      await updatePlayerMembershipStatus(request.player.id, accountKey, request.requestedAt);
      await markRequestApplied(accountKey, 'membershipRequests', request.id);
    }
  }

  const waitlistRequests = await fetchPendingRequestDocs(accountKey, 'waitlistRequests');
  if (waitlistRequests.length) {
    const appliedIds = new Set<string>();
    for (const requestDoc of waitlistRequests) {
      const request = requestDoc.data() as PlayerWaitlistRequest & { status?: string };
      if (appliedIds.has(request.id)) continue;
      if (request.status === 'applied') continue;
      appliedIds.add(request.id);
      nextState = applyWaitlistRequestToClubState(nextState, request);
      await markRequestApplied(accountKey, 'waitlistRequests', request.id);
    }
  }

  return nextState as TState;
}

export function subscribeToPlayerRequestUpdates(accountKey: string, callback: () => void) {
  const normalizedKey = accountKey.trim().toLowerCase();
  if (!normalizedKey) return () => undefined;
  const paths: Array<'membershipRequests' | 'waitlistRequests'> = ['membershipRequests', 'waitlistRequests'];
  const unsubscribers: Unsubscribe[] = [];
  let initialized = false;
  const handleSnapshot = () => {
    if (!initialized) return;
    callback();
  };

  paths.forEach((collectionName) => {
    unsubscribers.push(
      onSnapshot(collection(db, 'clubs', normalizedKey, collectionName), handleSnapshot, () => undefined),
      onSnapshot(collection(db, 'clubStates', normalizedKey, collectionName), handleSnapshot, () => undefined)
    );
  });

  globalThis.setTimeout(() => {
    initialized = true;
    callback();
  }, 0);

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

async function publishClubSnapshot(accountKey: string, snapshot: PlayerClubSnapshot, savedAt: string) {
  const [existingGames, existingMemberships, existingWaitlists, existingNotifications] = await Promise.all([
    getDocs(collection(db, 'clubs', accountKey, 'games')),
    getDocs(collection(db, 'clubs', accountKey, 'memberships')),
    getDocs(collection(db, 'clubs', accountKey, 'waitlists')),
    getDocs(collection(db, 'clubs', accountKey, 'notifications'))
  ]);
  const batch = writeBatch(db);
  const clubRef = doc(db, 'clubs', accountKey);
  const gameIds = new Set(snapshot.games.map((game) => game.id));
  const membershipIds = new Set(snapshot.memberships.map((membership) => membership.playerId));
  const waitlistIds = new Set(snapshot.waitlists.map((entry) => entry.id));
  const notificationIds = new Set((snapshot.notifications ?? []).map((notification) => notification.id));
  batch.set(
    clubRef,
    stripUndefinedForFirestore({
      ...snapshot.club,
      social: snapshot.social,
      generatedAt: snapshot.generatedAt,
      savedAt,
      updatedAt: serverTimestamp()
    }),
    { merge: true }
  );
  snapshot.games.forEach((game) => {
    batch.set(doc(db, 'clubs', accountKey, 'games', game.id), stripUndefinedForFirestore({ ...game, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingGames.docs.forEach((gameDoc) => {
    if (!gameIds.has(gameDoc.id)) batch.delete(gameDoc.ref);
  });
  snapshot.memberships.forEach((membership) => {
    batch.set(
      doc(db, 'clubs', accountKey, 'memberships', membership.playerId),
      stripUndefinedForFirestore({ ...membership, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  });
  existingMemberships.docs.forEach((membershipDoc) => {
    if (!membershipIds.has(membershipDoc.id)) batch.delete(membershipDoc.ref);
  });
  snapshot.waitlists.forEach((entry) => {
    batch.set(doc(db, 'clubs', accountKey, 'waitlists', entry.id), stripUndefinedForFirestore({ ...entry, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingWaitlists.docs.forEach((waitlistDoc) => {
    if (!waitlistIds.has(waitlistDoc.id)) batch.delete(waitlistDoc.ref);
  });
  (snapshot.notifications ?? []).forEach((notification) => {
    batch.set(doc(db, 'clubs', accountKey, 'notifications', notification.id), stripUndefinedForFirestore({ ...notification, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingNotifications.docs.forEach((notificationDoc) => {
    if (!notificationIds.has(notificationDoc.id)) batch.delete(notificationDoc.ref);
  });
  await batch.commit();
}

async function fetchPendingRequestDocs(accountKey: string, collectionName: 'membershipRequests' | 'waitlistRequests') {
  const [clubScoped, legacyScoped] = await Promise.all([
    withFirebaseTimeout(getDocs(collection(db, 'clubs', accountKey, collectionName)), null),
    withFirebaseTimeout(getDocs(collection(db, 'clubStates', accountKey, collectionName)), null)
  ]);
  return [...(clubScoped?.docs ?? []), ...(legacyScoped?.docs ?? [])];
}

async function markRequestApplied(accountKey: string, collectionName: 'membershipRequests' | 'waitlistRequests', requestId: string | undefined) {
  if (!requestId) return;
  await Promise.all([
    updateDoc(doc(db, 'clubs', accountKey, collectionName, requestId), { status: 'applied', appliedAt: serverTimestamp() }).catch(() => undefined),
    updateDoc(doc(db, 'clubStates', accountKey, collectionName, requestId), { status: 'applied', appliedAt: serverTimestamp() }).catch(() => undefined)
  ]);
}

async function updatePlayerMembershipStatus(playerId: string | undefined, clubId: string, requestedAt: string) {
  if (!playerId) return;
  const membershipStart = requestedAt.slice(0, 10);
  const membershipExpiration = addDays(membershipStart, 365);
  await setDoc(
    doc(db, 'clubs', clubId, 'memberships', playerId),
    {
      clubId,
      playerId,
      status: 'Active',
      requestedAt,
      joinedAt: membershipStart,
      expiresAt: membershipExpiration,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  ).catch(() => undefined);
}

function addDays(date: string, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}
