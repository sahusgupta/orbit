import { describe, expect, it } from 'vitest';
import type { PlayerAccount } from '../../domain/playerSync';
import { createMatchState } from '../../../../apps/api/src/shared/orbitMatchState.cjs';
import type { MatchJournal } from '../../domain/orbitMatchTypes';
import {
  createPlayerStorage,
  dismissedAlertsStorageKey,
  legacyPlayerStorageKeys,
  pendingPlayerAuthCleanupStorageKey,
  pendingPlayerProfileStorageKey,
  playerStorageKey,
  playerMatchJournalStorageKey,
  playerLocalOriginStorageKey,
  type PlayerStoragePort
} from './playerStorageCore';

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

describe('Match journal secure storage', () => {
  const journal = (uid: string): MatchJournal => ({ uid, confirmed: createMatchState(), pending: [] });

  it('serializes per-owner journal updates and preserves other account journals across restart', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    await Promise.all([adapter.saveMatchJournal('uid-one', journal('uid-one')), adapter.saveMatchJournal('uid-two', journal('uid-two'))]);
    const restarted = createPlayerStorage(storage);
    await expect(restarted.loadMatchJournal('uid-one')).resolves.toEqual(journal('uid-one'));
    await expect(restarted.loadMatchJournal('uid-two')).resolves.toEqual(journal('uid-two'));
    await expect(restarted.loadMatchJournal('uid-missing')).resolves.toBeNull();
  });

  it('rejects mismatched owners without changing an existing journal', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    await adapter.saveMatchJournal('uid-one', journal('uid-one'));
    const before = storage.values.get(playerMatchJournalStorageKey);
    await expect(adapter.saveMatchJournal('uid-two', journal('uid-one'))).rejects.toThrow('current account');
    expect(storage.values.get(playerMatchJournalStorageKey)).toBe(before);
  });

  it('fails closed on corrupted journal storage without replacing recoverable bytes', async () => {
    const storage = new FakeStorage();
    storage.values.set(playerMatchJournalStorageKey, '{broken');
    const adapter = createPlayerStorage(storage);
    await expect(adapter.loadMatchJournal('uid-one')).rejects.toThrow();
    await expect(adapter.saveMatchJournal('uid-one', journal('uid-one'))).rejects.toThrow();
    expect(storage.values.get(playerMatchJournalStorageKey)).toBe('{broken');
  });

  it('retains deletion cleanup but erases all Match journals during account cleanup', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    await adapter.saveMatchJournal('uid-one', journal('uid-one'));
    await adapter.saveMatchJournal('uid-two', journal('uid-two'));
    await adapter.savePendingPlayerAuthCleanupUid('uid-one');
    await adapter.clearPlayer();
    expect(storage.values.has(playerMatchJournalStorageKey)).toBe(false);
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).resolves.toBe('uid-one');
  });

  it('retires queued journal writes behind an active write before cleanup can resurrect saved data', async () => {
    const storage = new FakeStorage();
    const writeStarted = deferred();
    const finishWrite = deferred();
    storage.setItem = async (key, value) => {
      writeStarted.resolve();
      await finishWrite.promise;
      storage.values.set(key, value);
    };
    const adapter = createPlayerStorage(storage);
    const active = adapter.saveMatchJournal('uid-one', journal('uid-one'));
    await writeStarted.promise;
    const queued = adapter.saveMatchJournal('uid-two', journal('uid-two'));
    const clear = adapter.clearPlayer();
    const duringClear = adapter.saveMatchJournal('uid-three', journal('uid-three'));
    finishWrite.resolve();
    const results = await Promise.allSettled([active, queued, clear, duringClear]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected']);
    expect(storage.values.has(playerMatchJournalStorageKey)).toBe(false);
  });
});

describe('Owner-local search origin storage', () => {
  const origin = { coordinate: { latitude: 30, longitude: -97 }, label: 'Manual point', source: 'manual' as const, capturedAt: 1000, expiresAt: null };
  it('isolates owner origins, clears one without deleting another, and prevents expiry clearing a newer point', async () => {
    const storage = new FakeStorage(); const adapter = createPlayerStorage(storage);
    await Promise.all([adapter.saveLocalOrigin('account:one', origin), adapter.saveLocalOrigin('device:one', { ...origin, capturedAt: 2000 })]);
    await expect(adapter.loadLocalOrigin('account:two')).resolves.toBeNull();
    await expect(adapter.loadLocalOrigin('device:one')).resolves.toMatchObject({ capturedAt: 2000 });
    await adapter.clearLocalOrigin('device:one', 1000);
    await expect(adapter.loadLocalOrigin('device:one')).resolves.toMatchObject({ capturedAt: 2000 });
    await adapter.clearLocalOrigin('account:one');
    await expect(adapter.loadLocalOrigin('account:one')).resolves.toBeNull();
    await expect(adapter.loadLocalOrigin('device:one')).resolves.toMatchObject({ capturedAt: 2000 });
    await adapter.clearPlayer(); expect(storage.values.has(playerLocalOriginStorageKey)).toBe(false);
  });
  it('rejects invalid coordinates and allows explicit recovery from corrupted local location data', async () => {
    const storage = new FakeStorage(); const adapter = createPlayerStorage(storage);
    await expect(adapter.saveLocalOrigin('account:one', { ...origin, coordinate: { latitude: 100, longitude: 0 } })).rejects.toThrow('valid local');
    storage.values.set(playerLocalOriginStorageKey, '{invalid');
    await expect(adapter.loadLocalOrigin('account:one')).rejects.toThrow();
    await adapter.clearLocalOrigin('account:one');
    await expect(adapter.loadLocalOrigin('account:one')).resolves.toBeNull();
  });
  it('retires queued local-origin writes during account cleanup', async () => {
    const storage = new FakeStorage(); const writeStarted = deferred(); const finish = deferred();
    storage.setItem = async (key, value) => { writeStarted.resolve(); await finish.promise; storage.values.set(key, value); };
    const adapter = createPlayerStorage(storage); const active = adapter.saveLocalOrigin('account:one', origin);
    await writeStarted.promise;
    const queued = adapter.saveLocalOrigin('account:two', origin); const cleanup = adapter.clearPlayer();
    finish.resolve();
    expect((await Promise.allSettled([active, queued, cleanup])).map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(storage.values.has(playerLocalOriginStorageKey)).toBe(false);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
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

  it('returns explicit missing or invalid results and clears malformed personal data', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);

    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'missing' });
    storage.values.set(playerStorageKey, '{broken json');
    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'invalid' });
    expect(storage.values.size).toBe(0);
    storage.values.set(playerStorageKey, JSON.stringify({ name: 'No email' }));
    storage.values.set(dismissedAlertsStorageKey, JSON.stringify(['private-notice']));
    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toEqual({ kind: 'invalid' });
    expect(storage.values.size).toBe(0);
    expect(storage.multiRemoveCalls).toEqual([
      [playerStorageKey, ...legacyPlayerStorageKeys, dismissedAlertsStorageKey, pendingPlayerProfileStorageKey, playerMatchJournalStorageKey, playerLocalOriginStorageKey],
      [playerStorageKey, ...legacyPlayerStorageKeys, dismissedAlertsStorageKey, pendingPlayerProfileStorageKey, playerMatchJournalStorageKey, playerLocalOriginStorageKey]
    ]);
  });

  it('restores a phone-auth profile and clears malformed dismissal data', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    storage.values.set(playerStorageKey, JSON.stringify({
      id: 'phone-player',
      name: 'Phone Player',
      email: '',
      phone: '+15551112222',
      preferredGameIds: []
    }));
    await expect(adapter.loadPlayer(emptyPlayer)).resolves.toMatchObject({
      kind: 'restored',
      player: { id: 'phone-player', email: '', phone: '+15551112222' }
    });

    storage.values.set(dismissedAlertsStorageKey, '{malformed');
    await expect(adapter.loadDismissedAlertIds()).resolves.toEqual([]);
    expect(storage.values.has(dismissedAlertsStorageKey)).toBe(false);
  });

  it('persists only canonical E.164 phone values', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    const player = { ...emptyPlayer, id: 'phone-player', name: 'Phone Player', email: '', phone: '+44 20 7946 0958' };

    await adapter.savePlayer(player);
    expect(JSON.parse(storage.values.get(playerStorageKey) ?? '{}')).toMatchObject({ phone: '+442079460958' });
    await expect(adapter.savePlayer({ ...player, phone: '020 7946 0958' })).rejects.toThrow('Start with + and the country code.');
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
    expect(storage.multiRemoveCalls).toEqual([[playerStorageKey, ...legacyPlayerStorageKeys, dismissedAlertsStorageKey, pendingPlayerProfileStorageKey, playerMatchJournalStorageKey, playerLocalOriginStorageKey]]);
  });

  it('persists accepted-deletion cleanup across profile clearing and clears only the matching account marker', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    storage.values.set(playerStorageKey, JSON.stringify({
      ...emptyPlayer,
      id: 'player-1',
      name: 'Player One',
      email: 'one@example.com'
    }));

    await adapter.savePendingPlayerAuthCleanupUid('player-1');
    await adapter.clearPlayer();
    expect(storage.values.has(playerStorageKey)).toBe(false);
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).resolves.toBe('player-1');

    await adapter.clearPendingPlayerAuthCleanupUid('player-2');
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).resolves.toBe('player-1');
    await adapter.clearPendingPlayerAuthCleanupUid('player-1');
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).resolves.toBeNull();
    expect(storage.setItemCalls).toContainEqual([
      pendingPlayerAuthCleanupStorageKey,
      JSON.stringify({ uid: 'player-1' })
    ]);
  });

  it('fails closed on an invalid accepted-deletion cleanup marker', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    storage.values.set(pendingPlayerAuthCleanupStorageKey, '{not-json');
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).rejects.toThrow('pending secure sign-out record is invalid');
    await expect(adapter.savePendingPlayerAuthCleanupUid(' bad-player ')).rejects.toThrow('valid account');
  });

  it('restores each account pending edit after restart and clears only the acknowledged UID and version', async () => {
    const storage = new FakeStorage();
    const adapter = createPlayerStorage(storage);
    const pending = {
      uid: 'player-1',
      version: 'edit-2',
      player: { ...emptyPlayer, id: 'player-1', name: 'Latest local edit', email: 'one@example.com' }
    };
    const secondPending = {
      uid: 'player-2',
      version: 'edit-b',
      player: { ...emptyPlayer, id: 'player-2', name: 'Second account edit', email: 'two@example.com' }
    };

    await adapter.savePendingPlayerProfile(pending);
    await adapter.savePendingPlayerProfile(secondPending);
    const restartedAdapter = createPlayerStorage(storage);
    await expect(restartedAdapter.loadPendingPlayerProfile('player-1', emptyPlayer)).resolves.toEqual(pending);
    await expect(restartedAdapter.loadPendingPlayerProfile('player-2', emptyPlayer)).resolves.toEqual(secondPending);
    await expect(restartedAdapter.loadPendingPlayerProfile('player-3', emptyPlayer)).resolves.toBeNull();

    await restartedAdapter.clearPendingPlayerProfile('player-1', 'edit-1');
    expect(storage.values.has(pendingPlayerProfileStorageKey)).toBe(true);
    await restartedAdapter.clearPendingPlayerProfile('player-1', 'edit-2');
    await expect(restartedAdapter.loadPendingPlayerProfile('player-1', emptyPlayer)).resolves.toBeNull();
    await expect(restartedAdapter.loadPendingPlayerProfile('player-2', emptyPlayer)).resolves.toEqual(secondPending);
    expect(storage.values.has(pendingPlayerProfileStorageKey)).toBe(true);
    await restartedAdapter.clearPendingPlayerProfile('player-2', 'edit-b');
    expect(storage.values.has(pendingPlayerProfileStorageKey)).toBe(false);
  });

  it('serializes clear after an active write and retires queued profile or dismissal writes', async () => {
    const storage = new FakeStorage();
    const firstWrite = deferred();
    const writeStarted = deferred();
    const operations: string[] = [];
    storage.setItem = async (key, value) => {
      operations.push(`set:start:${key}`);
      writeStarted.resolve();
      await firstWrite.promise;
      storage.setItemCalls.push([key, value]);
      storage.values.set(key, value);
      operations.push(`set:end:${key}`);
    };
    storage.multiRemove = async (keys) => {
      operations.push('clear');
      storage.multiRemoveCalls.push([...keys]);
      keys.forEach((key) => storage.values.delete(key));
    };
    const adapter = createPlayerStorage(storage);
    const account = { ...emptyPlayer, id: 'player-1', name: 'Player One', email: 'one@example.com' };

    const activeSave = adapter.savePlayer(account);
    await writeStarted.promise;
    const queuedDismissal = adapter.saveDismissedAlertIds(['notice-before-clear']);
    const queuedPendingProfile = adapter.savePendingPlayerProfile({
      uid: account.id,
      version: 'edit-before-clear',
      player: account
    });
    const clear = adapter.clearPlayer();
    const writeDuringClear = adapter.savePlayer({ ...account, id: 'player-2', email: 'two@example.com' });
    firstWrite.resolve();
    const results = await Promise.allSettled([activeSave, queuedDismissal, queuedPendingProfile, clear, writeDuringClear]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);

    expect(operations).toEqual([
      `set:start:${playerStorageKey}`,
      `set:end:${playerStorageKey}`,
      'clear'
    ]);
    expect(storage.values.size).toBe(0);
    expect(storage.setItemCalls).toHaveLength(1);

    await adapter.savePlayer({ ...account, id: 'player-2', email: 'two@example.com' });
    expect(JSON.parse(storage.values.get(playerStorageKey) ?? '{}')).toMatchObject({ id: 'player-2' });
  });
});
