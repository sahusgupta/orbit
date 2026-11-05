import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { normalizeState } from '../../../domain/state';
import { restorePersistedSignIn } from '../../../domain/licensing';
import type { AppState } from '../../../domain/types';
import { saveBrowserManagementState } from '../../../app/persistence/browserStateRepository';
import { loadDesktopManagementState } from '../../../app/persistence/managementPersistence';

type ManagementSaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };

type ManagementStartupSyncOptions = {
  getCurrentState: () => AppState;
  hasAuthenticated: boolean;
  setHasAuthenticated: Dispatch<SetStateAction<boolean>>;
  setSaveStatus: (status: ManagementSaveStatus) => void;
  setState: Dispatch<SetStateAction<AppState>>;
  clearUndo: () => void;
  onPendingState?: (state: AppState) => void;
};

export const useManagementStartupSync = ({
  getCurrentState,
  hasAuthenticated,
  setHasAuthenticated,
  setSaveStatus,
  setState,
  clearUndo,
  onPendingState
}: ManagementStartupSyncOptions) => {
  useEffect(() => {
    // Browser state initializes the shell while the trusted desktop boundary
    // loads authoritative server state or its explicitly labelled offline cache.
    const stateWhenLoadStarted = getCurrentState();
    loadDesktopManagementState()?.then(async (record) => {
      if (record?.state) {
        if (getCurrentState() !== stateWhenLoadStarted) {
          console.info('[management-startup-sync] skipped stale hydration', {
            reason: 'state-changed-during-load'
          });
          return;
        }
        const next = normalizeState(record.state);
        const authenticated = await restorePersistedSignIn(next);
        if (getCurrentState() !== stateWhenLoadStarted) return;
        if (record.pending) onPendingState?.(next);
        clearUndo();
        setState(next);
        setHasAuthenticated(authenticated);
        saveBrowserManagementState(next);
        setSaveStatus(record.authoritative === false
          ? { state: 'error', message: record.pending ? 'Pending locally; server confirmation required' : 'Offline cache loaded; server reconciliation required' }
          : { state: 'saved', message: 'Authoritative state loaded' });
      }
    }).catch(() => undefined);
  }, []);
};
