import { collection, onSnapshot, type QueryDocumentSnapshot, type Unsubscribe } from 'firebase/firestore';
import { isPlayerVisibleClubName } from '../../domain/clubVisibility';
import { normalizePublishedGames } from '../../domain/decoders/playerGameDecoder';
import type { PlayerAccount, PlayerClubSnapshot } from '../../domain/playerSync';
import {
  buildPublishedClubSnapshot,
  decodeRevisionedMembership,
  decodeRevisionedNotification,
  decodeRevisionedWaitlist,
  getSnapshotFreshness
} from '../../domain/playerSnapshotTransforms';
import { db } from '../firebase/firebaseClient';
import { fetchAllClubSnapshots, playerScopedCollection } from '../firebase/clubSnapshotRepository';

export const cardHouseGameRefreshIntervalMs = 30_000;

export function subscribeToAllClubSnapshots(
  player: Pick<PlayerAccount, 'id' | 'name'>,
  callback: (result: { ok: true; clubs: PlayerClubSnapshot[] } | { ok: false; error: string }) => void
) {
  type LiveClubState = {
    clubDoc: QueryDocumentSnapshot;
    games: PlayerClubSnapshot['games'];
    memberships: PlayerClubSnapshot['memberships'];
    waitlists: PlayerClubSnapshot['waitlists'];
    notifications: PlayerClubSnapshot['notifications'];
    updateClub: () => void;
  };

  const childUnsubscribers = new Map<string, Unsubscribe[]>();
  const liveClubStates = new Map<string, LiveClubState>();
  const clubIds = new Set<string>();
  let disposed = false;
  let refreshInFlight = false;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let latestClubs = new Map<string, PlayerClubSnapshot>();

  const emit = () => {
    if (disposed) return;
    callback({ ok: true, clubs: Array.from(latestClubs.values()) });
  };

  const refresh = async () => {
    if (disposed || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const result = await fetchAllClubSnapshots(player);
      if (disposed) return;
      if (result.ok) {
        latestClubs = new Map(result.clubs.map((snapshot) => {
          const liveSnapshot = latestClubs.get(snapshot.club.id);
          const freshestSnapshot = liveSnapshot && getSnapshotFreshness(liveSnapshot) > getSnapshotFreshness(snapshot)
            ? liveSnapshot
            : snapshot;
          return [snapshot.club.id, freshestSnapshot];
        }));
        emit();
      } else if (!latestClubs.size) {
        callback(result);
      }
    } catch (error) {
      if (!disposed && !latestClubs.size) {
        callback({ ok: false, error: error instanceof Error ? error.message : 'Unable to refresh card-house games.' });
      }
    } finally {
      refreshInFlight = false;
    }
  };

  const stopPolling = () => {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  };

  const startPolling = () => {
    stopPolling();
    refreshTimer = setInterval(() => void refresh(), cardHouseGameRefreshIntervalMs);
  };

  const detachClub = (clubId: string) => {
    childUnsubscribers.get(clubId)?.forEach((unsubscribe) => unsubscribe());
    childUnsubscribers.delete(clubId);
    liveClubStates.delete(clubId);
    latestClubs.delete(clubId);
  };

  const parentUnsubscribe = onSnapshot(
    collection(db, 'clubs'),
    (clubsSnapshot) => {
      const visibleClubDocs = clubsSnapshot.docs.filter((clubDoc) => isPlayerVisibleClubName(clubDoc.data()?.name));
      const nextClubIds = new Set(visibleClubDocs.map((clubDoc) => clubDoc.id));
      for (const clubId of clubIds) {
        if (!nextClubIds.has(clubId)) {
          detachClub(clubId);
          clubIds.delete(clubId);
        }
      }

      visibleClubDocs.forEach((clubDoc) => {
        if (clubIds.has(clubDoc.id)) {
          const liveClubState = liveClubStates.get(clubDoc.id);
          if (liveClubState) {
            liveClubState.clubDoc = clubDoc;
            liveClubState.updateClub();
          }
          return;
        }

        clubIds.add(clubDoc.id);
        const childState: LiveClubState = {
          clubDoc,
          games: [],
          memberships: [],
          waitlists: [],
          notifications: [],
          updateClub: () => undefined
        };
        childState.updateClub = () => {
          const nextSnapshot = buildPublishedClubSnapshot(
            childState.clubDoc,
            childState.games,
            childState.memberships,
            childState.waitlists,
            childState.notifications,
            player
          );
          if (!nextSnapshot) return;
          latestClubs.set(clubDoc.id, nextSnapshot);
          emit();
        };
        const handlePrivateCollectionError = () => {
          childState.updateClub();
        };
        const unsubscribers = [
          onSnapshot(
            collection(db, 'clubs', clubDoc.id, 'games'),
            (snapshot) => {
              childState.games = normalizePublishedGames(snapshot.docs);
              childState.updateClub();
            },
            handlePrivateCollectionError
          ),
          onSnapshot(
            playerScopedCollection(clubDoc.id, 'memberships', player.id),
            (snapshot) => {
              childState.memberships = snapshot.docs.map((membershipDoc) => decodeRevisionedMembership(membershipDoc.data()));
              childState.updateClub();
            },
            handlePrivateCollectionError
          ),
          onSnapshot(
            playerScopedCollection(clubDoc.id, 'waitlists', player.id),
            (snapshot) => {
              childState.waitlists = snapshot.docs.map((waitlistDoc) => decodeRevisionedWaitlist(waitlistDoc.data()));
              childState.updateClub();
            },
            handlePrivateCollectionError
          ),
          onSnapshot(
            collection(db, 'clubs', clubDoc.id, 'notifications'),
            (snapshot) => {
              childState.notifications = snapshot.docs.map((notificationDoc) => decodeRevisionedNotification(notificationDoc.data()));
              childState.updateClub();
            },
            handlePrivateCollectionError
          )
        ];
        liveClubStates.set(clubDoc.id, childState);
        childUnsubscribers.set(clubDoc.id, unsubscribers);
        childState.updateClub();
      });
    },
    (error) => latestClubs.size
      ? emit()
      : callback({ ok: false, error: error.message || 'Unable to subscribe to Firebase clubs.' })
  );

  return {
    refresh,
    startPolling,
    stopPolling,
    unsubscribe: () => {
      disposed = true;
      stopPolling();
      parentUnsubscribe();
      childUnsubscribers.forEach((unsubscribers) => unsubscribers.forEach((unsubscribe) => unsubscribe()));
      childUnsubscribers.clear();
      liveClubStates.clear();
    }
  };
}
