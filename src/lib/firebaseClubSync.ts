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

type PlayerTournamentRegistrationStatus =
  | 'registered'
  | 'checked-in'
  | 'eliminated'
  | 'rebought'
  | 'add-on-purchased'
  | 'finished';

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
  rebuyPrice?: number;
  rebuyStack?: number;
  unlimitedRebuys?: boolean;
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
};

export type FirebaseSyncState = ManagementClubState & {
  tournaments: ManagementTournament[];
  revenueTransactions: ManagementRevenueTransaction[];
};

type ValidTournamentRegistration = {
  id: string;
  tournamentId: string;
  playerId: string;
  playerName: string;
  playerEmail?: string;
  status: PlayerTournamentRegistrationStatus;
  rebuys: number;
  addOns: number;
  registeredAt: string;
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

  const [registrationDocs, transactionDocs] = await Promise.all([
    withFirebaseTimeout(getDocs(collection(db, 'clubs', accountKey, 'tournamentRegistrations')), null),
    withFirebaseTimeout(getDocs(collection(db, 'clubs', accountKey, 'transactions')), null)
  ]);
  nextState = applyTournamentRegistrations(nextState, registrationDocs?.docs.map((item) => item.data()) ?? []);
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
  const publishedTournaments = (state.tournaments ?? []).map(toPlayerTournament);
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
  state.tournaments.forEach((tournament) => {
    tournament.players.forEach((player) => {
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

function toPlayerTournament(tournament: ManagementTournament) {
  const startsAt = tournament.scheduledAt || tournament.startedAt || tournament.createdAt || new Date().toISOString();
  const entrants = tournament.players;
  const prizePool = entrants.reduce((sum, player) =>
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
    totalRebuys: entrants.reduce((sum, player) => sum + Number(player.rebuys ?? 0), 0),
    totalAddOns: entrants.reduce((sum, player) => sum + Number(player.addOns ?? 0), 0),
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
const tournamentRegistrationStatuses: PlayerTournamentRegistrationStatus[] = [
  'registered',
  'checked-in',
  'eliminated',
  'rebought',
  'add-on-purchased',
  'finished'
];

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

function isTournamentRegistrationStatus(value: unknown): value is PlayerTournamentRegistrationStatus {
  return tournamentRegistrationStatuses.some((candidate) => candidate === value);
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

function parseTournamentRegistration(value: unknown): ValidTournamentRegistration | undefined {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.tournamentId) ||
    !isNonEmptyString(value.playerId) ||
    !isNonEmptyString(value.playerName) ||
    !isTournamentRegistrationStatus(value.status) ||
    typeof value.rebuys !== 'number' ||
    !Number.isFinite(value.rebuys) ||
    value.rebuys < 0 ||
    typeof value.addOns !== 'number' ||
    !Number.isFinite(value.addOns) ||
    value.addOns < 0 ||
    !isValidTimestamp(value.registeredAt)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    tournamentId: value.tournamentId,
    playerId: value.playerId,
    playerName: value.playerName,
    playerEmail: optionalString(value.playerEmail),
    status: value.status,
    rebuys: value.rebuys,
    addOns: value.addOns,
    registeredAt: value.registeredAt
  };
}

function uniqueAuthoritativeRecords<T extends { id: string }>(records: T[]) {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.id, (counts.get(record.id) ?? 0) + 1));
  return records.filter((record) => counts.get(record.id) === 1);
}

function toManagementTournamentStatus(
  status: PlayerTournamentRegistrationStatus,
  existingStatus?: ManagementTournamentPlayerStatus
): ManagementTournamentPlayerStatus {
  if (status === 'checked-in') return 'Checked In';
  if (status === 'eliminated') return 'Eliminated';
  if (status === 'finished') return 'Finished';
  if (status === 'rebought' || status === 'add-on-purchased') return existingStatus ?? 'Registered';
  return 'Registered';
}

function applyTournamentRegistrations(state: FirebaseSyncState, rawRegistrations: unknown[]): FirebaseSyncState {
  const registrations = uniqueAuthoritativeRecords(
    rawRegistrations.map(parseTournamentRegistration).filter((registration) => registration !== undefined)
  );
  if (!registrations.length) return state;

  let changed = false;
  const tournaments = state.tournaments.map((tournament) => {
    const registrationsById = new Map(
      registrations
        .filter((registration) => registration.tournamentId === tournament.id)
        .map((registration) => [registration.id, registration])
    );
    if (!registrationsById.size) return tournament;

    const players = tournament.players.map((player) => {
      const registrationId = player.registrationId ?? player.id;
      const registration = registrationsById.get(registrationId);
      if (!registration) return player;
      registrationsById.delete(registrationId);
      changed = true;
      return {
        ...player,
        registrationId: registration.id,
        profileId: registration.playerId,
        name: registration.playerName,
        email: registration.playerEmail ?? player.email,
        rebuys: registration.rebuys,
        addOns: registration.addOns,
        status: toManagementTournamentStatus(registration.status, player.status),
        registeredAt: registration.registeredAt
      };
    });
    const additions = [...registrationsById.values()].map((registration): ManagementTournamentPlayer => ({
      id: registration.id,
      registrationId: registration.id,
      profileId: registration.playerId,
      name: registration.playerName,
      email: registration.playerEmail,
      buyIn: tournament.buyIn,
      rebuys: registration.rebuys,
      addOns: registration.addOns,
      startingStack: tournament.startingStack,
      status: toManagementTournamentStatus(registration.status),
      registeredAt: registration.registeredAt
    }));
    if (!additions.length && players.every((player, index) => player === tournament.players[index])) return tournament;
    changed = true;
    return { ...tournament, players: [...players, ...additions] };
  });

  return changed ? { ...state, tournaments } : state;
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
        profiles[profileIndex] = {
          ...profile,
          membershipStartDate,
          membershipExpirationDate,
          notes: profile.notes || `Verified payment: ${transaction.playerEmail || transaction.playerId}`
        };
        return;
      }
      if (!transaction.playerName) return;
      const preferredGameId = state.games[0]?.id ?? '';
      profiles.push({
        id: transaction.playerId,
        name: transaction.playerName,
        phone: '',
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId,
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
  // The player profile mirror is secondary to the authoritative club request update.
  await setDoc(
    doc(db, 'clubs', clubId, 'memberships', playerId),
    {
      clubId,
      playerId,
      playerName: request.player.name,
      status: request.paymentMethod === 'in-person' ? 'Requested' : 'Active',
      requestedAt,
      joinedAt: request.paymentMethod === 'in-person' ? '' : requestedAt.slice(0, 10),
      expiresAt: request.paymentMethod === 'in-person'
        ? null
        : addDays(requestedAt.slice(0, 10), request.membershipDurationDays ?? 365),
      planId: request.planId,
      planName: request.planName,
      plan: request.plan,
      paymentMethod: request.paymentMethod,
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
