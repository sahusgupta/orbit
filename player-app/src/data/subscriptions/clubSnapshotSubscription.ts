import type { PlayerAccount, PlayerClubSnapshot } from '../../domain/playerSync';
import { fetchAllClubSnapshots } from '../firebase/clubSnapshotRepository';
import { createPlayerPollingSubscription } from './playerPollingSubscription';

export const cardHouseGameRefreshIntervalMs = 60_000;
export type ClubSnapshotSubscriptionResult =
  | { ok: true; clubs: PlayerClubSnapshot[]; partial?: true }
  | { ok: false; error: string; clubs?: PlayerClubSnapshot[]; stale?: true };

export function subscribeToAllClubSnapshots(
  player: Pick<PlayerAccount, 'id' | 'name'>,
  callback: (result: ClubSnapshotSubscriptionResult) => void
) {
  let disposed = false;
  let latestClubs: PlayerClubSnapshot[] = [];
  let latestPartial = false;

  const refreshOperation = () => fetchAllClubSnapshots(player)
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
      });
  const polling = createPlayerPollingSubscription(refreshOperation, cardHouseGameRefreshIntervalMs);

  return {
    ...polling,
    unsubscribe: () => {
      disposed = true;
      polling.unsubscribe();
    }
  };
}
