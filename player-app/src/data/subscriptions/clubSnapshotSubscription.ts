import type { PlayerAccount, PlayerClubSnapshot } from '../../domain/playerSync';
import { fetchAllClubSnapshots } from '../firebase/clubSnapshotRepository';

export const cardHouseGameRefreshIntervalMs = 60_000;
export type ClubSnapshotSubscriptionResult =
  | { ok: true; clubs: PlayerClubSnapshot[]; partial?: true }
  | { ok: false; error: string; clubs?: PlayerClubSnapshot[]; stale?: true };

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
        } else {
          callback(latestClubs.length
            ? { ...result, clubs: latestClubs, stale: true }
            : result);
        }
      })
      .catch((error) => {
        if (!disposed) {
          const failure = { ok: false as const, error: error instanceof Error ? error.message : 'Unable to refresh published venue games.' };
          callback(latestClubs.length
            ? { ...failure, clubs: latestClubs, stale: true }
            : failure);
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

  return {
    refresh,
    startPolling,
    stopPolling,
    unsubscribe: () => {
      disposed = true;
      stopPolling();
    }
  };
}
