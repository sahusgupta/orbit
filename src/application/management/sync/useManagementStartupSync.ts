import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { normalizeState } from '../../../domain/state';
import { getAccountKeyFromState, hasPersistedSignIn } from '../../../domain/licensing';
import type { AppState } from '../../../domain/types';
import { loadClubStateFromFirebase, saveClubStateToFirebase } from '../../../lib/firebaseClubSync';
import { saveBrowserManagementState } from '../../../app/persistence/browserStateRepository';
import {
  canUseRendererFirebaseAuth,
  loadDesktopManagementState
} from '../../../app/persistence/managementPersistence';

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
  state
}: ManagementStartupSyncOptions) => {
  const hasPublishedStartupSnapshot = useRef(false);

  useEffect(() => {
    loadDesktopManagementState()?.then((record) => {
      if (record?.state) {
        const next = normalizeState(record.state);
        setUndoStack([]);
        setState(next);
        setHasAuthenticated(hasPersistedSignIn(next));
        saveBrowserManagementState(next);
        if (canUseRendererFirebaseAuth()) {
          loadClubStateFromFirebase(getAccountKeyFromState(next))
            .then((cloudRecord) => {
              if (!cloudRecord?.state) {
                saveClubStateToFirebase(next).catch(() => undefined);
                return;
              }
              if (cloudRecord.savedAt && record.savedAt && cloudRecord.savedAt <= record.savedAt) return;
              const cloudState = normalizeState(cloudRecord.state);
              setUndoStack([]);
              setState(cloudState);
              setHasAuthenticated(hasPersistedSignIn(cloudState));
              saveBrowserManagementState(cloudState);
              setSaveStatus({ state: 'saved', message: 'Synced from Firebase' });
            })
            .catch(() => undefined);
        }
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hasAuthenticated || !canUseRendererFirebaseAuth()) {
      hasPublishedStartupSnapshot.current = false;
      return;
    }
    if (hasPublishedStartupSnapshot.current) return;
    hasPublishedStartupSnapshot.current = true;
    saveClubStateToFirebase(state).catch(() => {
      hasPublishedStartupSnapshot.current = false;
    });
  }, [hasAuthenticated, state]);
};
