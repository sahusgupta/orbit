import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import {
  isManagementStateStorageEvent
} from '../../../app/persistence/browserStateRepository';
import { loadManagementState } from '../../../app/persistence/managementPersistence';

export const useManagementUpdatePreservation = (state: AppState) => {
  useEffect(() => {
    const desktop = window.tableManagerDesktop;
    if (!desktop?.onPrepareForUpdate) return undefined;
    return desktop.onPrepareForUpdate((requestId) => {
      void desktop.preserveStateForUpdate(requestId, state);
    });
  }, [state]);
};

export const useManagementStorageSync = (setState: Dispatch<SetStateAction<AppState>>) => {
  useEffect(() => {
    const syncState = (event: StorageEvent) => {
      if (isManagementStateStorageEvent(event)) {
        setState(loadManagementState());
      }
    };

    window.addEventListener('storage', syncState);
    return () => window.removeEventListener('storage', syncState);
  }, []);
};
