import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  type User
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type QueryDocumentSnapshot,
  type Unsubscribe
} from 'firebase/firestore';
import type {
  PlayerAccount,
  PlayerClubMembershipRecord,
  PlayerClubSnapshot,
  PlayerMembershipRequest,
  PlayerPrivateGameListing,
  PlayerProfileDocument,
  PlayerWaitlistRequest
} from '../domain/playerSync';
import { getPlayerLoyalty } from '../domain/playerSync';
import { firebaseConfig } from './firebaseConfig';

type ClubStateRecord = {
  accountKey: string;
  savedAt: string;
  snapshot: PlayerClubSnapshot;
  state?: Record<string, any>;
};

type PublishedClubRecord = PlayerClubSnapshot['club'] & {
  social?: PlayerClubSnapshot['social'];
  generatedAt?: string;
  savedAt?: string;
};

type SyncResult =
  | { ok: true; snapshot: PlayerClubSnapshot; accountKey: string; savedAt?: string }
  | { ok: false; error: string };

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export const syncBaseUrl = `firebase://${firebaseConfig.projectId}/clubs`;

export function isSyncConfigured() {
  return true;
}

export type FirebasePlayerIdentity = {
  uid: string;
  email: string;
  name: string;
  photoUrl?: string;
};

export function getCurrentFirebasePlayer() {
  return auth.currentUser ? toFirebasePlayerIdentity(auth.currentUser) : null;
}

export function onFirebasePlayerChanged(callback: (identity: FirebasePlayerIdentity | null) => void) {
  return onAuthStateChanged(auth, (user) => callback(user ? toFirebasePlayerIdentity(user) : null));
}

export async function signInWithGoogleIdToken(idToken: string) {
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  return toFirebasePlayerIdentity(result.user);
}

export function ensureSignedInIdentity() {
  const identity = getCurrentFirebasePlayer();
  if (!identity) {
    throw new Error('Google sign-in is required before syncing with Firebase.');
  }
  return identity.uid;
}

export async function savePlayerProfile(player: PlayerAccount, membershipPatch?: PlayerClubMembershipRecord) {
  const uid = ensureSignedInIdentity();
  const profileRef = doc(db, 'players', uid);
  const existing = await getDoc(profileRef);
  const existingData = existing.exists() ? (existing.data() as Partial<PlayerProfileDocument>) : {};
  const clubMemberships = {
    ...(existingData.clubMemberships ?? {}),
    ...(membershipPatch ? { [membershipPatch.clubId]: membershipPatch } : {})
  };
  const profile: PlayerProfileDocument = {
    ...player,
    id: uid,
    uid,
    name: player.name,
    email: player.email,
    preferredGameIds: player.preferredGameIds,
    preferredStakes: player.preferredStakes,
    typicalAvailability: player.typicalAvailability,
    homeLocation: player.homeLocation,
    searchRadiusMiles: player.searchRadiusMiles,
    clubMemberships,
    updatedAt: new Date().toISOString()
  };

  await setDoc(
    profileRef,
    {
      ...profile,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return profile;
}

export async function fetchPlayerProfile() {
  const uid = ensureSignedInIdentity();
  const snapshot = await getDoc(doc(db, 'players', uid));
  return snapshot.exists() ? (snapshot.data() as PlayerProfileDocument) : null;
}

export async function updatePlayerClubMembership(player: PlayerAccount, membership: PlayerClubMembershipRecord) {
  return savePlayerProfile(player, membership);
}

export async function fetchClubSnapshot(player: Pick<PlayerAccount, 'id' | 'name'>, accountKey?: string): Promise<SyncResult> {
  try {
    const record = accountKey ? await getClubState(accountKey) : await getFirstClubState();
    if (!record) return { ok: false, error: 'No Firebase club state has been published by the management app yet.' };
    return {
      ok: true,
      accountKey: record.accountKey,
      savedAt: record.savedAt,
      snapshot: filterSnapshotForPlayer(record.snapshot, player)
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to read Firebase sync.' };
  }
}

export async function fetchClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>): Promise<SyncResult> {
  try {
    const snapshots = await getDocs(collection(db, 'clubStates'));
    const clubs = snapshots.docs
      .map((snapshot) => snapshot.data() as ClubStateRecord)
      .filter((record) => record.snapshot)
      .map((record) => filterSnapshotForPlayer(record.snapshot, player));
    if (!clubs.length) return { ok: false, error: 'No card houses have been published yet.' };
    return {
      ok: true,
      accountKey: clubs[0].club.id,
      savedAt: new Date().toISOString(),
      snapshot: mergeClubSnapshots(clubs)
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to read Firebase clubs.' };
  }
}

export async function fetchAllClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  try {
    const publishedClubs = await getPublishedClubSnapshots(player);
    if (publishedClubs.length) return { ok: true as const, clubs: publishedClubs };
    const clubs = await getLegacyClubSnapshots(player);
    return { ok: true as const, clubs };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to read Firebase clubs.' };
  }
}

export function subscribeToAllClubSnapshots(
  player: Pick<PlayerAccount, 'id' | 'name'>,
  callback: (result: { ok: true; clubs: PlayerClubSnapshot[] } | { ok: false; error: string }) => void
) {
  const childUnsubscribers = new Map<string, Unsubscribe[]>();
  const clubIds = new Set<string>();
  let disposed = false;
  let latestClubs = new Map<string, PlayerClubSnapshot>();

  const emit = () => {
    if (disposed) return;
    const clubs = Array.from(latestClubs.values()).filter((snapshot) => snapshot.games.length || snapshot.memberships.length || snapshot.waitlists.length);
    callback({ ok: true, clubs });
  };

  const detachClub = (clubId: string) => {
    childUnsubscribers.get(clubId)?.forEach((unsubscribe) => unsubscribe());
    childUnsubscribers.delete(clubId);
    latestClubs.delete(clubId);
  };

  const parentUnsubscribe = onSnapshot(
    collection(db, 'clubs'),
    (clubsSnapshot) => {
      const nextClubIds = new Set(clubsSnapshot.docs.map((clubDoc) => clubDoc.id));
      for (const clubId of clubIds) {
        if (!nextClubIds.has(clubId)) {
          detachClub(clubId);
          clubIds.delete(clubId);
        }
      }

      clubsSnapshot.docs.forEach((clubDoc) => {
        if (clubIds.has(clubDoc.id)) {
          const current = latestClubs.get(clubDoc.id);
          if (current) {
            latestClubs.set(clubDoc.id, buildPublishedClubSnapshot(clubDoc, current.games, current.memberships, current.waitlists, player));
            emit();
          }
          return;
        }

        clubIds.add(clubDoc.id);
        const childState = {
          games: [] as PlayerClubSnapshot['games'],
          memberships: [] as PlayerClubSnapshot['memberships'],
          waitlists: [] as PlayerClubSnapshot['waitlists']
        };
        const updateClub = () => {
          latestClubs.set(clubDoc.id, buildPublishedClubSnapshot(clubDoc, childState.games, childState.memberships, childState.waitlists, player));
          emit();
        };
        const unsubscribers = [
          onSnapshot(collection(db, 'clubs', clubDoc.id, 'games'), (snapshot) => {
            childState.games = snapshot.docs.map((gameDoc) => gameDoc.data() as PlayerClubSnapshot['games'][number]);
            updateClub();
          }),
          onSnapshot(playerScopedCollection(clubDoc.id, 'memberships', player.id), (snapshot) => {
            childState.memberships = snapshot.docs.map((membershipDoc) => membershipDoc.data() as PlayerClubSnapshot['memberships'][number]);
            updateClub();
          }),
          onSnapshot(playerScopedCollection(clubDoc.id, 'waitlists', player.id), (snapshot) => {
            childState.waitlists = snapshot.docs.map((waitlistDoc) => waitlistDoc.data() as PlayerClubSnapshot['waitlists'][number]);
            updateClub();
          })
        ];
        childUnsubscribers.set(clubDoc.id, unsubscribers);
        updateClub();
      });
    },
    (error) => callback({ ok: false, error: error.message || 'Unable to subscribe to Firebase clubs.' })
  );

  return () => {
    disposed = true;
    parentUnsubscribe();
    childUnsubscribers.forEach((unsubscribers) => unsubscribers.forEach((unsubscribe) => unsubscribe()));
    childUnsubscribers.clear();
  };
}

export async function fetchPrivateGameListings() {
  try {
    const snapshots = await getDocs(collection(db, 'privateGames'));
    const games = snapshots.docs
      .map((snapshot) => snapshot.data() as PlayerPrivateGameListing)
      .filter((game) => game.status === 'Open')
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { ok: true as const, games };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to read private games.' };
  }
}

export function subscribeToPrivateGameListings(
  callback: (result: { ok: true; games: PlayerPrivateGameListing[] } | { ok: false; error: string }) => void
) {
  return onSnapshot(
    collection(db, 'privateGames'),
    (snapshots) => {
      const games = snapshots.docs
        .map((snapshot) => snapshot.data() as PlayerPrivateGameListing)
        .filter((game) => game.status === 'Open')
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      callback({ ok: true, games });
    },
    (error) => callback({ ok: false, error: error.message || 'Unable to subscribe to private games.' })
  );
}

export async function submitPrivateGameListing(listing: PlayerPrivateGameListing) {
  try {
    await setDoc(
      doc(db, 'privateGames', listing.id),
      {
        ...listing,
        updatedAt: serverTimestamp()
      },
      { merge: false }
    );
    return { ok: true as const, game: listing };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to list private game.' };
  }
}

export async function submitMembershipRequest(request: PlayerMembershipRequest): Promise<SyncResult> {
  try {
    const localPlayerId = request.player.id || stableLocalPlayerId(request.player.email, request.player.name);
    const secureRequest = { ...request, player: { ...request.player, id: localPlayerId } };
    const membershipRecord: PlayerClubMembershipRecord = {
      clubId: request.clubId,
      status: 'Requested',
      requestedAt: request.requestedAt,
      preferredGameIds: request.player.preferredGameIds,
      preferredStakes: request.player.preferredStakes
    };
    if (auth.currentUser) {
      await savePlayerProfile({ ...request.player, id: auth.currentUser.uid }, membershipRecord);
    }
    await writeRequestToClubPaths(request.clubId, 'membershipRequests', request.id, secureRequest);
    const updated = await applyMembershipToLegacySnapshot(secureRequest);
    if (updated) return { ok: true, ...updated };
    const snapshot = await readAnyClubSnapshot(request.clubId, secureRequest.player);
    if (!snapshot) throw new Error('Membership request was sent, but no published club snapshot was found.');
    return { ok: true, accountKey: request.clubId, savedAt: snapshot.generatedAt, snapshot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to submit membership request.' };
  }
}

export async function submitWaitlistRequest(request: PlayerWaitlistRequest): Promise<SyncResult> {
  try {
    const localPlayerId = request.player.id || stableLocalPlayerId(request.player.email, request.player.name);
    const secureRequest = { ...request, player: { ...request.player, id: localPlayerId } };
    await writeRequestToClubPaths(request.clubId, 'waitlistRequests', request.id, secureRequest);
    const snapshot = await readAnyClubSnapshot(request.clubId, secureRequest.player);
    if (!snapshot) throw new Error('Seat request was sent, but no published club snapshot was found.');
    return {
      ok: true,
      accountKey: request.clubId,
      savedAt: snapshot.generatedAt,
      snapshot: applyWaitlistToSnapshot(snapshot, secureRequest)
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to submit waitlist request.' };
  }
}

function stableLocalPlayerId(email: string | undefined, name: string) {
  return `local_${(email || name || 'player')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'player'}`;
}

async function applyMembershipToLegacySnapshot(secureRequest: PlayerMembershipRequest) {
  const ref = doc(db, 'clubStates', secureRequest.clubId);
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists()) return null;
    const record = current.data() as ClubStateRecord;
    const snapshot = applyMembershipToSnapshot(record.snapshot, secureRequest);
    const savedAt = new Date().toISOString();
    transaction.set(
      ref,
      {
        accountKey: secureRequest.clubId,
        savedAt,
        snapshot,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    return { accountKey: secureRequest.clubId, savedAt, snapshot };
  });
}

async function applyWaitlistToLegacySnapshot(secureRequest: PlayerWaitlistRequest) {
  const ref = doc(db, 'clubStates', secureRequest.clubId);
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists()) return null;
    const record = current.data() as ClubStateRecord;
    const snapshot = applyWaitlistToSnapshot(record.snapshot, secureRequest);
    const savedAt = new Date().toISOString();
    transaction.set(
      ref,
      {
        accountKey: secureRequest.clubId,
        savedAt,
        snapshot,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
    return { accountKey: secureRequest.clubId, savedAt, snapshot };
  });
}

async function getPublishedClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  const clubDocs = await getDocs(collection(db, 'clubs'));
  const snapshots = await Promise.all(clubDocs.docs.map((clubDoc) => getPublishedClubSnapshot(clubDoc, player)));
  return snapshots.filter((snapshot) => snapshot.games.length || snapshot.memberships.length || snapshot.waitlists.length);
}

async function readAnyClubSnapshot(clubId: string, player: Pick<PlayerAccount, 'id' | 'name'>) {
  const publishedClub = await getDoc(doc(db, 'clubs', clubId));
  if (publishedClub.exists()) {
    const [snapshot] = await Promise.all([getPublishedClubSnapshot(publishedClub, player)]);
    return snapshot;
  }
  const legacy = await getClubState(clubId);
  return legacy?.snapshot ? filterSnapshotForPlayer(legacy.snapshot, player) : null;
}

async function getPublishedClubSnapshot(clubDoc: QueryDocumentSnapshot, player: Pick<PlayerAccount, 'id' | 'name'>) {
  const club = clubDoc.data() as PublishedClubRecord;
  const [games, memberships, waitlists] = await Promise.all([
    getDocs(collection(db, 'clubs', clubDoc.id, 'games')),
    getDocs(playerScopedCollection(clubDoc.id, 'memberships', player.id)),
    getDocs(playerScopedCollection(clubDoc.id, 'waitlists', player.id))
  ]);
  const snapshot: PlayerClubSnapshot = {
    club: {
      id: club.id || clubDoc.id,
      name: club.name || 'Local Poker Club',
      address: club.address,
      phone: club.phone
    },
    games: games.docs.map((gameDoc) => gameDoc.data() as PlayerClubSnapshot['games'][number]),
    memberships: memberships.docs.map((membershipDoc) => membershipDoc.data() as PlayerClubSnapshot['memberships'][number]),
    waitlists: waitlists.docs.map((waitlistDoc) => waitlistDoc.data() as PlayerClubSnapshot['waitlists'][number]),
    social: club.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
    generatedAt: club.generatedAt ?? club.savedAt ?? new Date().toISOString()
  };
  return filterSnapshotForPlayer(snapshot, player);
}

function buildPublishedClubSnapshot(
  clubDoc: QueryDocumentSnapshot,
  games: PlayerClubSnapshot['games'],
  memberships: PlayerClubSnapshot['memberships'],
  waitlists: PlayerClubSnapshot['waitlists'],
  player: Pick<PlayerAccount, 'id' | 'name'>
) {
  const club = clubDoc.data() as PublishedClubRecord;
  return filterSnapshotForPlayer(
    {
      club: {
        id: club.id || clubDoc.id,
        name: club.name || 'Local Poker Club',
        address: club.address,
        phone: club.phone
      },
      games,
      memberships,
      waitlists,
      social: club.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
      generatedAt: club.generatedAt ?? club.savedAt ?? new Date().toISOString()
    },
    player
  );
}

async function getLegacyClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  const snapshots = await getDocs(collection(db, 'clubStates'));
  return snapshots.docs
    .map((snapshot) => snapshot.data() as ClubStateRecord)
    .filter((record) => record.snapshot)
    .map((record) => filterSnapshotForPlayer(record.snapshot, player));
}

async function writeRequestToClubPaths(clubId: string, collectionName: 'membershipRequests' | 'waitlistRequests', requestId: string, request: PlayerMembershipRequest | PlayerWaitlistRequest) {
  await Promise.all([
    setDoc(doc(db, 'clubs', clubId, collectionName, requestId), { ...request, status: 'pending', createdAt: serverTimestamp() }, { merge: true }),
    setDoc(doc(db, 'clubStates', clubId, collectionName, requestId), { ...request, status: 'pending', createdAt: serverTimestamp() }, { merge: true })
  ]);
}

async function getClubState(accountKey: string) {
  const snapshot = await getDoc(doc(db, 'clubStates', accountKey.trim().toLowerCase()));
  return snapshot.exists() ? (snapshot.data() as ClubStateRecord) : null;
}

async function getFirstClubState() {
  const snapshots = await getDocs(collection(db, 'clubStates'));
  const first = snapshots.docs[0];
  return first ? (first.data() as ClubStateRecord) : null;
}

function mergeClubSnapshots(clubs: PlayerClubSnapshot[]): PlayerClubSnapshot {
  const [first, ...rest] = clubs;
  return {
    ...first,
    club: { id: '__all__', name: 'All Clubs' },
    games: clubs.flatMap((club) => club.games),
    memberships: clubs.flatMap((club) => club.memberships),
    waitlists: clubs.flatMap((club) => club.waitlists),
    social: clubs.reduce(
      (summary, club) => ({
        activePlayerCount: summary.activePlayerCount + (club.social?.activePlayerCount ?? 0),
        adminCount: summary.adminCount + (club.social?.adminCount ?? 0),
        knownPlayersInHouse: summary.knownPlayersInHouse + (club.social?.knownPlayersInHouse ?? 0),
        waitlistCount: summary.waitlistCount + (club.social?.waitlistCount ?? 0)
      }),
      { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 }
    ),
    generatedAt: new Date().toISOString(),
    // Keep the original club snapshots available to callers through the normal state merge path.
    ...(rest.length ? {} : {})
  };
}

function filterSnapshotForPlayer(snapshot: PlayerClubSnapshot, player: Pick<PlayerAccount, 'id' | 'name'>): PlayerClubSnapshot {
  const id = normalizeIdentity(player.id);
  const name = normalizeIdentity(player.name);
  return {
    ...snapshot,
    memberships: snapshot.memberships.filter((membership) =>
      Boolean(id && normalizeIdentity(membership.playerId) === id) ||
      Boolean(name && normalizeIdentity(membership.playerName) === name)
    ),
    waitlists: snapshot.waitlists.filter((entry) =>
      Boolean(id && normalizeIdentity(entry.playerId) === id) ||
      Boolean(name && normalizeIdentity(entry.playerName) === name)
    )
  };
}

function playerScopedCollection(clubId: string, collectionName: 'memberships' | 'waitlists', playerId?: string) {
  return query(collection(db, 'clubs', clubId, collectionName), where('playerId', '==', playerId || '__none__'));
}

function normalizeIdentity(value?: string) {
  return (value ?? '').trim().toLowerCase();
}

function applyMembershipToSnapshot(snapshot: PlayerClubSnapshot, request: PlayerMembershipRequest): PlayerClubSnapshot {
  if (snapshot.memberships.some((membership) => membership.playerId === request.player.id)) return snapshot;
  return {
    ...snapshot,
    memberships: [
      ...snapshot.memberships,
      {
        id: `${request.clubId}:${request.player.id}`,
        clubId: request.clubId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: 'Requested',
        joinedAt: request.requestedAt.slice(0, 10),
        loyalty: getPlayerLoyalty(request.clubId, 0),
        preferredGameIds: request.player.preferredGameIds,
        preferredStakes: request.player.preferredStakes,
        clubNote: request.player.typicalAvailability
      }
    ],
    generatedAt: request.requestedAt
  };
}

function applyWaitlistToSnapshot(snapshot: PlayerClubSnapshot, request: PlayerWaitlistRequest): PlayerClubSnapshot {
  if (snapshot.waitlists.some((entry) => entry.playerId === request.player.id && entry.gameId === request.gameId)) return snapshot;
  const position = snapshot.waitlists.filter((entry) => entry.gameId === request.gameId).length + 1;
  return {
    ...snapshot,
    games: snapshot.games.map((game) => (game.id === request.gameId ? { ...game, waitlistCount: game.waitlistCount + 1 } : game)),
    social: {
      ...(snapshot.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: snapshot.waitlists.length }),
      waitlistCount: (snapshot.social?.waitlistCount ?? snapshot.waitlists.length) + 1
    },
    waitlists: [
      ...snapshot.waitlists,
      {
        id: request.id,
        clubId: request.clubId,
        gameId: request.gameId,
        tableId: request.tableId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: 'Interested',
        position,
        requestedAt: request.requestedAt
      }
    ],
    generatedAt: request.requestedAt
  };
}

function applyMembershipToState(state: Record<string, any>, request: PlayerMembershipRequest) {
  const profiles = Array.isArray(state.profiles) ? state.profiles : [];
  const player = request.player;
  const existing = profiles.find((profile) => profile.id === player.id || String(profile.name || '').toLowerCase() === player.name.toLowerCase());
  const membershipStartDate = request.requestedAt.slice(0, 10);
  const membershipExpirationDate = addDays(membershipStartDate, 365);
  if (existing) {
    return {
      ...state,
      profiles: profiles.map((profile) =>
        profile.id === existing.id
          ? {
              ...profile,
              membershipStartDate: profile.membershipStartDate || membershipStartDate,
              membershipExpirationDate: profile.membershipExpirationDate || membershipExpirationDate,
              preferredGameId: player.preferredGameIds[0] || profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...player.preferredGameIds]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability
            }
          : profile
      )
    };
  }
  return {
    ...state,
    profiles: [
      ...profiles,
      {
        id: player.id,
        name: player.name,
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: player.preferredGameIds[0] || state.games?.[0]?.id || '',
        preferredGameIds: player.preferredGameIds,
        preferredStakes: player.preferredStakes || '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability || '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Player app: ${player.email}${player.phone ? `, ${player.phone}` : ''}`
      }
    ]
  };
}

function applyWaitlistToState(state: Record<string, any>, request: PlayerWaitlistRequest) {
  const interests = Array.isArray(state.interests) ? state.interests : [];
  if (
    interests.some(
      (interest) =>
        interest.gameId === request.gameId &&
        ['Interested', 'Confirmed Coming', 'Arrived'].includes(interest.status) &&
        (interest.profileId === request.player.id || String(interest.playerName || '').toLowerCase() === request.player.name.toLowerCase())
    )
  ) {
    return state;
  }
  return {
    ...state,
    interests: [
      ...interests,
      {
        id: request.id,
        profileId: request.player.id,
        playerName: request.player.name,
        gameId: request.gameId,
        status: 'Interested',
        timestamp: request.requestedAt,
        interestedAt: request.requestedAt,
        notes: request.note || 'Requested from player app'
      }
    ]
  };
}

function addDays(date: string, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function mergeUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toFirebasePlayerIdentity(user: User): FirebasePlayerIdentity {
  return {
    uid: user.uid,
    email: user.email ?? '',
    name: user.displayName ?? user.email?.split('@')[0] ?? 'Player',
    photoUrl: user.photoURL ?? undefined
  };
}
