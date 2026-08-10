import { doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { getPlayerLoyalty, type PlayerClubMembershipRecord, type PlayerClubSnapshot, type PlayerMembershipRequest, type PlayerWaitlistRequest } from '../../domain/playerSync';
import { decodeLegacyClubStateRecord } from '../../domain/decoders/playerSnapshotDecoders';
import { orbitSyncProtocolVersion } from '../../domain/syncProtocol';
import { submitLocalPlayerRequest } from '../api/localPlayerApi';
import { submitRemotePlayerRequest } from '../api/playerHttpApi';
import type { SyncResult } from '../playerDataContracts';
import { readAnyClubSnapshot } from './clubSnapshotRepository';
import { auth, db } from './firebaseClient';
import { savePlayerProfile } from './playerProfileRepository';

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
    const record = decodeLegacyClubStateRecord(current.data());
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

function getPassExpiration(request: PlayerMembershipRequest) {
  const expiration = new Date(request.requestedAt);
  expiration.setDate(expiration.getDate() + (request.plan === 'day' ? 1 : 30));
  return expiration.toISOString();
}
