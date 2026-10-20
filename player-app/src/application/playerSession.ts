import type { usePlayerIdentity } from './usePlayerIdentity';
import type { usePlayerLiveData } from './usePlayerLiveData';
import type { usePlayerStorage } from './usePlayerStorage';

// The shared experience receives state, while each session owns its effects.
// A demo never mounts the connected authentication, storage, or sync hooks.
export type PlayerSessionStorage = Pick<ReturnType<typeof usePlayerStorage>,
  | 'accountLoaded'
  | 'dismissedAlertsLoaded'
  | 'dismissedNotificationIds'
  | 'dismissInAppAlert'
  | 'draftPlayer'
  | 'hasAccount'
  | 'onboardingStep'
  | 'player'
  | 'playerStorageError'
  | 'retryPlayerStorage'
  | 'setDraftPlayer'
  | 'setOnboardingStep'
  | 'setPlayer'
>;

export type PlayerSessionIdentity = ReturnType<typeof usePlayerIdentity>;
export type PlayerSessionLiveData = ReturnType<typeof usePlayerLiveData>;
