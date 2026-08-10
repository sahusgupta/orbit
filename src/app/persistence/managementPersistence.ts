import { rendererFirebaseSyncEnabled } from '../../lib/firebaseConfig';
import { saveClubStateToFirebase } from '../../lib/firebaseClubSync';
import { normalizeState } from '../../domain/state';
import type { AppState, PersistedStateRecord, PilotAccess } from '../../domain/types';
import {
  loadBrowserManagementState,
  loadBrowserManagementStateForAccount,
  saveBrowserManagementState,
  type BrowserStorage
} from './browserStateRepository';

type DesktopStatePersistence = {
  loadState?: () => Promise<PersistedStateRecord | null>;
  loadStateForAccount?: (access: PilotAccess) => Promise<PersistedStateRecord | null>;
  onPrepareForUpdate?: (callback: (requestId: string) => void) => () => void;
  preserveStateForUpdate?: (requestId: string, state: AppState) => Promise<{ ok: boolean }>;
  saveState: (state: AppState) => Promise<{ ok: boolean; path: string; accountKey?: string }>;
  validatePilotAccess?: (access: PilotAccess) => Promise<PilotAccessValidationResult>;
};

type ManagementPersistenceDependencies = {
  bridgeBaseUrl: string;
  fetchState: typeof fetch;
  firebaseEnabled: boolean;
  getDesktopPersistence: () => DesktopStatePersistence | undefined;
  saveFirebaseState: (state: AppState) => Promise<unknown>;
  storage: BrowserStorage;
};

export type ManagementSaveResult = {
  ok: boolean;
  path: string;
  accountKey?: string;
  cloud: 'firebase-pending';
};

export type PilotAccessValidationResult = {
  ok: boolean;
  managed: boolean;
  active: boolean;
  license?: {
    licenseId?: string;
    accountKey?: string;
    issuedTo?: string;
    expiresAt?: string;
    status?: string;
  } | null;
  error?: string;
};

export type LocalBridgeStateResult =
  | { status: 'missing' }
  | { status: 'unavailable' }
  | { status: 'available'; state?: AppState };

const defaultBridgeBaseUrl = (import.meta.env.VITE_ORBIT_LOCAL_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');

export const createManagementPersistence = (dependencies: ManagementPersistenceDependencies) => {
  // The loopback bridge is an optional browser-development mirror; its failure
  // must not replace the browser or desktop persistence result.
  const publishStateToLocalBridge = (state: AppState) =>
    dependencies.fetchState(`${dependencies.bridgeBaseUrl}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state })
    }).catch(() => undefined);

  const loadStateFromLocalBridge = async (accountKey: string): Promise<LocalBridgeStateResult> => {
    const response = await dependencies.fetchState(
      `${dependencies.bridgeBaseUrl}/state/${encodeURIComponent(accountKey)}`
    );
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return { status: 'unavailable' };
    const record = await response.json() as { state?: AppState };
    return { status: 'available', state: record.state };
  };

  const loadExistingStateForAccount = async (access: PilotAccess): Promise<AppState | null> => {
    let desktopRecord: PersistedStateRecord | null | undefined;
    try {
      desktopRecord = await dependencies.getDesktopPersistence()?.loadStateForAccount?.(access);
    } catch {
      // Cloud or desktop lookup failures should not block activation of a valid local pilot key.
      desktopRecord = undefined;
    }
    const record = desktopRecord?.state
      ? desktopRecord
      : loadBrowserManagementStateForAccount(access, dependencies.storage);
    if (!record?.state) return null;
    return normalizeState({
      ...record.state,
      settings: {
        ...record.state.settings,
        pilotAccess: access
      }
    });
  };

  const registerUpdatePreservation = (getState: () => AppState) => {
    const desktop = dependencies.getDesktopPersistence();
    if (!desktop?.onPrepareForUpdate || !desktop.preserveStateForUpdate) return undefined;
    return desktop.onPrepareForUpdate((requestId) => {
      void desktop.preserveStateForUpdate?.(requestId, getState());
    });
  };

  const saveState = (state: AppState): Promise<ManagementSaveResult> => {
    saveBrowserManagementState(state, dependencies.storage);
    const desktop = dependencies.getDesktopPersistence();
    const localSave = desktop?.saveState(state) ?? Promise.resolve({ ok: true, path: 'browser-local-storage' });
    if (!desktop) {
      void publishStateToLocalBridge(state);
    }
    if (dependencies.firebaseEnabled) {
      // Firebase is a best-effort fan-out; the local save remains authoritative.
      dependencies.saveFirebaseState(state).catch(() => undefined);
    }
    return localSave.then((result) => ({ ...result, cloud: 'firebase-pending' as const }));
  };

  return {
    getPilotAccessValidator: () => {
      const validatePilotAccess = dependencies.getDesktopPersistence()?.validatePilotAccess;
      return validatePilotAccess ? (access: PilotAccess) => validatePilotAccess(access) : undefined;
    },
    hasDesktopPersistence: () => Boolean(dependencies.getDesktopPersistence()),
    loadDesktopState: () => dependencies.getDesktopPersistence()?.loadState?.(),
    loadDesktopStateForAccount: (access: PilotAccess) =>
      dependencies.getDesktopPersistence()?.loadStateForAccount?.(access),
    loadExistingStateForAccount,
    loadState: () => loadBrowserManagementState(dependencies.storage),
    loadStateFromLocalBridge,
    publishStateToLocalBridge,
    registerUpdatePreservation,
    saveDesktopState: (state: AppState) => dependencies.getDesktopPersistence()?.saveState(state),
    saveState
  };
};

const getDefaultManagementPersistence = () => createManagementPersistence({
  bridgeBaseUrl: defaultBridgeBaseUrl,
  fetchState: (...args) => fetch(...args),
  firebaseEnabled: rendererFirebaseSyncEnabled,
  getDesktopPersistence: () => window.tableManagerDesktop,
  saveFirebaseState: saveClubStateToFirebase,
  storage: localStorage
});

export const canUseRendererFirebaseAuth = () => rendererFirebaseSyncEnabled;
export const getManagementPilotAccessValidator = () =>
  getDefaultManagementPersistence().getPilotAccessValidator();
export const hasManagementDesktopPersistence = () =>
  getDefaultManagementPersistence().hasDesktopPersistence();
export const loadDesktopManagementState = () =>
  getDefaultManagementPersistence().loadDesktopState();
export const loadDesktopManagementStateForAccount = (access: PilotAccess) =>
  getDefaultManagementPersistence().loadDesktopStateForAccount(access);
export const loadExistingManagementStateForAccount = (access: PilotAccess) =>
  getDefaultManagementPersistence().loadExistingStateForAccount(access);
export const loadManagementState = () => getDefaultManagementPersistence().loadState();
export const loadManagementStateFromLocalBridge = (accountKey: string) =>
  getDefaultManagementPersistence().loadStateFromLocalBridge(accountKey);
export const publishStateToLocalOrbitBridge = (state: AppState) =>
  getDefaultManagementPersistence().publishStateToLocalBridge(state);
export const registerManagementUpdatePreservation = (getState: () => AppState) =>
  getDefaultManagementPersistence().registerUpdatePreservation(getState);
export const saveDesktopManagementState = (state: AppState) =>
  getDefaultManagementPersistence().saveDesktopState(state);
export const saveManagementState = (state: AppState) => getDefaultManagementPersistence().saveState(state);
