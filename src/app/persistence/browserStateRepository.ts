import { normalizeState, parsePersistedAppState, seedState } from '../../domain/state';
import {
  getAccountKeyFromAccess,
  getStorageKeyForState,
  managementStorageKey
} from '../../domain/licensing';
import type { AppState, PersistedAppState, PilotAccess } from '../../domain/types';

export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type BrowserAccountStateRecord = {
  state: PersistedAppState;
};

export const lastAccountStorageKey = `${managementStorageKey}:last-account`;

export const loadBrowserManagementState = (storage: BrowserStorage = localStorage): AppState => {
  try {
    const lastKey = storage.getItem(lastAccountStorageKey);
    const stored = storage.getItem(lastKey || managementStorageKey) ?? storage.getItem(managementStorageKey);
    if (!stored) return seedState;
    const parsed = parsePersistedAppState(stored);
    return parsed ? normalizeState(parsed) : seedState;
  } catch {
    return seedState;
  }
};

export const saveBrowserManagementState = (
  state: AppState,
  storage: BrowserStorage = localStorage
) => {
  const accountStorageKey = getStorageKeyForState(state);
  storage.setItem(accountStorageKey, JSON.stringify(state));
  storage.setItem(lastAccountStorageKey, accountStorageKey);
  return accountStorageKey;
};

export const loadBrowserManagementStateForAccount = (
  access: PilotAccess,
  storage: BrowserStorage = localStorage
): BrowserAccountStateRecord | null => {
  const stored = storage.getItem(`${managementStorageKey}:${getAccountKeyFromAccess(access)}`);
  if (!stored) return null;
  const state = parsePersistedAppState(stored);
  return state ? { state } : null;
};

export const isManagementStateStorageEvent = (
  event: Pick<StorageEvent, 'key'>,
  storage: BrowserStorage = localStorage
) => event.key === storage.getItem(lastAccountStorageKey) || event.key === managementStorageKey;
