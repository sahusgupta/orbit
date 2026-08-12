import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { normalizeState } from '../../../domain/state';
import { hasPersistedSignIn } from '../../../domain/licensing';
import type { AppState } from '../../../domain/types';
import { saveBrowserManagementState } from '../../../app/persistence/browserStateRepository';
import { loadDesktopManagementState } from '../../../app/persistence/managementPersistence';

type ManagementSaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };

type ManagementStartupSyncOptions = {
  hasAuthenticated: boolean;
  setHasAuthenticated: Dispatch<SetStateAction<boolean>>;
  setSaveStatus: (status: ManagementSaveStatus) => void;
  setState: Dispatch<SetStateAction<AppState>>;
  setUndoStack: Dispatch<SetStateAction<AppState[]>>;
  state: AppState;
};

export const useManagementStartupSync = ({
  hasAuthenticated,
  setHasAuthenticated,
  setSaveStatus,
  setState,
  setUndoStack,
  state: _state
}: ManagementStartupSyncOptions) => {
  useEffect(() => {
    // Browser state initializes the shell while the trusted desktop boundary
    // loads authoritative server state or its explicitly labelled offline cache.
    loadDesktopManagementState()?.then((record) => {
      if (record?.state) {
        const next = normalizeState(record.state);
        setUndoStack([]);
        setState(next);
        setHasAuthenticated(hasPersistedSignIn(next));
        saveBrowserManagementState(next);
        setSaveStatus(record.authoritative === false
          ? { state: 'error', message: 'Offline cache loaded; server reconciliation required' }
          : { state: 'saved', message: 'Authoritative state loaded' });
      }
    }).catch(() => undefined);
  }, []);
};
