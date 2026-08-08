import { describe, expect, it, vi } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState } from '../../domain/types';
import type { BrowserStorage } from './browserStateRepository';
import { createManagementPersistence } from './managementPersistence';

const buildState = (): AppState => ({
  ...structuredClone(seedState),
  settings: {
    ...structuredClone(seedState.settings),
    pilotAccess: {
      authorized: true,
      authorizationCode: 'REF-019-PERSISTENCE-CODE',
      expiresAt: '2099-12-31T23:59:59.000Z',
      activatedAt: '2026-08-08T12:00:00.000Z',
      licenseId: 'ref-019-persistence'
    }
  }
});

const createStorage = () => {
  const values = new Map<string, string>();
  const storage: BrowserStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
  return { storage, values };
};

describe('management persistence adapter', () => {
  it('fans browser saves out to local storage and the optional localhost bridge', async () => {
    const state = buildState();
    const { storage, values } = createStorage();
    const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchState: typeof fetch = async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(null, { status: 200 });
    };
    const saveFirebaseState = vi.fn(async () => undefined);
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState,
      firebaseEnabled: false,
      getDesktopPersistence: () => undefined,
      saveFirebaseState,
      storage
    });

    await expect(persistence.saveState(state)).resolves.toEqual({
      ok: true,
      path: 'browser-local-storage',
      cloud: 'firebase-pending'
    });
    expect(JSON.parse(values.get('table-manager-state-v1:ref-019-persistence') ?? '{}')).toMatchObject({
      settings: { pilotAccess: { licenseId: 'ref-019-persistence' } }
    });
    expect(fetchCalls).toEqual([expect.objectContaining({ input: 'http://127.0.0.1:4629/state' })]);
    expect(JSON.parse(String(fetchCalls[0].init?.body))).toEqual({ state });
    expect(saveFirebaseState).not.toHaveBeenCalled();
  });

  it('selects desktop persistence, skips the localhost bridge, and leaves Firebase completion pending', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const fetchState = vi.fn<typeof fetch>();
    const desktopSave = vi.fn(async () => ({ ok: true, path: 'desktop', accountKey: 'ref-019-persistence' }));
    const saveFirebaseState = vi.fn(async () => {
      throw new Error('optional Firebase unavailable');
    });
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState,
      firebaseEnabled: true,
      getDesktopPersistence: () => ({ saveState: desktopSave }),
      saveFirebaseState,
      storage
    });

    await expect(persistence.saveState(state)).resolves.toEqual({
      ok: true,
      path: 'desktop',
      accountKey: 'ref-019-persistence',
      cloud: 'firebase-pending'
    });
    expect(desktopSave).toHaveBeenCalledWith(state);
    expect(fetchState).not.toHaveBeenCalled();
    expect(saveFirebaseState).toHaveBeenCalledWith(state);
  });

  it('preserves the selected local persistence failure as the visible save result', async () => {
    const state = buildState();
    const { storage } = createStorage();
    const persistence = createManagementPersistence({
      bridgeBaseUrl: 'http://127.0.0.1:4629',
      fetchState: vi.fn<typeof fetch>(),
      firebaseEnabled: false,
      getDesktopPersistence: () => ({
        saveState: async () => {
          throw new Error('desktop save failed');
        }
      }),
      saveFirebaseState: async () => undefined,
      storage
    });

    await expect(persistence.saveState(state)).rejects.toThrow('desktop save failed');
  });
});
