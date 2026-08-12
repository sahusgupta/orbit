import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Player restricted-storage contract', () => {
  it('keeps profile data in OS secure storage and Firebase browser tokens in memory', () => {
    const storageSource = fs.readFileSync(path.resolve('player-app/src/data/storage/playerStorage.ts'), 'utf8');
    const firebaseSource = fs.readFileSync(path.resolve('player-app/src/data/firebase/firebaseClient.ts'), 'utf8');
    expect(storageSource).toContain('SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY');
    expect(storageSource).toContain('await AsyncStorage.multiRemove(keys)');
    expect(storageSource).not.toContain('AsyncStorage.setItem(playerStorageKey');
    expect(firebaseSource).toContain('persistence: inMemoryPersistence');
  });
});
