import { rendererFirebaseSyncEnabled } from '../../lib/firebaseConfig';
import { normalizeState, seedState } from '../../domain/state';
import { getAccountKeyFromAccess, getAccountKeyFromState } from '../../domain/licensing';
import type { AppState, PersistedStateRecord, PilotAccess } from '../../domain/types';
import type { ManagementSaveResult } from '../../domain/managementSaveResult';
import { checkpointSourceLimit } from './checkpointProtocol';
import { getManagementStatePayloadBytes, maximumManagementStatePayloadBytes } from './managementStatePayload';
import { loadBrowserManagementState, loadBrowserManagementStateForAccount, saveBrowserManagementState } from './browserStateRepository';
import type { createBrowserManagementPersistence } from './browserManagementPersistence';
import type { DesktopStatePersistence, LocalBridgeReadOptions, ManagementPersistenceDependencies, ManagementStateSubscriptionEvent } from './managementPersistenceContracts';

export type { ManagementSaveResult } from '../../domain/managementSaveResult';
export { BrowserManagementRecoveryError } from './managementPersistenceContracts';
export type { LocalBridgeStateResult, PilotAccessValidationResult, ManagementStateSubscriptionEvent } from './managementPersistenceContracts';

const defaultBridgeBaseUrl = (import.meta.env.VITE_ORBIT_LOCAL_API_URL || 'http://127.0.0.1:4629').replace(/\/$/, '');

/** Desktop startup needs only its trusted bridge. Browser recovery loads on use. */
export const createManagementPersistence = (dependencies: ManagementPersistenceDependencies) => {
  type BrowserPersistence = ReturnType<typeof createBrowserManagementPersistence>;
  let browser: BrowserPersistence | undefined;
  let browserLoading: Promise<BrowserPersistence> | undefined;
  const desktopPendingByAccount = new Map<string, string>();

  const getBrowser = () => browserLoading ??= import('./browserManagementPersistence').then((module) => {
    browser = module.createBrowserManagementPersistence({ ...dependencies, getDesktopPersistence: () => undefined });
    return browser;
  }).catch((error) => {
    browserLoading = undefined;
    throw error;
  });

  const observeDesktopRecord = (record: PersistedStateRecord | null | undefined, access?: PilotAccess) => {
    if (record) {
      const accountKey = record.accountKey || (access && getAccountKeyFromAccess(access)) || getAccountKeyFromAccess(record.state.settings?.pilotAccess)
        || getAccountKeyFromState({ settings: { ...seedState.settings, clubAccount: record.state.settings?.clubAccount } });
      if (record.pending) desktopPendingByAccount.set(accountKey, 'Pending desktop work is retained. Wait for confirmation or reconcile it before accepting another change.');
      else if (record.authoritative === true) desktopPendingByAccount.delete(accountKey);
    }
    return record;
  };
  const loadDesktopState = () => dependencies.getDesktopPersistence()?.loadState?.().then((record) => observeDesktopRecord(record));
  const loadDesktopStateForAccount = (access: PilotAccess) => dependencies.getDesktopPersistence()?.loadStateForAccount?.(access)
    .then((record) => observeDesktopRecord(record, access));

  const loadExistingStateForAccount = async (access: PilotAccess): Promise<AppState | null> => {
    if (!dependencies.getDesktopPersistence()) return (await getBrowser()).loadExistingStateForAccount(access);
    let desktopRecord: PersistedStateRecord | null | undefined;
    try { desktopRecord = await loadDesktopStateForAccount(access); }
    catch {
      // An unavailable authoritative read can still expose its labelled local cache.
      desktopRecord = undefined;
    }
    const record = desktopRecord?.state ? desktopRecord : loadBrowserManagementStateForAccount(access, dependencies.storage);
    if (!record?.state) return null;
    return normalizeState({ ...record.state, settings: { ...record.state.settings, pilotAccess: access } });
  };

  const registerUpdatePreservation = (getState: () => AppState) => {
    const desktop = dependencies.getDesktopPersistence();
    if (!desktop?.onPrepareForUpdate || !desktop.preserveStateForUpdate) return undefined;
    return desktop.onPrepareForUpdate((requestId) => { void desktop.preserveStateForUpdate?.(requestId, getState()); });
  };

  const saveState = async (state: AppState): Promise<ManagementSaveResult> => {
    const desktop = dependencies.getDesktopPersistence();
    if (!desktop) return (await getBrowser()).saveState(state);
    if (desktop.getPersistenceCapabilities && getManagementStatePayloadBytes(state) > maximumManagementStatePayloadBytes) {
      // The main process preserves pending intent even if negotiation is offline.
      try { await desktop.getPersistenceCapabilities(state.settings.pilotAccess); }
      catch { /* The durable main-process save still handles unavailable negotiation. */ }
    }
    const result: Awaited<ReturnType<DesktopStatePersistence['saveState']>> = await desktop.saveState(state);
    const accountKey = getAccountKeyFromState(state);
    if (result.pending) desktopPendingByAccount.set(accountKey, result.error || 'Pending desktop work requires server confirmation.');
    else if (result.ok) desktopPendingByAccount.delete(accountKey);
    if (result.ok || result.pending) saveBrowserManagementState(state, dependencies.storage);
    const publicationStatus = String(result.publication?.status || '');
    return { ...result, cloud: !result.ok ? 'not-committed' : publicationStatus === 'published' ? 'published'
      : publicationStatus === 'failed' ? 'failed' : 'server-pending' };
  };

  return {
    getPilotAccessValidator: () => {
      const validate = dependencies.getDesktopPersistence()?.validatePilotAccess;
      return validate ? (access: PilotAccess) => validate(access) : undefined;
    },
    hasDesktopPersistence: () => Boolean(dependencies.getDesktopPersistence()),
    getDurablePendingAdmission: (accountKey: string): { pending: boolean; error?: string } => {
      if (dependencies.getDesktopPersistence()) {
        const error = desktopPendingByAccount.get(accountKey);
        return { pending: Boolean(error), ...(error ? { error } : {}) };
      }
      // Importing an optional read path is not pending business intent. The
      // renderer's synchronous save counter guards mutations during startup.
      return browser?.getDurablePendingAdmission(accountKey) ?? { pending: false };
    },
    getSaveAdmissionBytes: () => {
      const desktop = dependencies.getDesktopPersistence();
      return !desktop || desktop.getPersistenceCapabilities ? checkpointSourceLimit : maximumManagementStatePayloadBytes;
    },
    loadDesktopState,
    loadDesktopStateForAccount,
    subscribeToDesktopStateForAccount: (access: PilotAccess, onEvent: (event: ManagementStateSubscriptionEvent) => void) =>
      dependencies.getDesktopPersistence()?.subscribeToManagementState?.(access, onEvent),
    loadExistingStateForAccount,
    loadState: () => loadBrowserManagementState(dependencies.storage),
    loadStateFromLocalBridge: async (accountKey: string, canAcceptRead?: () => boolean, options?: LocalBridgeReadOptions) =>
      (await getBrowser()).loadStateFromLocalBridge(accountKey, canAcceptRead, options),
    publishStateToLocalBridge: async (state: AppState) => (await getBrowser()).publishStateToLocalBridge(state),
    registerUpdatePreservation,
    saveDesktopState: (state: AppState) => dependencies.getDesktopPersistence()?.saveState(state),
    saveState
  };
};

let defaultManagementPersistence: ReturnType<typeof createManagementPersistence> | undefined;
const getDefaultManagementPersistence = () => defaultManagementPersistence ??= createManagementPersistence({
  bridgeBaseUrl: defaultBridgeBaseUrl,
  fetchState: (...args) => fetch(...args),
  firebaseEnabled: rendererFirebaseSyncEnabled,
  getDesktopPersistence: () => window.tableManagerDesktop,
  saveFirebaseState: async () => undefined,
  storage: localStorage
});

export const canUseRendererFirebaseAuth = () => rendererFirebaseSyncEnabled;
export const getManagementPilotAccessValidator = () => getDefaultManagementPersistence().getPilotAccessValidator();
export const hasManagementDesktopPersistence = () => getDefaultManagementPersistence().hasDesktopPersistence();
export const getManagementSaveAdmissionBytes = () => getDefaultManagementPersistence().getSaveAdmissionBytes();
export const getManagementDurablePendingAdmission = (accountKey: string) => getDefaultManagementPersistence().getDurablePendingAdmission(accountKey);
export const loadDesktopManagementState = () => getDefaultManagementPersistence().loadDesktopState();
export const loadDesktopManagementStateForAccount = (access: PilotAccess) => getDefaultManagementPersistence().loadDesktopStateForAccount(access);
export const subscribeToDesktopManagementStateForAccount = (access: PilotAccess, onEvent: (event: ManagementStateSubscriptionEvent) => void) =>
  getDefaultManagementPersistence().subscribeToDesktopStateForAccount(access, onEvent);
export const loadExistingManagementStateForAccount = (access: PilotAccess) => getDefaultManagementPersistence().loadExistingStateForAccount(access);
export const loadManagementState = () => getDefaultManagementPersistence().loadState();
export const loadManagementStateFromLocalBridge = (accountKey: string, canAcceptRead?: () => boolean, options?: LocalBridgeReadOptions) =>
  getDefaultManagementPersistence().loadStateFromLocalBridge(accountKey, canAcceptRead, options);
export const publishStateToLocalOrbitBridge = (state: AppState) => getDefaultManagementPersistence().publishStateToLocalBridge(state);
export const registerManagementUpdatePreservation = (getState: () => AppState) => getDefaultManagementPersistence().registerUpdatePreservation(getState);
export const saveDesktopManagementState = (state: AppState) => getDefaultManagementPersistence().saveDesktopState(state);
export const saveManagementState = (state: AppState) => getDefaultManagementPersistence().saveState(state);
