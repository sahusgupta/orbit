import { rendererFirebaseSyncEnabled } from '../../lib/firebaseConfig';
import { saveClubStateToFirebase } from '../../lib/firebaseClubSync';
import type { AppState } from '../../domain/types';
import {
  loadBrowserManagementState,
  saveBrowserManagementState,
  type BrowserStorage
} from './browserStateRepository';

type DesktopStatePersistence = {
  saveState: (state: AppState) => Promise<{ ok: boolean; path: string; accountKey?: string }>;
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

const defaultBridgeBaseUrl = (import.meta.env.VITE_ORBIT_LOCAL_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');

export const createManagementPersistence = (dependencies: ManagementPersistenceDependencies) => {
  const publishStateToLocalBridge = (state: AppState) =>
    dependencies.fetchState(`${dependencies.bridgeBaseUrl}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state })
    }).catch(() => undefined);

  const saveState = (state: AppState): Promise<ManagementSaveResult> => {
    saveBrowserManagementState(state, dependencies.storage);
    const desktop = dependencies.getDesktopPersistence();
    const localSave = desktop?.saveState(state) ?? Promise.resolve({ ok: true, path: 'browser-local-storage' });
    if (!desktop) {
      void publishStateToLocalBridge(state);
    }
    if (dependencies.firebaseEnabled) {
      dependencies.saveFirebaseState(state).catch(() => undefined);
    }
    return localSave.then((result) => ({ ...result, cloud: 'firebase-pending' as const }));
  };

  return {
    loadState: () => loadBrowserManagementState(dependencies.storage),
    publishStateToLocalBridge,
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
export const localOrbitBridgeBaseUrl = defaultBridgeBaseUrl;
export const loadManagementState = () => getDefaultManagementPersistence().loadState();
export const publishStateToLocalOrbitBridge = (state: AppState) =>
  getDefaultManagementPersistence().publishStateToLocalBridge(state);
export const saveManagementState = (state: AppState) => getDefaultManagementPersistence().saveState(state);
