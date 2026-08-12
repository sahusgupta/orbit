import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  createPlayerStorage,
  dismissedAlertsStorageKey,
  playerStorageKey,
  type PlayerStoragePort
} from './playerStorageCore';

export * from './playerStorageCore';

const volatileSecureFallback = new Map<string, string>();

const securePlayerStoragePort: PlayerStoragePort = {
  async getItem(key) {
    if (key === dismissedAlertsStorageKey) return AsyncStorage.getItem(key);
    if (await SecureStore.isAvailableAsync()) return SecureStore.getItemAsync(key);
    return volatileSecureFallback.get(key) ?? null;
  },
  async multiGet(keys) {
    const secureEntries = await Promise.all(keys.map(async (key) => [key, await securePlayerStoragePort.getItem(key)] as const));
    if (secureEntries.some(([, value]) => Boolean(value))) return secureEntries;
    const legacyEntries = await AsyncStorage.multiGet(keys);
    const legacyPlayer = legacyEntries.find(([, value]) => Boolean(value));
    if (legacyPlayer?.[1]) {
      await securePlayerStoragePort.setItem(playerStorageKey, legacyPlayer[1]);
      await AsyncStorage.multiRemove(keys);
      return [[playerStorageKey, legacyPlayer[1]], ...keys.slice(1).map((key) => [key, null] as const)];
    }
    return secureEntries;
  },
  async multiRemove(keys) {
    await Promise.all(keys.map(async (key) => {
      volatileSecureFallback.delete(key);
      if (await SecureStore.isAvailableAsync()) await SecureStore.deleteItemAsync(key);
    }));
    await AsyncStorage.multiRemove(keys);
  },
  async setItem(key, value) {
    if (key === dismissedAlertsStorageKey) {
      await AsyncStorage.setItem(key, value);
      return;
    }
    if (await SecureStore.isAvailableAsync()) {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      });
      return;
    }
    volatileSecureFallback.set(key, value);
  }
};

export const playerStorage = createPlayerStorage(securePlayerStoragePort);
