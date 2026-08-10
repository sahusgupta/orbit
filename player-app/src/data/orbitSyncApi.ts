import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration,
  PlayerProfileDocument,
  PlayerWaitlistRequest
} from '../domain/playerSync';
import { getPlayerLoyalty } from '../domain/playerSync';
import { isPlayerVisibleClubName, isPlayerVisibleGameName } from '../domain/clubVisibility';
import {
  hasUncommittedFutureRevision,
  orbitSyncProtocolVersion,
  selectCommittedGames,
  selectRevisionCompatibleRecords
} from '../domain/syncProtocol';
import { firebaseConfig } from './firebaseConfig';
import { auth, db } from './firebase/firebaseClient';
import {
  deleteFirebasePlayer,
  ensureSignedInIdentity,
  getCurrentFirebasePlayer,
  onFirebasePlayerChanged,
  signInOrCreatePlayerWithEmail,
  signInOrCreatePlayerWithPhone,
  signOutFirebasePlayer,
  type FirebasePlayerIdentity
} from './firebase/playerAuth';
import {
  createClubMembershipCheckout,
  createPlayerIdentityVerificationSession,
  deleteRemotePlayerIdentity,
  fetchPlayerIdentityStatus,
  fetchRemoteClubSnapshot,
  orbitApiBaseUrl,
  submitRemotePlayerRequest,
  type PlayerIdentityStatus
} from './api/playerHttpApi';
import { fetchLocalClubSnapshot, submitLocalPlayerRequest } from './api/localPlayerApi';
import type { SyncResult } from './playerDataContracts';
import {
  fetchPlayerProfile,
  savePlayerProfile,
  updatePlayerClubMembership
} from './firebase/playerProfileRepository';
import {
  fetchPlayerTournaments,
  registerForTournament,
  subscribeToPlayerTournaments,
  unregisterFromTournament
} from './firebase/playerTournamentRepository';
import {
  fetchPrivateGameListings,
  submitPrivateGameListing,
  subscribeToPrivateGameListings
} from './firebase/privateGameRepository';
import { normalizePublishedGames } from '../domain/decoders/playerGameDecoder';
import type { LegacyClubStateRecord as ClubStateRecord } from '../domain/decoders/playerSnapshotDecoders';
import {
  fetchAllClubSnapshots,
  fetchClubSnapshot,
  fetchClubSnapshots,
  readAnyClubSnapshot
} from './firebase/clubSnapshotRepository';
import {
  cardHouseGameRefreshIntervalMs,
  subscribeToAllClubSnapshots
} from './subscriptions/clubSnapshotSubscription';

export {
  ensureSignedInIdentity,
  getCurrentFirebasePlayer,
  onFirebasePlayerChanged,
  signInOrCreatePlayerWithEmail,
  signInOrCreatePlayerWithPhone
};
export type { FirebasePlayerIdentity };
export {
  createClubMembershipCheckout,
  createPlayerIdentityVerificationSession,
  fetchPlayerIdentityStatus,
  orbitApiBaseUrl
};
export type { PlayerIdentityStatus };
export {
  fetchPlayerProfile,
  fetchPlayerTournaments,
  fetchPrivateGameListings,
  registerForTournament,
  savePlayerProfile,
  submitPrivateGameListing,
  subscribeToPlayerTournaments,
  subscribeToPrivateGameListings,
  unregisterFromTournament,
  updatePlayerClubMembership
};
export { normalizePublishedGames };
export {
  cardHouseGameRefreshIntervalMs,
  fetchAllClubSnapshots,
  fetchClubSnapshot,
  fetchClubSnapshots,
  subscribeToAllClubSnapshots
};

export const syncBaseUrl = `firebase://${firebaseConfig.projectId}/clubs`;

export function isSyncConfigured() {
  return true;
}

export async function deleteCurrentPlayerAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  await deleteRemotePlayerIdentity(user);
  await deleteDoc(doc(db, 'players', user.uid));
  await deleteFirebasePlayer(user);
}

export async function signOutCurrentPlayer() {
  await signOutFirebasePlayer();
}

export async function submitMembershipRequest(request: PlayerMembershipRequest): Promise<SyncResult> {
  try {
    const requestPlayerId = auth.currentUser?.uid || request.player.id || stableLocalPlayerId(request.player.email, request.player.name);
    const secureRequest = { ...request, player: { ...request.player, id: requestPlayerId } };
    const remoteResult = await submitRemotePlayerRequest('/player/membership-requests', secureRequest);
    if (remoteResult.ok) return remoteResult;
    const localResult = await submitLocalPlayerRequest('/player/membership-requests', secureRequest);
    if (localResult.ok) return localResult;
    const expiresAt = getPassExpiration(request);
    const membershipRecord: PlayerClubMembershipRecord = {
      clubId: request.clubId,
      status: request.paymentMethod === 'in-person' ? 'Requested' : 'Active',
      requestedAt: request.requestedAt,
      expiresAt: request.paymentMethod === 'in-person' ? undefined : expiresAt,
      plan: request.plan,
      paymentMethod: request.paymentMethod,
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
    const requestPlayerId = auth.currentUser?.uid || request.player.id || stableLocalPlayerId(request.player.email, request.player.name);
    const secureRequest = { ...request, player: { ...request.player, id: requestPlayerId } };
    const remoteResult = await submitRemotePlayerRequest('/player/waitlist-requests', secureRequest);
    if (remoteResult.ok) return remoteResult;
    const localResult = await submitLocalPlayerRequest('/player/waitlist-requests', secureRequest);
    if (localResult.ok) return localResult;
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

async function writeRequestToClubPaths(clubId: string, collectionName: 'membershipRequests' | 'waitlistRequests', requestId: string, request: PlayerMembershipRequest | PlayerWaitlistRequest) {
  const requestEnvelope = {
    ...request,
    status: 'pending',
    syncProtocolVersion: orbitSyncProtocolVersion,
    clientMutationId: requestId,
    clientCreatedAt: request.requestedAt,
    createdAt: serverTimestamp()
  };
  await Promise.all([
    setDoc(doc(db, 'clubs', clubId, collectionName, requestId), requestEnvelope, { merge: true }),
    setDoc(doc(db, 'clubStates', clubId, collectionName, requestId), requestEnvelope, { merge: true })
  ]);
}

function applyMembershipToSnapshot(snapshot: PlayerClubSnapshot, request: PlayerMembershipRequest): PlayerClubSnapshot {
  const pending = request.paymentMethod === 'in-person';
  return {
    ...snapshot,
    memberships: [
      ...snapshot.memberships.filter((membership) => membership.playerId !== request.player.id),
      {
        id: `${request.clubId}:${request.player.id}`,
        clubId: request.clubId,
        playerId: request.player.id,
        playerName: request.player.name,
        status: pending ? 'Requested' : 'Active',
        joinedAt: request.requestedAt.slice(0, 10),
        expiresAt: pending ? undefined : getPassExpiration(request),
        plan: request.plan,
        paymentMethod: request.paymentMethod,
        requestedAt: request.requestedAt,
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
  if (request.action === 'cancel') {
    const removed = snapshot.waitlists.filter((entry) => entry.gameId === request.gameId && entry.playerId === request.player.id);
    if (!removed.length) return snapshot;
    return {
      ...snapshot,
      games: snapshot.games.map((game) => game.id === request.gameId ? { ...game, waitlistCount: Math.max(0, game.waitlistCount - removed.length) } : game),
      waitlists: snapshot.waitlists.filter((entry) => !(entry.gameId === request.gameId && entry.playerId === request.player.id)),
      generatedAt: request.requestedAt
    };
  }
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
        status: request.attendance === 'arrived' ? 'Arrived' : request.attendance === 'confirmed' ? 'Confirmed Coming' : 'Interested',
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
  const pending = request.paymentMethod === 'in-person';
  const membershipStartDate = pending ? '' : request.requestedAt.slice(0, 10);
  const membershipExpiresAt = pending ? undefined : getPassExpiration(request);
  const membershipExpirationDate = membershipExpiresAt?.slice(0, 10) ?? '';
  if (existing) {
    return {
      ...state,
      profiles: profiles.map((profile) =>
        profile.id === existing.id
          ? {
              ...profile,
              membershipStartDate: membershipStartDate || profile.membershipStartDate,
              membershipExpirationDate,
              membershipExpiresAt,
              membershipPlan: request.plan,
              membershipPaymentMethod: request.paymentMethod,
              membershipStatus: pending ? 'Requested' : 'Active',
              membershipRequestedAt: request.requestedAt,
              membershipPriceLabel: request.priceLabel,
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
        membershipExpiresAt,
        membershipPlan: request.plan,
        membershipPaymentMethod: request.paymentMethod,
        membershipStatus: pending ? 'Requested' : 'Active',
        membershipRequestedAt: request.requestedAt,
        membershipPriceLabel: request.priceLabel,
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
        status: request.attendance === 'arrived' ? 'Arrived' : request.attendance === 'confirmed' ? 'Confirmed Coming' : 'Interested',
        timestamp: request.requestedAt,
        interestedAt: request.requestedAt,
        confirmedAt: request.attendance === 'confirmed' ? request.requestedAt : undefined,
        arrivedAt: request.attendance === 'arrived' ? request.requestedAt : undefined,
        expectedArrivalTime: request.expectedArrivalTime,
        availabilityStartTime: request.availabilityStartTime,
        availabilityEndTime: request.availabilityEndTime,
        tableId: request.tableId,
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

function getPassExpiration(request: PlayerMembershipRequest) {
  const expiration = new Date(request.requestedAt);
  expiration.setDate(expiration.getDate() + (request.plan === 'day' ? 1 : 30));
  return expiration.toISOString();
}

function mergeUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
