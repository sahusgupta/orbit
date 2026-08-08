import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import { normalizeState } from '../../../domain/state';
import { mergeSyncedList } from '../../../lib/syncedList';
import {
  subscribeToPlayerRequestUpdates,
  syncPlayerUpdatesToClubState
} from '../../../lib/firebaseClubSync';
import {
  localOrbitBridgeBaseUrl,
  publishStateToLocalOrbitBridge,
  saveManagementState
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
  setUndoStack,
  state,
  stateRef
}: ManagementPlayerUpdateSyncOptions) => {
  useEffect(() => {
    if (!hasAuthenticated || !activeAccountKey || window.tableManagerDesktop) return;
    let cancelled = false;
    let bridgeInitialized = false;

    const syncLocalPlayerUpdates = async () => {
      try {
        const response = await fetch(`${localOrbitBridgeBaseUrl}/state/${encodeURIComponent(activeAccountKey)}`);
        if (response.status === 404) {
          if (!bridgeInitialized) {
            const published = await publishStateToLocalOrbitBridge(stateRef.current);
            bridgeInitialized = Boolean(published?.ok);
          }
          return;
        }
        if (!response.ok) return;
        bridgeInitialized = true;
        const record = await response.json() as { state?: AppState };
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
    if (!hasAuthenticated || !activeAccountKey || !window.tableManagerDesktop || !state.settings.pilotAccess) return;
    let cancelled = false;
    let syncInFlight = false;

    const syncDesktopApiUpdates = async () => {
      if (syncInFlight) return;
      syncInFlight = true;
      try {
        const record = await window.tableManagerDesktop?.loadStateForAccount(state.settings.pilotAccess!);
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
        // The existing Firebase listener remains available if the API is offline.
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

  useEffect(() => {
    if (!activeAccountKey) return;
    let cancelled = false;
    let syncInFlight = false;
    let syncQueued = false;

    const syncPlayerUpdates = async () => {
      if (syncInFlight) {
        syncQueued = true;
        return;
      }
      syncInFlight = true;
      try {
        const nextState = await syncPlayerUpdatesToClubState<AppState>(stateRef.current);
        if (cancelled) return;
        const latestState = stateRef.current;
        announceIncomingPlayerRequest(latestState, nextState);
        const sameProfiles = JSON.stringify(nextState.profiles) === JSON.stringify(latestState.profiles);
        const sameInterests = JSON.stringify(nextState.interests) === JSON.stringify(latestState.interests);
        const sameTournaments = JSON.stringify(nextState.tournaments) === JSON.stringify(latestState.tournaments);
        const sameRevenue = JSON.stringify(nextState.revenueTransactions) === JSON.stringify(latestState.revenueTransactions);
        if (sameProfiles && sameInterests && sameTournaments && sameRevenue) return;

        const mergedState: AppState = {
          ...latestState,
          profiles: mergeSyncedList(latestState.profiles, nextState.profiles),
          interests: mergeSyncedList(latestState.interests, nextState.interests),
          tournaments: mergeSyncedList(latestState.tournaments, nextState.tournaments),
          revenueTransactions: mergeSyncedList(latestState.revenueTransactions, nextState.revenueTransactions)
        };
        stateRef.current = mergedState;
        setUndoStack((current) => [latestState, ...current].slice(0, 20));
        setState(mergedState);
        setSaveStatus({ state: 'saving', message: 'Syncing player updates...' });
        try {
          await saveManagementState(mergedState);
          if (!cancelled) setSaveStatus({ state: 'saved', message: 'Player updates synced' });
        } catch {
          if (!cancelled) setSaveStatus({ state: 'error', message: 'Player update sync failed' });
        }
      } catch {
        // Firestore listeners and the periodic reconciliation pass will retry.
      } finally {
        syncInFlight = false;
        if (syncQueued && !cancelled) {
          syncQueued = false;
          void syncPlayerUpdates();
        }
      }
    };

    const unsubscribe = subscribeToPlayerRequestUpdates(activeAccountKey, () => void syncPlayerUpdates());
    const reconciliationTimer = window.setInterval(() => void syncPlayerUpdates(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(reconciliationTimer);
      unsubscribe();
    };
  }, [activeAccountKey]);
};
