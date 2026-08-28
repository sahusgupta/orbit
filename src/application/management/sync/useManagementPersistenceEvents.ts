import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import {
  isManagementStateStorageEvent
} from '../../../app/persistence/browserStateRepository';
import {
  loadManagementState,
  registerManagementUpdatePreservation
} from '../../../app/persistence/managementPersistence';

export const useManagementUpdatePreservation = (state: AppState) => {
  useEffect(() => {
    return registerManagementUpdatePreservation(() => state);
  }, [state]);
};

export const useManagementStorageSync = (
  setState: Dispatch<SetStateAction<AppState>>,
  clearUndo: () => void = () => undefined
) => {
  useEffect(() => {
    const syncState = (event: StorageEvent) => {
      if (isManagementStateStorageEvent(event)) {
        clearUndo();
        setState(loadManagementState());
      }
    };

    window.addEventListener('storage', syncState);
    return () => window.removeEventListener('storage', syncState);
  }, []);
};
