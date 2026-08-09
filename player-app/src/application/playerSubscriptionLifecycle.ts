import type { PlayerAppState, PlayerPlatform } from '../app/playerPlatform';

export type PlayerPollingSubscription = {
  refresh(): Promise<unknown>;
  startPolling(): void;
  stopPolling(): void;
  unsubscribe(): void;
};

type AppStateLifecyclePort = Pick<PlayerPlatform, 'getCurrentAppState' | 'subscribeToAppState'>;

export function bindPlayerPollingLifecycle(platform: AppStateLifecyclePort, subscription: PlayerPollingSubscription) {
  let currentAppState = platform.getCurrentAppState();

  const handleAppStateChange = (nextAppState: PlayerAppState) => {
    const returnedToForeground = nextAppState === 'active' && currentAppState !== 'active';
    currentAppState = nextAppState;
    if (nextAppState === 'active') {
      if (returnedToForeground) void subscription.refresh();
      subscription.startPolling();
    } else {
      subscription.stopPolling();
    }
  };

  const unsubscribeFromAppState = platform.subscribeToAppState(handleAppStateChange);
  void subscription.refresh();
  if (currentAppState === 'active' || currentAppState == null) subscription.startPolling();

  return () => {
    unsubscribeFromAppState();
    subscription.unsubscribe();
  };
}
