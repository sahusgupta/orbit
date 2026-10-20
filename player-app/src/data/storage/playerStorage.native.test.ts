import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMatchState } from '../../../../apps/api/src/shared/orbitMatchState.cjs';
import type { PlayerAccount } from '../../domain/playerSync';
import type { MatchJournal } from '../../domain/orbitMatchTypes';
import type { PlayerLocalOrigin } from '../../domain/playerLocation';
import { createPlayerMatchController } from '../../application/playerMatchController';
import { legacyPlayerStorageKeys, playerStorageKey, playerMatchJournalStorageKey, playerLocalOriginStorageKey } from './playerStorageCore';

const native = vi.hoisted(() => {
  const secureValues = new Map<string, string>();
  const plainValues = new Map<string, string>();
  const state = { available: true };
  return {
    state, secureValues, plainValues,
    available: vi.fn(async () => state.available),
    secureGet: vi.fn(async (key: string) => secureValues.get(key) ?? null),
    secureSet: vi.fn(async (key: string, value: string, _options: { keychainAccessible: number }) => { secureValues.set(key, value); }),
    secureDelete: vi.fn(async (key: string) => { secureValues.delete(key); }),
    plainGet: vi.fn(async (key: string) => plainValues.get(key) ?? null),
    plainSet: vi.fn(async (key: string, value: string) => { plainValues.set(key, value); }),
    plainMultiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, plainValues.get(key) ?? null] as const)),
    plainMultiRemove: vi.fn(async (keys: string[]) => { keys.forEach((key) => plainValues.delete(key)); })
  };
});
vi.mock('expo-secure-store', () => ({
  isAvailableAsync: native.available, getItemAsync: native.secureGet, setItemAsync: native.secureSet,
  deleteItemAsync: native.secureDelete, WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: native.plainGet, setItem: native.plainSet, multiGet: native.plainMultiGet, multiRemove: native.plainMultiRemove
} }));

const player: PlayerAccount = { id: 'storage-fixture', name: 'Storage Fixture', email: 'fixture@example.test',
  homeLocation: '', searchRadiusMiles: 50, preferredGameIds: [], favoriteClubIds: [] };
const journal: MatchJournal = { uid: player.id, confirmed: createMatchState(), pending: [] };
const origin: PlayerLocalOrigin = { source: 'manual', coordinate: { latitude: 30, longitude: -97 },
  label: 'Selected map location', capturedAt: 1000, expiresAt: null };
const storage = async () => (await import('./playerStorage')).playerStorage;

describe('native Player storage transport', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    native.state.available = true;
    native.secureValues.clear(); native.plainValues.clear();
  });

  it('writes the new keys through SecureStore with existing device-only protection and restores after a module restart', async () => {
    const adapter = await storage();
    await adapter.saveMatchJournal(player.id, journal);
    await adapter.saveLocalOrigin(`device:${player.id}`, origin);
    expect(native.secureSet).toHaveBeenCalledWith(playerMatchJournalStorageKey, expect.any(String), { keychainAccessible: 5 });
    expect(native.secureSet).toHaveBeenCalledWith(playerLocalOriginStorageKey, expect.any(String), { keychainAccessible: 5 });
    expect(native.plainSet).not.toHaveBeenCalled();
    vi.resetModules();
    const restarted = await storage();
    await expect(restarted.loadMatchJournal(player.id)).resolves.toEqual(journal);
    await expect(restarted.loadLocalOrigin(`device:${player.id}`)).resolves.toEqual(origin);
  });

  it('preserves existing volatile profile/auth cleanup and plain dismissal behavior when secure storage is unavailable', async () => {
    native.state.available = false;
    const adapter = await storage();
    await adapter.savePlayer(player);
    await adapter.savePendingPlayerAuthCleanupUid(player.id);
    await adapter.saveDismissedAlertIds(['fixture-notice']);
    await expect(adapter.loadPlayer(player)).resolves.toEqual({ kind: 'restored', player });
    await expect(adapter.loadPendingPlayerAuthCleanupUid()).resolves.toBe(player.id);
    await expect(adapter.loadDismissedAlertIds()).resolves.toEqual(['fixture-notice']);
    expect(native.secureSet).not.toHaveBeenCalled();
    expect(native.plainValues.has(playerStorageKey)).toBe(false);
    vi.resetModules();
    const restarted = await storage();
    await expect(restarted.loadPlayer(player)).resolves.toEqual({ kind: 'missing' });
    await expect(restarted.loadPendingPlayerAuthCleanupUid()).resolves.toBeNull();
    await expect(restarted.loadDismissedAlertIds()).resolves.toEqual(['fixture-notice']);
  });

  it('retains legacy migration and cleanup rather than moving profile data to a new authority', async () => {
    native.plainValues.set(legacyPlayerStorageKeys[0], JSON.stringify(player));
    const adapter = await storage();
    await expect(adapter.loadPlayer(player)).resolves.toEqual({ kind: 'restored', player });
    expect(native.secureValues.get(playerStorageKey)).toBe(JSON.stringify(player));
    expect(native.plainValues.has(legacyPlayerStorageKeys[0])).toBe(false);
    await adapter.clearPlayer();
    expect(native.secureValues.size).toBe(0);
  });

  it('rejects unavailable Match/location writes without falling back to memory/plain storage and recovers durably', async () => {
    native.state.available = false;
    const adapter = await storage();
    await expect(adapter.saveMatchJournal(player.id, journal)).rejects.toThrow('Secure storage is unavailable');
    await expect(adapter.saveLocalOrigin(`device:${player.id}`, origin)).rejects.toThrow('Secure storage is unavailable');
    await expect(adapter.loadMatchJournal(player.id)).resolves.toBeNull();
    await expect(adapter.loadLocalOrigin(`device:${player.id}`)).resolves.toBeNull();
    expect(native.secureSet).not.toHaveBeenCalled();
    expect(native.plainSet).not.toHaveBeenCalled();
    expect(native.secureValues.size).toBe(0);
    native.state.available = true;
    await adapter.saveMatchJournal(player.id, journal);
    await adapter.saveLocalOrigin(`device:${player.id}`, origin);
    vi.resetModules();
    const restarted = await storage();
    await expect(restarted.loadMatchJournal(player.id)).resolves.toEqual(journal);
    await expect(restarted.loadLocalOrigin(`device:${player.id}`)).resolves.toEqual(origin);
  });

  it('propagates native secure write failure and keeps already persisted bytes intact', async () => {
    const adapter = await storage();
    await adapter.saveMatchJournal(player.id, journal);
    const before = native.secureValues.get(playerMatchJournalStorageKey);
    native.secureSet.mockRejectedValueOnce(new Error('Native keychain unavailable'));
    await expect(adapter.saveMatchJournal(player.id, { ...journal, confirmed: createMatchState({
      ...createMatchState().preferences, variants: ['nlh']
    }) })).rejects.toThrow('Native keychain unavailable');
    expect(native.secureValues.get(playerMatchJournalStorageKey)).toBe(before);
    await expect(adapter.loadMatchJournal(player.id)).resolves.toEqual(journal);
  });

  it('never accepts/projects a save or calls the remote mutation after an unavailable journal write', async () => {
    native.state.available = false;
    const adapter = await storage();
    const remoteMutation = vi.fn(async () => createMatchState());
    const controller = createPlayerMatchController({ uid: player.id, preferences: createMatchState().preferences,
      createId: () => 'fixture-mutation-save-00001', onChange: vi.fn(), port: {
      loadJournal: (uid) => adapter.loadMatchJournal(uid),
      saveJournal: (uid, nextJournal) => adapter.saveMatchJournal(uid, nextJournal),
      fetchState: async () => createMatchState(), mutate: remoteMutation, subscribe: () => () => undefined
    } });
    try {
      await controller.start();
      await expect(controller.decide({ clubId: 'fixture-club', gameId: 'fixture-game', kind: 'cash' },
        { venueName: 'Fictional Venue', gameName: 'Fictional Game' }, 'saved')).resolves.toBe(false);
      expect(controller.snapshot()).toMatchObject({ pending: false, error: expect.stringContaining('Secure storage is unavailable'),
        state: { decisions: [] } });
      expect(remoteMutation).not.toHaveBeenCalled();
      native.state.available = true;
      await controller.retry();
      expect(controller.snapshot().error).toBe('');
      await expect(adapter.loadMatchJournal(player.id)).resolves.toMatchObject({ confirmed: createMatchState(), pending: [] });
    } finally { controller.dispose(); }
  });
});
