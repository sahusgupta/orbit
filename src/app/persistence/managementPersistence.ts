import { rendererFirebaseSyncEnabled } from '../../lib/firebaseConfig';
import { normalizeState } from '../../domain/state';
import { getAccountKeyFromState } from '../../domain/licensing';
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
  saveState: (state: AppState) => Promise<{
    ok: boolean;
    path: string;
    accountKey?: string;
    revision?: number;
    conflict?: boolean;
    error?: string;
    publication?: { status?: string };
  }>;
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
  revision?: number;
  conflict?: boolean;
  error?: string;
  cloud: 'server-pending' | 'published' | 'failed' | 'not-committed';
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
  const bridgeRevisionByAccount = new Map<string, number>();

  const publishStateToLocalBridge = async (state: AppState) => {
    const accountKey = getAccountKeyFromState(state);
    const expectedRevision = bridgeRevisionByAccount.get(accountKey) ?? 0;
    const mutationId = `browser:${accountKey}:${expectedRevision}:${globalThis.crypto.randomUUID()}`;
    const response = await dependencies.fetchState(`${dependencies.bridgeBaseUrl}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orbit-mutation-id': mutationId },
      body: JSON.stringify({ state, expectedRevision, mutationId })
    });
    const payload = await response.json().catch(() => ({})) as {
      ok?: boolean;
      revision?: number;
      currentRevision?: number;
      publication?: { status?: string };
      error?: string;
    };
    if (response.status === 409) {
      bridgeRevisionByAccount.set(accountKey, Number(payload.currentRevision || expectedRevision));
      return { ok: false, path: 'orbit-api', accountKey, conflict: true, error: payload.error };
    }
    if (!response.ok || !payload.ok) return { ok: false, path: 'orbit-api', accountKey, error: payload.error };
    bridgeRevisionByAccount.set(accountKey, Number(payload.revision || expectedRevision + 1));
    return {
      ok: true,
      path: 'orbit-api',
      accountKey,
      revision: Number(payload.revision || expectedRevision + 1),
      publication: payload.publication
    };
  };

  const loadStateFromLocalBridge = async (accountKey: string): Promise<LocalBridgeStateResult> => {
    const response = await dependencies.fetchState(
      `${dependencies.bridgeBaseUrl}/state/${encodeURIComponent(accountKey)}`
    );
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return { status: 'unavailable' };
    const record = await response.json() as { accountKey?: string; revision?: number; state?: AppState };
    if (record.accountKey) bridgeRevisionByAccount.set(record.accountKey, Number(record.revision || 0));
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

  const saveState = async (state: AppState): Promise<ManagementSaveResult> => {
    saveBrowserManagementState(state, dependencies.storage);
    const desktop = dependencies.getDesktopPersistence();
    const result: Awaited<ReturnType<DesktopStatePersistence['saveState']>> = desktop
      ? await desktop.saveState(state)
      : await publishStateToLocalBridge(state).catch((error) => ({
          ok: false,
          path: 'browser-local-storage',
          error: error instanceof Error ? error.message : 'Authoritative server save failed.'
        }));
    const publicationStatus = String(result.publication?.status || '');
    return {
      ...result,
      cloud: !result.ok
        ? 'not-committed'
        : publicationStatus === 'published'
          ? 'published'
          : publicationStatus === 'failed'
            ? 'failed'
            : 'server-pending'
    };
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
  saveFirebaseState: async () => undefined,
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
