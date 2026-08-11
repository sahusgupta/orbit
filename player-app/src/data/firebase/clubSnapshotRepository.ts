import { collection, doc, getDoc, getDocs, limit, query, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { isPlayerVisibleClubName } from '../../domain/clubVisibility';
import { normalizePublishedGames } from '../../domain/decoders/playerGameDecoder';
import { decodeLegacyClubStateRecord, decodePublishedClubRecord } from '../../domain/decoders/playerSnapshotDecoders';
import type { PlayerAccount, PlayerClubSnapshot } from '../../domain/playerSync';
import {
  decodeRevisionedMembership,
  decodeRevisionedNotification,
  decodeRevisionedWaitlist,
  filterSnapshotForPlayer,
  mergeClubSnapshots,
  mergeSnapshotSources
} from '../../domain/playerSnapshotTransforms';
import { hasUncommittedFutureRevision, selectCommittedGames, selectRevisionCompatibleRecords } from '../../domain/syncProtocol';
import { fetchLocalClubSnapshot } from '../api/localPlayerApi';
import { fetchRemotePlayerDiscovery } from '../api/playerHttpApi';
import type { SyncResult } from '../playerDataContracts';
import { db } from './firebaseClient';

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
    const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(50)));
    const clubs = snapshots.docs
      .map((snapshot) => decodeLegacyClubStateRecord(snapshot.data()))
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
  const [localAttempt, discoveryAttempt] = await Promise.allSettled([
    fetchLocalClubSnapshot(player),
    fetchRemotePlayerDiscovery()
  ]);
  const localResult = localAttempt.status === 'fulfilled' ? localAttempt.value : { ok: false as const, error: 'Local bridge unavailable.' };
  const localClubs = localResult.ok ? [localResult.snapshot] : [];
  if (discoveryAttempt.status === 'fulfilled') {
    return {
      ok: true as const,
      clubs: mergeSnapshotSources(discoveryAttempt.value.clubs, localClubs),
      page: discoveryAttempt.value.page
    };
  }
  try {
    const publishedClubs = await getPublishedClubSnapshots(player);
    if (publishedClubs.length || localClubs.length) {
      return { ok: true as const, clubs: mergeSnapshotSources(publishedClubs, localClubs) };
    }
    const clubs = await getLegacyClubSnapshots(player);
    return { ok: true as const, clubs: mergeSnapshotSources(clubs, localClubs) };
  } catch (error) {
    if (localClubs.length) return { ok: true as const, clubs: localClubs };
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to read Firebase clubs.' };
  }
}

export async function readAnyClubSnapshot(clubId: string, player: Pick<PlayerAccount, 'id' | 'name'>) {
  const publishedClub = await getDoc(doc(db, 'clubs', clubId));
  if (publishedClub.exists()) {
    if (!isPlayerVisibleClubName(publishedClub.data()?.name)) return null;
    return getPublishedClubSnapshot(publishedClub, player);
  }
  const legacy = await getClubState(clubId);
  return legacy?.snapshot ? filterSnapshotForPlayer(legacy.snapshot, player) : null;
}

export async function getClubState(accountKey: string) {
  const snapshot = await getDoc(doc(db, 'clubStates', accountKey.trim().toLowerCase()));
  return snapshot.exists() ? decodeLegacyClubStateRecord(snapshot.data()) : null;
}

export function playerScopedCollection(clubId: string, collectionName: 'memberships' | 'waitlists', playerId?: string) {
  return query(collection(db, 'clubs', clubId, collectionName), where('playerId', '==', playerId || '__none__'), limit(2));
}

export function playerNotificationCollection(clubId: string, playerId?: string) {
  return query(
    collection(db, 'clubs', clubId, 'notifications'),
    where('targetPlayerIds', 'array-contains', playerId || '__none__'),
    limit(50)
  );
}

async function getPublishedClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  const clubDocs = await getDocs(query(collection(db, 'clubs'), limit(50)));
  return Promise.all(
    clubDocs.docs
      .filter((clubDoc) => isPlayerVisibleClubName(clubDoc.data()?.name))
      .map((clubDoc) => getPublishedClubSnapshot(clubDoc, player))
  );
}

async function getPublishedClubSnapshot(clubDoc: QueryDocumentSnapshot, player: Pick<PlayerAccount, 'id' | 'name'>) {
  const club = decodePublishedClubRecord(clubDoc.data());
  if (!club || !isPlayerVisibleClubName(club.name)) throw new Error(`Club ${clubDoc.id} is not player-visible.`);
  const [games, memberships, waitlists, notifications] = await Promise.all([
    getDocs(query(collection(db, 'clubs', clubDoc.id, 'games'), limit(100))),
    getDocs(playerScopedCollection(clubDoc.id, 'memberships', player.id)),
    getDocs(playerScopedCollection(clubDoc.id, 'waitlists', player.id)),
    getDocs(playerNotificationCollection(clubDoc.id, player.id))
  ]);
  const membershipRecords = memberships.docs.map((membershipDoc) => decodeRevisionedMembership(membershipDoc.data()));
  const waitlistRecords = waitlists.docs.map((waitlistDoc) => decodeRevisionedWaitlist(waitlistDoc.data()));
  const notificationRecords = notifications.docs.map((notificationDoc) => decodeRevisionedNotification(notificationDoc.data()));
  const committedGames = selectCommittedGames(club, normalizePublishedGames(games.docs));
  if (!committedGames) {
    throw new Error(`${club.name || clubDoc.id} is publishing a newer game revision.`);
  }
  if (
    hasUncommittedFutureRevision(club, membershipRecords) ||
    hasUncommittedFutureRevision(club, waitlistRecords) ||
    hasUncommittedFutureRevision(club, notificationRecords)
  ) {
    throw new Error(`${club.name || clubDoc.id} is publishing newer player records.`);
  }
  const snapshot: PlayerClubSnapshot = {
    club: {
      id: club.id || clubDoc.id,
      name: club.name || 'Local Poker Club',
      address: club.address,
      phone: club.phone,
      membershipOptions: club.membershipOptions,
      syncProtocolVersion: club.syncProtocolVersion,
      syncRevision: club.syncRevision,
      publishedAt: club.publishedAt ?? club.savedAt
    },
    games: committedGames,
    memberships: selectRevisionCompatibleRecords(club, membershipRecords),
    waitlists: selectRevisionCompatibleRecords(club, waitlistRecords),
    notifications: selectRevisionCompatibleRecords(club, notificationRecords),
    social: club.social ?? { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
    generatedAt: club.generatedAt ?? club.publishedAt ?? club.savedAt ?? new Date().toISOString(),
    syncProtocolVersion: club.syncProtocolVersion,
    syncRevision: club.syncRevision
  };
  return filterSnapshotForPlayer(snapshot, player);
}

async function getLegacyClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(50)));
  return snapshots.docs
    .map((snapshot) => decodeLegacyClubStateRecord(snapshot.data()))
    .filter((record) => record.snapshot && isPlayerVisibleClubName(record.snapshot.club?.name))
    .map((record) => filterSnapshotForPlayer(record.snapshot, player));
}

async function getFirstClubState() {
  const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(1)));
  const first = snapshots.docs[0];
  return first ? decodeLegacyClubStateRecord(first.data()) : null;
}
