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
import { fetchPublicPlayerDiscovery, fetchRemotePlayerDiscovery } from '../api/playerHttpApi';
import type { SyncResult } from '../playerDataContracts';
import { auth, db } from './firebaseClient';

const discoveryPageSize = 50;
const maximumDiscoveryPages = 20;
type DiscoveryPageFetcher = (cursor?: string, limit?: number) => ReturnType<typeof fetchRemotePlayerDiscovery>;
type DiscoveryFallbackOptions = {
  /** Explicit test/development escape hatch. Production subscriptions never set this. */
  allowLocalDevelopmentFallback?: true;
};

async function fetchDiscoveryCatalog(
  fetchPage: DiscoveryPageFetcher,
  player: Pick<PlayerAccount, 'id' | 'name'>
) {
  let clubs: PlayerClubSnapshot[] = [];
  let cursor = '';
  let databaseQueries = 0;
  let hasDatabaseQueryCount = false;
  const seenCursors = new Set<string>();

  const createCatalog = (hasMore: boolean, nextCursor: string | null) => ({
    clubs,
    page: {
      count: clubs.length,
      hasMore,
      nextCursor,
      databaseQueries: hasDatabaseQueryCount ? databaseQueries : undefined
    }
  });

  for (let pageIndex = 0; pageIndex < maximumDiscoveryPages; pageIndex += 1) {
    let result: Awaited<ReturnType<DiscoveryPageFetcher>>;
    try {
      result = await fetchPage(cursor, discoveryPageSize);
    } catch (error) {
      if (!clubs.length) throw error;
      return createCatalog(true, cursor || null);
    }
    clubs = mergeSnapshotSources(
      clubs,
      result.clubs.map((snapshot) => filterSnapshotForPlayer(snapshot, player))
    );
    if (typeof result.page.databaseQueries === 'number') {
      databaseQueries += result.page.databaseQueries;
      hasDatabaseQueryCount = true;
    }
    if (!result.page.hasMore) {
      return createCatalog(false, null);
    }

    const nextCursor = result.page.nextCursor?.trim() ?? '';
    if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor)) {
      if (!clubs.length) throw new Error('Orbit Player discovery returned an invalid cursor.');
      return createCatalog(true, null);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return createCatalog(true, cursor || null);
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
    const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(50)));
    const clubs = snapshots.docs
      .map((snapshot) => decodeLegacyClubStateRecord(snapshot.data()))
      .filter((record): record is NonNullable<typeof record> => Boolean(record?.snapshot))
      .map((record) => filterSnapshotForPlayer(record.snapshot, player));
    if (!clubs.length) return { ok: false, error: 'No venues have been published yet.' };
    const mergedSnapshot = mergeClubSnapshots(clubs);
    return {
      ok: true,
      accountKey: clubs[0].club.id,
      savedAt: mergedSnapshot.generatedAt,
      snapshot: mergedSnapshot
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unable to read Firebase clubs.' };
  }
}

export async function fetchAllClubSnapshots(
  player: Pick<PlayerAccount, 'id' | 'name'>,
  options: DiscoveryFallbackOptions = {}
) {
  const signedInUid = auth.currentUser?.uid;
  const discoveryFetcher: DiscoveryPageFetcher = signedInUid === player.id
    ? (cursor, pageSize) => fetchRemotePlayerDiscovery(cursor, pageSize, player.id)
    : fetchPublicPlayerDiscovery;
  const discoveryAttempt = await Promise.allSettled([fetchDiscoveryCatalog(discoveryFetcher, player)]).then(([result]) => result);
  if (discoveryAttempt.status === 'fulfilled') {
    return {
      ok: true as const,
      clubs: discoveryAttempt.value.clubs,
      page: discoveryAttempt.value.page
    };
  }
  if (signedInUid === player.id) {
    try {
      const publicDiscovery = await fetchDiscoveryCatalog(fetchPublicPlayerDiscovery, player);
      return {
        ok: true as const,
        clubs: publicDiscovery.clubs,
        page: publicDiscovery.page
      };
    } catch {
      // Both API routes enforce the server's current venue publication/license policy.
    }
  }
  if (!options.allowLocalDevelopmentFallback) {
    return {
      ok: false as const,
      error: discoveryAttempt.reason instanceof Error
        ? discoveryAttempt.reason.message
        : 'Unable to refresh published venue data from the Orbit API.'
    };
  }

  const localResult = await fetchLocalClubSnapshot(player);
  const localClubs = localResult.ok ? [filterSnapshotForPlayer(localResult.snapshot, player)] : [];
  if (localClubs.length) return { ok: true as const, clubs: localClubs };
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
  const settled = await Promise.allSettled(
    clubDocs.docs.flatMap((clubDoc) => {
      const decoded = decodePublishedClubRecord({ ...clubDoc.data(), id: clubDoc.data()?.id ?? clubDoc.id });
      return decoded && isPlayerVisibleClubName(decoded.name)
        ? [getPublishedClubSnapshot(clubDoc, player, decoded)]
        : [];
    })
  );
  return settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
}

async function getPublishedClubSnapshot(
  clubDoc: QueryDocumentSnapshot,
  player: Pick<PlayerAccount, 'id' | 'name'>,
  decodedClub?: NonNullable<ReturnType<typeof decodePublishedClubRecord>>
) {
  const club = decodedClub ?? decodePublishedClubRecord({ ...clubDoc.data(), id: clubDoc.data()?.id ?? clubDoc.id });
  if (!club || !isPlayerVisibleClubName(club.name)) throw new Error(`Club ${clubDoc.id} is not player-visible.`);
  const emptyPlayerRecords = { docs: [] };
  const games = await getDocs(query(collection(db, 'clubs', clubDoc.id, 'games'), limit(100)));
  const readPlayerRecords = async (reference: ReturnType<typeof playerScopedCollection>) => {
    try {
      return await getDocs(reference);
    } catch {
      // Public games remain usable when an expired/mismatched auth session cannot
      // read the optional player projection during API fallback.
      return emptyPlayerRecords;
    }
  };
  const [memberships, waitlists, notifications] = auth.currentUser?.uid === player.id
    ? await Promise.all([
      readPlayerRecords(playerScopedCollection(clubDoc.id, 'memberships', player.id)),
      readPlayerRecords(playerScopedCollection(clubDoc.id, 'waitlists', player.id)),
      readPlayerRecords(playerNotificationCollection(clubDoc.id, player.id))
    ])
    : [emptyPlayerRecords, emptyPlayerRecords, emptyPlayerRecords];
  const membershipRecords = memberships.docs.flatMap((membershipDoc) => {
    const decoded = decodeRevisionedMembership(membershipDoc.data());
    return decoded ? [decoded] : [];
  });
  const waitlistRecords = waitlists.docs.flatMap((waitlistDoc) => {
    const decoded = decodeRevisionedWaitlist(waitlistDoc.data());
    return decoded ? [decoded] : [];
  });
  const notificationRecords = notifications.docs.flatMap((notificationDoc) => {
    const decoded = decodeRevisionedNotification(notificationDoc.data());
    return decoded ? [decoded] : [];
  });
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
      name: club.name,
      address: club.address,
      phone: club.phone,
      minimumAge: club.minimumAge,
      coordinate: club.coordinate,
      venueKind: club.venueKind,
      membershipOptions: club.membershipOptions,
      syncProtocolVersion: club.syncProtocolVersion,
      syncRevision: club.syncRevision,
      publishedAt: club.publishedAt ?? club.savedAt
    },
    games: committedGames,
    memberships: selectRevisionCompatibleRecords(club, membershipRecords),
    waitlists: selectRevisionCompatibleRecords(club, waitlistRecords),
    notifications: selectRevisionCompatibleRecords(club, notificationRecords),
    ...(club.social ? { social: club.social } : {}),
    generatedAt: club.generatedAt ?? club.publishedAt ?? club.savedAt ?? '',
    syncProtocolVersion: club.syncProtocolVersion,
    syncRevision: club.syncRevision
  };
  return filterSnapshotForPlayer(snapshot, player);
}

async function getLegacyClubSnapshots(player: Pick<PlayerAccount, 'id' | 'name'>) {
  const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(50)));
  return snapshots.docs
    .map((snapshot) => decodeLegacyClubStateRecord(snapshot.data()))
    .filter((record): record is NonNullable<typeof record> => Boolean(record?.snapshot && isPlayerVisibleClubName(record.snapshot.club?.name)))
    .map((record) => filterSnapshotForPlayer(record.snapshot, player));
}

async function getFirstClubState() {
  const snapshots = await getDocs(query(collection(db, 'clubStates'), limit(1)));
  const first = snapshots.docs[0];
  return first ? decodeLegacyClubStateRecord(first.data()) : null;
}
