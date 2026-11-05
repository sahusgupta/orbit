import type { AppState, PersistedStateRecord, PilotAccess } from '../../domain/types';
import type { createBrowserCheckpointJournal } from './browserCheckpointJournal';
import type { BrowserStorage } from './browserStateRepository';

export type ManagementStateSubscriptionEvent =
  | { type: 'change'; revision: number }
  | { type: 'status'; connected: boolean };

export type DesktopStatePersistence = {
  getPersistenceCapabilities?: (access?: PilotAccess) => Promise<unknown>;
  loadState?: () => Promise<PersistedStateRecord | null>;
  loadStateForAccount?: (access: PilotAccess) => Promise<PersistedStateRecord | null>;
  subscribeToManagementState?: (access: PilotAccess, onEvent: (event: ManagementStateSubscriptionEvent) => void) => () => void;
  onPrepareForUpdate?: (callback: (requestId: string) => void) => () => void;
  preserveStateForUpdate?: (requestId: string, state: AppState) => Promise<{ ok: boolean }>;
  saveState: (state: AppState) => Promise<{
    ok: boolean;
    path: string;
    accountKey?: string;
    revision?: number;
    conflict?: boolean;
    pending?: boolean;
    error?: string;
    publication?: { status?: string };
  }>;
  validatePilotAccess?: (access: PilotAccess) => Promise<PilotAccessValidationResult>;
};

export type ManagementPersistenceDependencies = {
  bridgeBaseUrl: string;
  fetchState: typeof fetch;
  firebaseEnabled: boolean;
  getDesktopPersistence: () => DesktopStatePersistence | undefined;
  saveFirebaseState: (state: AppState) => Promise<unknown>;
  storage: BrowserStorage;
  checkpointJournal?: ReturnType<typeof createBrowserCheckpointJournal>;
  now?: () => number;
  random?: () => number;
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
  | { status: 'available'; state?: AppState; acceptReadRevision?: () => boolean };

export type LocalBridgeReadOptions = { deferRevisionAcceptance?: boolean };

export class BrowserManagementRecoveryError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BrowserManagementRecoveryError';
  }
}
