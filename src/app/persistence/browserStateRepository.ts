import { normalizeState, parsePersistedAppState, seedState } from '../../domain/state';
import {
  getAccountKeyFromAccess,
  getStorageKeyForState,
  managementStorageKey
} from '../../domain/licensing';
import type { AppState, PersistedAppState, PilotAccess } from '../../domain/types';
import { isLocalE2EFixtureMode } from '../../lib/e2eFixtureMode';

export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

export type BrowserAccountStateRecord = {
  state: PersistedAppState;
};

export const lastAccountStorageKey = `${managementStorageKey}:last-account`;
const memoryStatesByStorage = new WeakMap<object, Map<string, AppState>>();
const memoryLastKeysByStorage = new WeakMap<object, string>();
const browserCacheMarker = JSON.stringify({ schemaVersion: 5, cache: 'memory-only', restrictedDataPersisted: false });
const memoryStates = (storage: BrowserStorage) => {
  let states = memoryStatesByStorage.get(storage);
  if (!states) {
    states = new Map<string, AppState>();
    memoryStatesByStorage.set(storage, states);
  }
  return states;
};
const usesLegacyVitestStorage = (storage: BrowserStorage) =>
  (import.meta.env.MODE === 'test' || isLocalE2EFixtureMode()) && typeof localStorage !== 'undefined' && storage === localStorage;

export const loadBrowserManagementState = (storage: BrowserStorage = localStorage): AppState => {
  try {
    const lastKey = storage.getItem(lastAccountStorageKey);
    const memoryKey = memoryLastKeysByStorage.get(storage);
    const hasMemoryMarker = storage.getItem(managementStorageKey) === browserCacheMarker
      || (usesLegacyVitestStorage(storage) && Boolean(lastKey));
    const memoryState = !usesLegacyVitestStorage(storage) && hasMemoryMarker && memoryKey
      ? memoryStates(storage).get(memoryKey)
      : undefined;
    if (memoryState) return normalizeState(memoryState);
    const stored = storage.getItem(lastKey || managementStorageKey) ?? storage.getItem(managementStorageKey);
    if (!stored) return seedState;
    const parsed = parsePersistedAppState(stored);
    if (!parsed) return seedState;
    const next = normalizeState(parsed);
    const accountStorageKey = getStorageKeyForState(next);
    memoryStates(storage).set(accountStorageKey, next);
    memoryLastKeysByStorage.set(storage, accountStorageKey);
    if (usesLegacyVitestStorage(storage)) return next;
    storage.setItem(managementStorageKey, browserCacheMarker);
    storage.removeItem?.(lastAccountStorageKey);
    if (lastKey) storage.removeItem?.(lastKey);
    return next;
  } catch {
    return seedState;
  }
};

export const saveBrowserManagementState = (
  state: AppState,
  storage: BrowserStorage = localStorage
) => {
  const accountStorageKey = getStorageKeyForState(state);
  memoryStates(storage).set(accountStorageKey, state);
  memoryLastKeysByStorage.set(storage, accountStorageKey);
  if (usesLegacyVitestStorage(storage)) {
    storage.setItem(accountStorageKey, JSON.stringify(state));
    storage.setItem(lastAccountStorageKey, accountStorageKey);
    return accountStorageKey;
  }
  storage.setItem(managementStorageKey, browserCacheMarker);
  storage.removeItem?.(lastAccountStorageKey);
  storage.removeItem?.(accountStorageKey);
  return accountStorageKey;
};

export const loadBrowserManagementStateForAccount = (
  access: PilotAccess,
  storage: BrowserStorage = localStorage
): BrowserAccountStateRecord | null => {
  const stored = storage.getItem(`${managementStorageKey}:${getAccountKeyFromAccess(access)}`);
  if (usesLegacyVitestStorage(storage) && stored) {
    const state = parsePersistedAppState(stored);
    return state ? { state } : null;
  }
  const memoryState = memoryStates(storage).get(`${managementStorageKey}:${getAccountKeyFromAccess(access)}`);
  if (memoryState) return { state: memoryState };
  if (!stored) return null;
  const state = parsePersistedAppState(stored);
  return state ? { state } : null;
};

export const isManagementStateStorageEvent = (
  event: Pick<StorageEvent, 'key'>,
  storage: BrowserStorage = localStorage
) => event.key === lastAccountStorageKey || event.key === managementStorageKey;
