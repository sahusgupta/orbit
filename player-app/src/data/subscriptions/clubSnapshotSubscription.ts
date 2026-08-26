import type { PlayerAccount, PlayerClubSnapshot } from '../../domain/playerSync';
import { fetchAllClubSnapshots } from '../firebase/clubSnapshotRepository';
import { subscribeToClubCommitMarker } from './clubCommitMarker';

export const cardHouseGameRefreshIntervalMs = 60_000;
export type ClubSnapshotSubscriptionResult =
  | { ok: true; clubs: PlayerClubSnapshot[]; partial?: true }
  | { ok: false; error: string };

export function subscribeToAllClubSnapshots(
  player: Pick<PlayerAccount, 'id' | 'name'>,
  callback: (result: ClubSnapshotSubscriptionResult) => void
) {
  let disposed = false;
  let refreshInFlight: Promise<void> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let latestClubs: PlayerClubSnapshot[] = [];
  let latestPartial = false;

  const refresh = () => {
    if (disposed) return Promise.resolve();
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = fetchAllClubSnapshots(player)
      .then((result) => {
        if (disposed) return;
        if (result.ok) {
          latestClubs = result.clubs;
          latestPartial = 'page' in result && result.page?.hasMore === true;
          callback(latestPartial ? { ok: true, clubs: latestClubs, partial: true } : { ok: true, clubs: latestClubs });
        } else if (!latestClubs.length) {
          callback(result);
        }
      })
      .catch((error) => {
        if (!disposed && !latestClubs.length) {
          callback({ ok: false, error: error instanceof Error ? error.message : 'Unable to refresh card-house games.' });
        }
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
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

  // The parent document is the sync-protocol-v2 commit marker. One bounded
  // listener invalidates the authoritative discovery page without creating
  // per-club child listener fan-out.
  const commitMarkerUnsubscribe = subscribeToClubCommitMarker(
    () => void refresh(),
    (error) => latestClubs.length
      ? callback(latestPartial ? { ok: true, clubs: latestClubs, partial: true } : { ok: true, clubs: latestClubs })
      : callback({ ok: false, error: error.message || 'Unable to subscribe to club revisions.' })
  );

  return {
    refresh,
    startPolling,
    stopPolling,
    unsubscribe: () => {
      disposed = true;
      stopPolling();
      commitMarkerUnsubscribe();
    }
  };
}
