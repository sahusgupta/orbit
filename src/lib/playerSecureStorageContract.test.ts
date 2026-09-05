import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Player restricted-storage contract', () => {
  it('keeps profile data in OS secure storage and confines Firebase session persistence to its dedicated adapters', () => {
    const storageSource = fs.readFileSync(path.resolve('player-app/src/data/storage/playerStorage.ts'), 'utf8');
    const firebaseSource = fs.readFileSync(path.resolve('player-app/src/data/firebase/firebaseClient.ts'), 'utf8');
    const initializeAuthSource = fs.readFileSync(path.resolve('player-app/src/data/firebase/initializePlayerAuth.ts'), 'utf8');
    const nativePersistenceSource = fs.readFileSync(path.resolve('player-app/src/data/firebase/playerAuthPersistence.native.ts'), 'utf8');
    const browserPersistenceSource = fs.readFileSync(path.resolve('player-app/src/data/firebase/playerAuthPersistence.ts'), 'utf8');
    expect(storageSource).toContain('SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    expect(storageSource).toContain('await AsyncStorage.multiRemove(keys)');
    expect(storageSource).not.toContain('AsyncStorage.setItem(playerStorageKey');
    expect(firebaseSource).toContain('initializePlayerAuth(firebaseApp, playerAuthPersistence');
    expect(initializeAuthSource).toContain('return ports.initialize(app, { persistence });');
    expect(nativePersistenceSource).toContain('getReactNativePersistence(AsyncStorage)');
    expect(nativePersistenceSource).toContain('Firebase stores only its session material here.');
    expect(browserPersistenceSource).toContain('browserLocalPersistence');
  });
});
