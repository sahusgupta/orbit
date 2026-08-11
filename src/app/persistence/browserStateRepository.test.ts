import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, PilotAccess } from '../../domain/types';
import {
  isManagementStateStorageEvent,
  lastAccountStorageKey,
  loadBrowserManagementState,
  loadBrowserManagementStateForAccount,
  saveBrowserManagementState,
  type BrowserStorage
} from './browserStateRepository';

const access: PilotAccess = {
  authorized: true,
  authorizationCode: 'REF-019-REPOSITORY-CODE',
  expiresAt: '2099-12-31T23:59:59.000Z',
  activatedAt: '2026-08-08T12:00:00.000Z',
  licenseId: 'ref-019-repository'
};

const buildState = (marker: string): AppState => ({
  ...structuredClone(seedState),
  games: [{
    id: 'repository-game',
    name: marker,
    maxSeats: 8,
    minInRoomForLikely: 2,
    minFlexibleForLikely: 3,
    minTotalForViable: 6
  }],
  settings: {
    ...structuredClone(seedState.settings),
    pilotAccess: access
  }
});

const createStorage = (entries: Array<[string, string]> = []) => {
  const values = new Map(entries);
  const storage: BrowserStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => { values.delete(key); }
  };
  return { storage, values };
};

describe('browser management state repository', () => {
  it('loads the selected account before the base record and normalizes malformed or missing data to seed state', () => {
    const base = buildState('base');
    const selected = buildState('selected');
    const selectedKey = 'table-manager-state-v1:ref-019-repository';
    const { storage } = createStorage([
      ['table-manager-state-v1', JSON.stringify(base)],
      [lastAccountStorageKey, selectedKey],
      [selectedKey, JSON.stringify(selected)]
    ]);

    expect(loadBrowserManagementState(storage).games[0].name).toBe('selected');

    const malformed = createStorage([[lastAccountStorageKey, selectedKey], [selectedKey, '{invalid']]);
    expect(loadBrowserManagementState(malformed.storage)).toEqual(seedState);
    expect(loadBrowserManagementState(createStorage().storage)).toEqual(seedState);
  });

  it('writes the account partition and marker, restores that account, and identifies related storage events', () => {
    const state = buildState('saved');
    const { storage, values } = createStorage();
    const accountKey = saveBrowserManagementState(state, storage);

    expect(accountKey).toBe('table-manager-state-v1:ref-019-repository');
    expect(values.has(lastAccountStorageKey)).toBe(false);
    expect(values.has(accountKey)).toBe(false);
    expect(JSON.parse(values.get('table-manager-state-v1') ?? '{}')).toEqual({
      schemaVersion: 5,
      cache: 'memory-only',
      restrictedDataPersisted: false
    });
    expect(loadBrowserManagementStateForAccount(access, storage)?.state).toMatchObject({ games: [{ name: 'saved' }] });
    expect(isManagementStateStorageEvent({ key: accountKey }, storage)).toBe(false);
    expect(isManagementStateStorageEvent({ key: 'table-manager-state-v1' }, storage)).toBe(true);
    expect(isManagementStateStorageEvent({ key: 'unrelated' }, storage)).toBe(false);
  });
});
