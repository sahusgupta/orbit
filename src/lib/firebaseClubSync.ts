import { initializeApp, getApps } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getDocs, initializeFirestore, getFirestore, doc, getDoc, onSnapshot, setDoc, serverTimestamp, updateDoc, writeBatch, type Unsubscribe } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';
import {
  decodeFirebaseClubStateRecord,
  decodeMembershipRequest,
  decodeWaitlistRequest,
  readFirebaseErrorCode,
  readPendingRequestMarker
} from './firebaseClubDecoders';
import {
  applyMembershipRequestToClubState,
  applyWaitlistRequestToClubState,
  buildPlayerClubSnapshot,
  getClubIdFromState,
  type ManagementClubState,
  type PlayerClubSnapshot,
  type PlayerMembershipRequest
} from './playerSync';

type RevenueTransactionType = 'membership' | 'time-package' | 'tournament_entry' | 'rebuy' | 'add_on' | 'refund' | 'other';
type RevenuePaymentStatus = 'paid' | 'refunded' | 'partially_refunded' | 'pending' | 'failed';
type RevenueSource = 'stripe' | 'manual' | 'import';

export type ManagementRevenueTransaction = {
  id: string;
  type: RevenueTransactionType;
  amountCents: number;
  occurredAt: string;
  paymentStatus: RevenuePaymentStatus;
  source: RevenueSource;
  playerId?: string;
  playerName?: string;
  playerEmail?: string;
  membershipPlan?: string | null;
  tournamentId?: string;
  stripeEventId?: string;
};

type ManagementTournamentPlayerStatus = 'Registered' | 'Checked In' | 'Active' | 'Eliminated' | 'Finished';

export type ManagementTournamentPlayer = {
  id: string;
  registrationId?: string;
  profileId?: string;
  name: string;
  phone?: string;
  email?: string;
  buyIn: number;
  rebuys: number;
  addOns: number;
  startingStack: number;
  currentStack?: number;
  status: ManagementTournamentPlayerStatus;
  registeredAt: string;
  eliminatedAt?: string;
  finishPlace?: number;
  tableNumber?: number;
  seatNumber?: number;
};

export type ManagementTournament = {
  id: string;
  name: string;
  status: 'Draft' | 'Running' | 'Paused' | 'Finished';
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  registrationOpensAt?: string;
  registrationClosesAt?: string;
  registrationStatus?: 'open' | 'closed';
  currentLevelIndex: number;
  buyIn: number;
  startingStack: number;
  rebuyPrizePercent: number;
  rebuysAllowed?: boolean;
  rebuyPrice?: number;
  rebuyStack?: number;
  unlimitedRebuys?: boolean;
  addOnsAllowed?: boolean;
  addOnPrice?: number;
  addOnStack?: number;
  lateRegistrationThroughLevel?: number;
  tableSize: number;
  levels: Array<{
    id: string;
    level: number;
    smallBlind: number;
    bigBlind: number;
    ante: number;
    durationMinutes: number;
    breakAfter: boolean;
    breakMinutes: number;
  }>;
  players: ManagementTournamentPlayer[];
  payouts: Array<{ place: number; percent: number }>;
  prizePoolLabel?: string;
  rules?: string[];
  unregisterAllowed?: boolean;
  featured?: boolean;
  buyInPublished?: boolean;
};

export type FirebaseSyncState = ManagementClubState & {
  tournaments: ManagementTournament[];
  revenueTransactions: ManagementRevenueTransaction[];
};

const firebaseSyncTimeoutMs = 2500;
const orbitSyncProtocolVersion = 2;

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

function createSyncRevision(savedAt: string) {
  const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${savedAt}:${nonce}`;
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

export async function sendFirebasePasswordResetEmail(email: string) {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
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
      if (readFirebaseErrorCode(createError) === 'auth/email-already-in-use') {
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

export async function saveClubStateToFirebase(state: FirebaseSyncState) {
  const user = await withFirebaseTimeout(ensureFirebaseSession(), null);
  if (!user) throw new Error('Firebase authentication timed out before synchronization.');
  const syncedState = await syncPlayerUpdatesToClubState(state);
  const accountKey = getClubIdFromState(syncedState);
  const savedAt = new Date().toISOString();
  const syncRevision = createSyncRevision(savedAt);
  const snapshot = buildPlayerClubSnapshot(syncedState);
  const record = {
    accountKey,
    savedAt,
    syncProtocolVersion: orbitSyncProtocolVersion,
    syncRevision,
    syncSource: 'orbit-desktop',
    state: stripUndefinedForFirestore(syncedState),
    snapshot: stripUndefinedForFirestore(snapshot),
    updatedAt: serverTimestamp()
  };
  return withFirebaseTimeout(
    setDoc(doc(db, 'clubStates', accountKey), record, { merge: true })
      .then(() => publishClubSnapshot(accountKey, snapshot, savedAt, syncedState, syncRevision))
      .then(() => ({ accountKey, savedAt, syncRevision, snapshot, synced: true })),
    { accountKey, savedAt, syncRevision, snapshot, synced: false }
  );
}

export async function loadClubStateFromFirebase(accountKey: string) {
  const user = await withFirebaseTimeout(ensureFirebaseSession(), null);
  if (!user) throw new Error('Firebase authentication timed out before synchronization.');
  const normalizedKey = accountKey.trim().toLowerCase();
  if (!normalizedKey) return null;
  const snapshot = await withFirebaseTimeout(getDoc(doc(db, 'clubStates', normalizedKey)), null);
  if (!snapshot) return null;
  if (!snapshot.exists()) return null;
  return decodeFirebaseClubStateRecord(snapshot.data());
}

export function syncPlayerUpdatesToClubState<TState extends FirebaseSyncState>(state: TState): Promise<TState>;
export async function syncPlayerUpdatesToClubState(state: FirebaseSyncState): Promise<FirebaseSyncState> {
  const accountKey = getClubIdFromState(state);
  let nextState = state;

  const membershipRequests = await fetchPendingRequestDocs(accountKey, 'membershipRequests');
  if (membershipRequests.length) {
    const appliedIds = new Set<string>();
    for (const requestDoc of membershipRequests) {
      const rawRequest = requestDoc.data();
      const marker = readPendingRequestMarker(rawRequest);
      if (marker.id && appliedIds.has(marker.id)) continue;
      if (marker.status === 'applied') continue;
      const request = decodeMembershipRequest(rawRequest);
      appliedIds.add(request.id);
      const updatedState = applyMembershipRequestToClubState(nextState, request);
      if (updatedState !== nextState) nextState = { ...nextState, ...updatedState };
      await updatePlayerMembershipStatus(request.player.id, accountKey, request);
      await markRequestApplied(accountKey, 'membershipRequests', request.id);
    }
  }

  const waitlistRequests = await fetchPendingRequestDocs(accountKey, 'waitlistRequests');
  if (waitlistRequests.length) {
    const appliedIds = new Set<string>();
    for (const requestDoc of waitlistRequests) {
      const rawRequest = requestDoc.data();
      const marker = readPendingRequestMarker(rawRequest);
      if (marker.id && appliedIds.has(marker.id)) continue;
      if (marker.status === 'applied') continue;
      const request = decodeWaitlistRequest(rawRequest);
      appliedIds.add(request.id);
      const updatedState = applyWaitlistRequestToClubState(nextState, request);
      if (updatedState !== nextState) nextState = { ...nextState, ...updatedState };
      await markRequestApplied(accountKey, 'waitlistRequests', request.id);
    }
  }

  const transactionDocs = await withFirebaseTimeout(
    getDocs(collection(db, 'clubs', accountKey, 'transactions')),
    null
  );
  nextState = applyRevenueTransactions(nextState, transactionDocs?.docs.map((item) => item.data()) ?? []);

  return nextState;
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
  unsubscribers.push(onSnapshot(collection(db, 'clubs', normalizedKey, 'transactions'), handleSnapshot, () => undefined));

  globalThis.setTimeout(() => {
    initialized = true;
    callback();
  }, 0);

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

async function publishClubSnapshot(
  accountKey: string,
  snapshot: PlayerClubSnapshot,
  savedAt: string,
  state: FirebaseSyncState,
  syncRevision: string
) {
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
  const publishedTournaments = (state.tournaments ?? []).flatMap((tournament) => {
    const published = toPlayerTournament(tournament);
    return published ? [published] : [];
  });
  const tournamentIds = new Set(publishedTournaments.map((tournament) => tournament.id));
  const syncMetadata = {
    syncProtocolVersion: orbitSyncProtocolVersion,
    syncRevision,
    syncSource: 'orbit-desktop',
    publishedAt: savedAt
  };
  batch.set(
    clubRef,
    stripUndefinedForFirestore({
      ...snapshot.club,
      social: snapshot.social,
      generatedAt: snapshot.generatedAt,
      savedAt,
      ...syncMetadata,
      entityCounts: {
        games: snapshot.games.length,
        memberships: snapshot.memberships.length,
        waitlists: snapshot.waitlists.length,
        notifications: (snapshot.notifications ?? []).length,
        tournaments: publishedTournaments.length
      },
      updatedAt: serverTimestamp()
    }),
    { merge: true }
  );
  snapshot.games.forEach((game) => {
    batch.set(doc(db, 'clubs', accountKey, 'games', game.id), stripUndefinedForFirestore({ ...game, ...syncMetadata, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingGames.docs.forEach((gameDoc) => {
    if (!gameIds.has(gameDoc.id)) batch.delete(gameDoc.ref);
  });
  snapshot.memberships.forEach((membership) => {
    batch.set(
      doc(db, 'clubs', accountKey, 'memberships', membership.playerId),
      stripUndefinedForFirestore({ ...membership, ...syncMetadata, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  });
  existingMemberships.docs.forEach((membershipDoc) => {
    if (!membershipIds.has(membershipDoc.id)) batch.delete(membershipDoc.ref);
  });
  snapshot.waitlists.forEach((entry) => {
    batch.set(doc(db, 'clubs', accountKey, 'waitlists', entry.id), stripUndefinedForFirestore({ ...entry, ...syncMetadata, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingWaitlists.docs.forEach((waitlistDoc) => {
    if (!waitlistIds.has(waitlistDoc.id)) batch.delete(waitlistDoc.ref);
  });
  (snapshot.notifications ?? []).forEach((notification) => {
    batch.set(doc(db, 'clubs', accountKey, 'notifications', notification.id), stripUndefinedForFirestore({ ...notification, ...syncMetadata, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingNotifications.docs.forEach((notificationDoc) => {
    if (!notificationIds.has(notificationDoc.id)) batch.delete(notificationDoc.ref);
  });
  publishedTournaments.forEach((tournament) => {
    batch.set(doc(db, 'clubs', accountKey, 'tournaments', tournament.id), stripUndefinedForFirestore({ ...tournament, ...syncMetadata, updatedAt: serverTimestamp() }), { merge: true });
  });
  existingTournaments.docs.forEach((tournamentDoc) => {
    if (!tournamentIds.has(tournamentDoc.id)) batch.delete(tournamentDoc.ref);
  });
  await batch.commit();
}

function isPublishedNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function toPlayerTournament(tournament: ManagementTournament) {
  const startsAt = tournament.scheduledAt || tournament.startedAt;
  const interestOpensAt = tournament.registrationOpensAt;
  const interestClosesAt = tournament.registrationClosesAt;
  const startsAtMs = Date.parse(startsAt || '');
  const interestOpensAtMs = Date.parse(interestOpensAt || '');
  const interestClosesAtMs = Date.parse(interestClosesAt || '');
  if (
    tournament.status !== 'Draft' ||
    !tournament.id.trim() ||
    !tournament.name.trim() ||
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(interestOpensAtMs) ||
    !Number.isFinite(interestClosesAtMs) ||
    startsAtMs <= Date.now() ||
    interestOpensAtMs >= interestClosesAtMs ||
    interestClosesAtMs > startsAtMs ||
    !isPublishedNumber(tournament.buyIn) ||
    !isPublishedNumber(tournament.startingStack)
  ) return null;
  const entrants = tournament.players;
  const rebuysAllowed = tournament.rebuysAllowed === true;
  const addOnsAllowed = tournament.addOnsAllowed === true;
  return {
    id: tournament.id,
    name: tournament.name,
    startsAt,
    interestOpensAt,
    interestClosesAt,
    // Explicit venue intent stays live across future window boundaries. Player
    // clients and the API mutation service independently enforce the timestamps.
    interestStatus: tournament.registrationStatus === 'open' ? 'open' : 'closed',
    buyIn: tournament.buyIn,
    buyInPublished: true,
    ...(typeof tournament.prizePoolLabel === 'string' && tournament.prizePoolLabel.trim()
      ? { prizePoolLabel: tournament.prizePoolLabel.trim() }
      : {}),
    startingStack: tournament.startingStack,
    ...(isPublishedNumber(tournament.levels?.[0]?.durationMinutes, 0, 1440)
      ? { levelMinutes: tournament.levels[0].durationMinutes }
      : {}),
    ...(isPublishedNumber(tournament.lateRegistrationThroughLevel, 0, 1000)
      ? { lateRegistrationThroughLevel: tournament.lateRegistrationThroughLevel }
      : {}),
    rebuysAllowed,
    ...(rebuysAllowed && isPublishedNumber(tournament.rebuyPrice) ? { rebuyPrice: tournament.rebuyPrice } : {}),
    ...(rebuysAllowed && isPublishedNumber(tournament.rebuyStack) ? { rebuyStack: tournament.rebuyStack } : {}),
    unlimitedRebuys: rebuysAllowed && tournament.unlimitedRebuys === true,
    addOnsAllowed,
    ...(addOnsAllowed && isPublishedNumber(tournament.addOnPrice) ? { addOnPrice: tournament.addOnPrice } : {}),
    ...(addOnsAllowed && isPublishedNumber(tournament.addOnStack) ? { addOnStack: tournament.addOnStack } : {}),
    rules: Array.isArray(tournament.rules) ? tournament.rules.slice(0, 100) : [],
    withdrawalAllowed: tournament.unregisterAllowed === true,
    entrantCount: entrants.length,
    ...(entrants.every((player) => isPublishedNumber(player.rebuys))
      ? { totalRebuys: entrants.reduce((sum, player) => sum + Number(player.rebuys), 0) }
      : {}),
    ...(entrants.every((player) => isPublishedNumber(player.addOns))
      ? { totalAddOns: entrants.reduce((sum, player) => sum + Number(player.addOns), 0) }
      : {}),
    featured: Boolean(tournament.featured)
  };
}

const revenueTransactionTypes: RevenueTransactionType[] = [
  'membership',
  'time-package',
  'tournament_entry',
  'rebuy',
  'add_on',
  'refund',
  'other'
];
const revenuePaymentStatuses: RevenuePaymentStatus[] = ['paid', 'refunded', 'partially_refunded', 'pending', 'failed'];
const revenueSources: RevenueSource[] = ['stripe', 'manual', 'import'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isRevenueTransactionType(value: unknown): value is RevenueTransactionType {
  return revenueTransactionTypes.some((candidate) => candidate === value);
}

function isRevenuePaymentStatus(value: unknown): value is RevenuePaymentStatus {
  return revenuePaymentStatuses.some((candidate) => candidate === value);
}

function isRevenueSource(value: unknown): value is RevenueSource {
  return revenueSources.some((candidate) => candidate === value);
}

function optionalString(value: unknown) {
  return isNonEmptyString(value) ? value : undefined;
}

function parseRevenueTransaction(value: unknown): ManagementRevenueTransaction | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isRevenueTransactionType(value.type) ||
    typeof value.amountCents !== 'number' ||
    !Number.isFinite(value.amountCents) ||
    !isValidTimestamp(value.occurredAt) ||
    !isRevenuePaymentStatus(value.paymentStatus) ||
    !isRevenueSource(value.source)
  ) {
    return undefined;
  }
  return {
    ...value,
    id: value.id,
    type: value.type,
    amountCents: value.amountCents,
    occurredAt: value.occurredAt,
    paymentStatus: value.paymentStatus,
    source: value.source,
    playerId: optionalString(value.playerId),
    playerName: optionalString(value.playerName),
    playerEmail: optionalString(value.playerEmail),
    membershipPlan: value.membershipPlan === null ? null : optionalString(value.membershipPlan),
    tournamentId: optionalString(value.tournamentId),
    stripeEventId: optionalString(value.stripeEventId)
  };
}

function uniqueAuthoritativeRecords<T extends { id: string }>(records: T[]) {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.id, (counts.get(record.id) ?? 0) + 1));
  return records.filter((record) => counts.get(record.id) === 1);
}

function applyRevenueTransactions(state: FirebaseSyncState, rawTransactions: unknown[]): FirebaseSyncState {
  const transactions = uniqueAuthoritativeRecords(
    rawTransactions.map(parseRevenueTransaction).filter((transaction) => transaction !== undefined)
  );
  if (!transactions.length) return state;

  const existing = new Map(state.revenueTransactions.map((transaction) => [transaction.id, transaction]));
  transactions.forEach((transaction) => existing.set(transaction.id, transaction));
  const profiles = [...state.profiles];
  transactions
    .filter((transaction) => transaction.type === 'membership' && transaction.paymentStatus === 'paid')
    .forEach((transaction) => {
      if (!transaction.playerId || (transaction.membershipPlan !== 'day' && transaction.membershipPlan !== 'monthly')) return;
      const profileIndex = profiles.findIndex((profile) => profile.id === transaction.playerId);
      const membershipStartDate = transaction.occurredAt.slice(0, 10);
      const membershipExpirationDate = addDays(membershipStartDate, transaction.membershipPlan === 'day' ? 1 : 30);
      if (profileIndex >= 0) {
        const profile = profiles[profileIndex];
        const identityReady = profile.identityReviewStatus === 'Approved' || profile.identityReviewStatus === 'Not required';
        profiles[profileIndex] = {
          ...profile,
          membershipStartDate: identityReady ? membershipStartDate : '',
          membershipExpirationDate: identityReady ? membershipExpirationDate : '',
          membershipExpiresAt: identityReady ? `${membershipExpirationDate}T23:59:59.999Z` : undefined,
          membershipStatus: identityReady ? 'Active' : 'Approved',
          membershipPaymentStatus: 'Paid',
          membershipPaymentTransactionId: transaction.id,
          membershipPaymentAmountCents: transaction.amountCents,
          notes: profile.notes || `Verified payment: ${transaction.playerEmail || transaction.playerId}`
        };
        return;
      }
      if (!transaction.playerName) return;
      profiles.push({
        id: transaction.playerId,
        name: transaction.playerName,
        phone: '',
        birthday: '',
        membershipStartDate: '',
        membershipExpirationDate: '',
        membershipPlan: transaction.membershipPlan,
        membershipPaymentMethod: 'app',
        membershipStatus: 'Approved',
        membershipPaymentStatus: 'Paid',
        membershipPaymentTransactionId: transaction.id,
        membershipPaymentAmountCents: transaction.amountCents,
        identityReviewStatus: 'Pending',
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: '',
        preferredGameIds: [],
        preferredStakes: '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Verified Stripe membership: ${transaction.playerEmail || transaction.playerId}`
      });
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
  const acknowledgement = {
    status: 'applied',
    appliedAt: serverTimestamp(),
    appliedBy: 'orbit-desktop',
    syncProtocolVersion: orbitSyncProtocolVersion
  };
  // Current and legacy request aliases are independent; one missing alias must not block the other acknowledgement.
  await Promise.all([
    updateDoc(doc(db, 'clubs', accountKey, collectionName, requestId), acknowledgement).catch(() => undefined),
    updateDoc(doc(db, 'clubStates', accountKey, collectionName, requestId), acknowledgement).catch(() => undefined)
  ]);
}

async function updatePlayerMembershipStatus(playerId: string | undefined, clubId: string, request: PlayerMembershipRequest) {
  if (!playerId) return;
  const requestedAt = request.requestedAt || new Date().toISOString();
  const priceLabel = request.planPriceLabel ?? request.priceLabel ?? '';
  const paymentNotRequired = /\bfree\b/i.test(priceLabel) || /(?:^|\D)0(?:\.0+)?(?:\D|$)/.test(priceLabel);
  // The player profile mirror is secondary to the authoritative club request update.
  await setDoc(
    doc(db, 'clubs', clubId, 'memberships', playerId),
    {
      clubId,
      playerId,
      playerName: request.player.name,
      status: 'Approved',
      requestedAt,
      joinedAt: '',
      expiresAt: null,
      planId: request.planId,
      planName: request.planName,
      plan: request.plan,
      paymentMethod: request.paymentMethod,
      paymentStatus: paymentNotRequired ? 'Not required' : 'Pending',
      identityReviewStatus: 'Pending',
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
