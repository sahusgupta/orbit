import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import { normalizeState } from '../../../domain/state';
import { mergeSyncedList } from '../../../lib/syncedList';
import {
  hasManagementDesktopPersistence,
  loadDesktopManagementStateForAccount,
  loadManagementStateFromLocalBridge,
  publishStateToLocalOrbitBridge
} from '../../../app/persistence/managementPersistence';
import { saveBrowserManagementState } from '../../../app/persistence/browserStateRepository';

type ManagementSaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };

type ManagementPlayerUpdateSyncOptions = {
  activeAccountKey: string;
  announceIncomingPlayerRequest: (previousState: AppState, nextState: AppState) => void;
  hasAuthenticated: boolean;
  setSaveStatus: (status: ManagementSaveStatus) => void;
  setState: Dispatch<SetStateAction<AppState>>;
  setUndoStack: Dispatch<SetStateAction<AppState[]>>;
  state: AppState;
  stateRef: MutableRefObject<AppState>;
};

export const useManagementPlayerUpdateSync = ({
  activeAccountKey,
  announceIncomingPlayerRequest,
  hasAuthenticated,
  setSaveStatus,
  setState,
  setUndoStack: _setUndoStack,
  state,
  stateRef
}: ManagementPlayerUpdateSyncOptions) => {
  useEffect(() => {
    if (!hasAuthenticated || !activeAccountKey || hasManagementDesktopPersistence()) return;
    let cancelled = false;
    let bridgeInitialized = false;

    const syncLocalPlayerUpdates = async () => {
      try {
        const record = await loadManagementStateFromLocalBridge(activeAccountKey);
        if (record.status === 'missing') {
          if (!bridgeInitialized) {
            const published = await publishStateToLocalOrbitBridge(stateRef.current);
            bridgeInitialized = Boolean(published?.ok);
          }
          return;
        }
        if (record.status === 'unavailable') return;
        bridgeInitialized = true;
        if (cancelled || !record.state) return;
        const latestState = stateRef.current;
        announceIncomingPlayerRequest(latestState, record.state);
        const sameProfiles = JSON.stringify(record.state.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(record.state.interests) === JSON.stringify(latestState.interests);
        if (sameProfiles && sameInterests) return;
        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, record.state.profiles ?? []),
          interests: mergeSyncedList(latestState.interests, record.state.interests ?? [])
        };
        stateRef.current = mergedState;
        setState(mergedState);
        saveBrowserManagementState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player app updates synced' });
      } catch {
        // The local bridge is optional when Core is running without the linked dev command.
      }
    };

    void syncLocalPlayerUpdates();
    const timer = window.setInterval(() => void syncLocalPlayerUpdates(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAccountKey, hasAuthenticated]);

  useEffect(() => {
    if (!hasAuthenticated || !activeAccountKey || !hasManagementDesktopPersistence() || !state.settings.pilotAccess) return;
    let cancelled = false;
    let syncInFlight = false;

    const syncDesktopApiUpdates = async () => {
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        const record = await loadDesktopManagementStateForAccount(state.settings.pilotAccess!);
        if (cancelled || !record?.state) return;
        const remoteState = normalizeState(record.state);
        const latestState = stateRef.current;
        const sameProfiles = JSON.stringify(remoteState.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(remoteState.interests) === JSON.stringify(latestState.interests);
        if (sameProfiles && sameInterests) return;

        announceIncomingPlayerRequest(latestState, remoteState);
        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, remoteState.profiles),
          interests: mergeSyncedList(latestState.interests, remoteState.interests)
        };
        stateRef.current = mergedState;
        setState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player app updates synced' });
      } catch {
        // The next authoritative API poll retries without accepting cache data as a commit.
      } finally {
        syncInFlight = false;
      }
    };

    void syncDesktopApiUpdates();
    const timer = window.setInterval(() => void syncDesktopApiUpdates(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeAccountKey, hasAuthenticated, state.settings.pilotAccess?.licenseId]);
};
