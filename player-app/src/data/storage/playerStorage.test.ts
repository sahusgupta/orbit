import { describe, expect, it } from 'vitest';
import type { PlayerAccount } from '../../domain/playerSync';
import {
  createPlayerStorage,
  dismissedAlertsStorageKey,
  legacyPlayerStorageKeys,
  playerStorageKey,
  type PlayerStoragePort
} from './playerStorage';

const emptyPlayer: PlayerAccount = {
  id: '',
  name: '',
  email: '',
  phone: '',
  homeLocation: '',
  searchRadiusMiles: 20,
  preferredGameIds: [],
  favoriteClubIds: [],
  preferredStakes: '',
  typicalAvailability: ''
};

class FakeStorage implements PlayerStoragePort {
  readonly values = new Map<string, string>();
  readonly multiGetCalls: string[][] = [];
  readonly multiRemoveCalls: string[][] = [];
  readonly setItemCalls: Array<[string, string]> = [];

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async multiGet(keys: string[]) {
    this.multiGetCalls.push([...keys]);
    return keys.map((key) => [key, this.values.get(key) ?? null] as const);
  }

  async multiRemove(keys: string[]) {
    this.multiRemoveCalls.push([...keys]);
    keys.forEach((key) => this.values.delete(key));
  }

  async setItem(key: string, value: string) {
    this.setItemCalls.push([key, value]);
    this.values.set(key, value);
  }
}

describe('Player storage adapter', () => {
  it('prefers the current account key, preserves legacy priority, and normalizes collection fields', async () => {
    const storage = new FakeStorage();
    storage.values.set(legacyPlayerStorageKeys[0], JSON.stringify({ name: 'Legacy One', email: 'one@example.com' }));
    storage.values.set(legacyPlayerStorageKeys[1], JSON.stringify({ name: 'Legacy Two', email: 'two@example.com' }));
    storage.values.set(playerStorageKey, JSON.stringify({
      id: 'player-current',
      name: 'Current',
      email: 'current@example.com',
      preferredGameIds: 'invalid',
      favoriteClubIds: null
    }));

    await expect(createPlayerStorage(storage).loadPlayer(emptyPlayer)).resolves.toEqual({
      kind: 'restored',
      player: {
        ...emptyPlayer,
        id: 'player-current',
        name: 'Current',
        email: 'current@example.com'
      }
    });
    expect(storage.multiGetCalls).toEqual([[playerStorageKey, ...legacyPlayerStorageKeys]]);

    storage.values.delete(playerStorageKey);
    await expect(createPlayerStorage(storage).loadPlayer(emptyPlayer)).resolves.toMatchObject({
      kind: 'restored',
      player: { name: 'Legacy One', email: 'one@example.com' }
    });
  });

  it('returns explicit missing or invalid results without changing the stored payload', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);

    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'missing' });
    storage.values.set(playerStorageKey, '{broken json');
    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'invalid' });
    storage.values.set(playerStorageKey, JSON.stringify({ name: 'No email' }));
    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'invalid' });
  });

  it('writes the current account and dismissed-alert shapes and clears every account key', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    const player = { ...emptyPlayer, id: 'player-1', name: 'Player One', email: 'one@example.com' };

    await adapter.savePlayer(player);
    await adapter.saveDismissedAlertIds(['notice-1', 'notice-2']);
    await expect(adapter.loadDismissedAlertIds()).resolves.toEqual(['notice-1', 'notice-2']);
    expect(storage.setItemCalls).toEqual([
      [playerStorageKey, JSON.stringify(player)],
      [dismissedAlertsStorageKey, JSON.stringify(['notice-1', 'notice-2'])]
    ]);

    legacyPlayerStorageKeys.forEach((key) => storage.values.set(key, 'legacy'));
    await adapter.clearPlayer();
    expect(storage.multiRemoveCalls).toEqual([[playerStorageKey, ...legacyPlayerStorageKeys]]);
  });
});
