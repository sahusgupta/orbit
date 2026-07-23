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
  await auth.authStateReady();
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
      .then(() => publishClubSnapshot(accountKey, snapshot, savedAt, syncedState))
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
      await updatePlayerMembershipStatus(request.player.id, accountKey, request);
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

  const [registrationDocs, transactionDocs] = await Promise.all([
    withFirebaseTimeout(getDocs(collection(db, 'clubs', accountKey, 'tournamentRegistrations')), null),
    withFirebaseTimeout(getDocs(collection(db, 'clubs', accountKey, 'transactions')), null)
  ]);
  nextState = applyTournamentRegistrations(nextState, registrationDocs?.docs.map((item) => item.data()) ?? []);
  nextState = applyRevenueTransactions(nextState, transactionDocs?.docs.map((item) => item.data()) ?? []);

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
  ['tournamentRegistrations', 'transactions'].forEach((collectionName) => {
    unsubscribers.push(onSnapshot(collection(db, 'clubs', normalizedKey, collectionName), handleSnapshot, () => undefined));
  });

  globalThis.setTimeout(() => {
    initialized = true;
    callback();
  }, 0);

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

async function publishClubSnapshot(accountKey: string, snapshot: PlayerClubSnapshot, savedAt: string, state: Record<string, any>) {
  const [existingGames, existingMemberships, existingWaitlists, existingNotifications, existingTournaments] = await Promise.all([
    getDocs(collection(db, 'clubs', accountKey, 'games')),
    getDocs(collection(db, 'clubs', accountKey, 'memberships')),
    getDocs(collection(db, 'clubs', accountKey, 'waitlists')),
    getDocs(collection(db, 'clubs', accountKey, 'notifications')),
    getDocs(collection(db, 'clubs', accountKey, 'tournaments'))
  ]);
  const batch = writeBatch(db);
  const clubRef = doc(db, 'clubs', accountKey);
  const gameIds = new Set(snapshot.games.map((game) => game.id));
  const membershipIds = new Set(snapshot.memberships.map((membership) => membership.playerId));
  const waitlistIds = new Set(snapshot.waitlists.map((entry) => entry.id));
  const notificationIds = new Set((snapshot.notifications ?? []).map((notification) => notification.id));
  const publishedTournaments = (state.tournaments ?? []).map(toPlayerTournament);
  const tournamentIds = new Set(publishedTournaments.map((tournament) => tournament.id));
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
  publishedTournaments.forEach((tournament) => {
    batch.set(doc(db, 'clubs', accountKey, 'tournaments', tournament.id), stripUndefinedForFirestore({ ...tournament, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingTournaments.docs.forEach((tournamentDoc) => {
    if (!tournamentIds.has(tournamentDoc.id)) batch.delete(tournamentDoc.ref);
  });
  (state.tournaments ?? []).forEach((tournament: Record<string, any>) => {
    (tournament.players ?? []).forEach((player: Record<string, any>) => {
      if (!player.registrationId) return;
      const status = player.status === 'Checked In' || player.status === 'Active'
        ? 'checked-in'
        : player.status === 'Eliminated'
          ? 'eliminated'
          : player.status === 'Finished'
            ? 'finished'
            : 'registered';
      batch.set(
        doc(db, 'clubs', accountKey, 'tournamentRegistrations', player.registrationId),
        stripUndefinedForFirestore({
          status,
          rebuys: Number(player.rebuys ?? 0),
          addOns: Number(player.addOns ?? 0),
          updatedAt: serverTimestamp()
        }),
        { merge: true }
      );
    });
  });
  await batch.commit();
}

function toPlayerTournament(tournament: Record<string, any>) {
  const startsAt = tournament.scheduledAt || tournament.startedAt || tournament.createdAt || new Date().toISOString();
  const entrants = tournament.players ?? [];
  const prizePool = entrants.reduce((sum: number, player: Record<string, any>) =>
    sum + Number(player.buyIn ?? tournament.buyIn ?? 0)
      + Number(player.rebuys ?? 0) * Number(tournament.rebuyPrice ?? tournament.buyIn ?? 0)
      + Number(player.addOns ?? 0) * Number(tournament.addOnPrice ?? tournament.buyIn ?? 0), 0);
  return {
    id: tournament.id,
    name: tournament.name,
    startsAt,
    registrationOpensAt: tournament.registrationOpensAt || tournament.createdAt || new Date().toISOString(),
    registrationClosesAt: tournament.registrationClosesAt || startsAt,
    registrationStatus: tournament.registrationStatus || (tournament.status === 'Draft' ? 'open' : 'closed'),
    buyIn: Number(tournament.buyIn ?? 0),
    prizePoolLabel: tournament.prizePoolLabel || (prizePool ? `$${prizePool.toLocaleString()} current prize pool` : 'Prize pool updates as entries are recorded'),
    startingStack: Number(tournament.startingStack ?? 0),
    levelMinutes: Number(tournament.levels?.[0]?.durationMinutes ?? 20),
    lateRegistrationThroughLevel: Number(tournament.lateRegistrationThroughLevel ?? 0),
    rebuyPrice: Number(tournament.rebuyPrice ?? tournament.buyIn ?? 0),
    rebuyStack: Number(tournament.rebuyStack ?? tournament.startingStack ?? 0),
    unlimitedRebuys: Boolean(tournament.unlimitedRebuys ?? tournament.rebuyPrice),
    addOnPrice: Number(tournament.addOnPrice ?? 0),
    addOnStack: Number(tournament.addOnStack ?? tournament.startingStack ?? 0),
    rules: tournament.rules ?? ['House rules and staff decisions are final.'],
    unregisterAllowed: tournament.unregisterAllowed ?? tournament.status === 'Draft',
    entrantCount: entrants.length,
    totalRebuys: entrants.reduce((sum: number, player: Record<string, any>) => sum + Number(player.rebuys ?? 0), 0),
    totalAddOns: entrants.reduce((sum: number, player: Record<string, any>) => sum + Number(player.addOns ?? 0), 0),
    featured: Boolean(tournament.featured)
  };
}

function applyTournamentRegistrations(state: Record<string, any>, registrations: Record<string, any>[]) {
  if (!registrations.length) return state;
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((tournament: Record<string, any>) => {
      const existingIds = new Set((tournament.players ?? []).map((player: Record<string, any>) => player.registrationId || player.id));
      const additions = registrations
        .filter((registration) => registration.tournamentId === tournament.id && !existingIds.has(registration.id))
        .map((registration) => ({
          id: registration.id,
          registrationId: registration.id,
          profileId: registration.playerId,
          name: registration.playerName,
          email: registration.playerEmail,
          buyIn: Number(tournament.buyIn ?? 0),
          rebuys: Number(registration.rebuys ?? 0),
          addOns: Number(registration.addOns ?? 0),
          startingStack: Number(tournament.startingStack ?? 0),
          status: registration.status === 'checked-in' ? 'Checked In' : registration.status === 'eliminated' ? 'Eliminated' : 'Registered',
          registeredAt: registration.registeredAt || new Date().toISOString()
        }));
      return additions.length ? { ...tournament, players: [...(tournament.players ?? []), ...additions] } : tournament;
    })
  };
}

function applyRevenueTransactions(state: Record<string, any>, transactions: Record<string, any>[]) {
  if (!transactions.length) return state;
  const existing = new Map((state.revenueTransactions ?? []).map((transaction: Record<string, any>) => [transaction.id, transaction]));
  transactions.forEach((transaction) => existing.set(transaction.id, transaction));
  const paidMemberships = transactions.filter((transaction) => transaction.type === 'membership' && transaction.paymentStatus === 'paid');
  const profiles = [...(state.profiles ?? [])];
  paidMemberships.forEach((transaction) => {
    const profileIndex = profiles.findIndex((profile) =>
      profile.id === transaction.playerId ||
      (transaction.playerEmail && String(profile.notes || '').includes(transaction.playerEmail)) ||
      String(profile.name || '').toLowerCase() === String(transaction.playerName || '').toLowerCase()
    );
    const membershipStartDate = String(transaction.occurredAt || new Date().toISOString()).slice(0, 10);
    const membershipExpirationDate = addDays(membershipStartDate, transaction.membershipPlan === 'day' ? 1 : 30);
    if (profileIndex >= 0) {
      profiles[profileIndex] = {
        ...profiles[profileIndex],
        membershipStartDate,
        membershipExpirationDate,
        notes: profiles[profileIndex].notes || `Verified payment: ${transaction.playerEmail || transaction.playerId || ''}`
      };
    } else {
      profiles.push({
        id: transaction.playerId || transaction.id,
        name: transaction.playerName || transaction.playerEmail || 'Paid member',
        phone: '',
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: state.games?.[0]?.id || '',
        preferredGameIds: [],
        preferredStakes: '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Verified Stripe membership: ${transaction.playerEmail || transaction.playerId || ''}`
      });
    }
  });
  return { ...state, profiles, revenueTransactions: [...existing.values()] };
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

async function updatePlayerMembershipStatus(playerId: string | undefined, clubId: string, request: PlayerMembershipRequest) {
  if (!playerId) return;
  const requestedAt = request.requestedAt || new Date().toISOString();
  const membershipStart = requestedAt.slice(0, 10);
  const membershipExpiration = addDays(membershipStart, request.membershipDurationDays ?? 365);
  await setDoc(
    doc(db, 'clubs', clubId, 'memberships', playerId),
    {
      clubId,
      playerId,
      status: 'Active',
      requestedAt,
      joinedAt: membershipStart,
      expiresAt: membershipExpiration,
      planId: request.planId,
      planName: request.planName,
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
