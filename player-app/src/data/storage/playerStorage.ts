import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlayerAccount } from '../../domain/playerSync';

export const legacyPlayerStorageKeys = ['tabletalk-player-account-v1', 'tabletalk-player-account-v2'];
export const playerStorageKey = 'orbit-player-account-v1';
export const dismissedAlertsStorageKey = 'orbit-player-dismissed-alerts-v1';

type StorageEntry = readonly [string, string | null];

export type PlayerStoragePort = {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: string[]): Promise<readonly StorageEntry[]>;
  multiRemove(keys: string[]): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

export type StoredPlayerResult =
  | { kind: 'restored'; player: PlayerAccount }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export function createPlayerStorage(storage: PlayerStoragePort) {
  return {
    async loadPlayer(emptyPlayer: PlayerAccount): Promise<StoredPlayerResult> {
      const entries = await storage.multiGet([playerStorageKey, ...legacyPlayerStorageKeys]);
      const stored = entries.find(([, value]) => Boolean(value))?.[1];
      if (!stored) return { kind: 'missing' };
      let parsed: Partial<PlayerAccount>;
      try {
        parsed = JSON.parse(stored) as Partial<PlayerAccount>;
      } catch {
        return { kind: 'invalid' };
      }
      if (!parsed.name?.trim() || !parsed.email?.trim()) return { kind: 'invalid' };
      return {
        kind: 'restored',
        player: {
          ...emptyPlayer,
          ...parsed,
          preferredGameIds: Array.isArray(parsed.preferredGameIds) ? parsed.preferredGameIds : [],
          favoriteClubIds: Array.isArray(parsed.favoriteClubIds) ? parsed.favoriteClubIds : []
        }
      };
    },

    savePlayer(player: PlayerAccount) {
      return storage.setItem(playerStorageKey, JSON.stringify(player));
    },

    async loadDismissedAlertIds(): Promise<string[]> {
      const stored = await storage.getItem(dismissedAlertsStorageKey);
      return stored ? JSON.parse(stored) : [];
    },

    saveDismissedAlertIds(notificationIds: string[]) {
      return storage.setItem(dismissedAlertsStorageKey, JSON.stringify(notificationIds));
    },

    clearPlayer() {
      return storage.multiRemove([playerStorageKey, ...legacyPlayerStorageKeys]);
    }
  };
}

export const playerStorage = createPlayerStorage(AsyncStorage);
