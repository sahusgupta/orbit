import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import { normalizeState } from '../../../domain/state';
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
  clearUndo: () => void;
  state: AppState;
  stateRef: MutableRefObject<AppState>;
};

const incomingPlayerOperationKeys = [
  'profiles',
  'interests',
  'sessions',
  'playerSessions',
  'playerLedger',
  'staffRequests',
  'selfCheckIn'
] as const satisfies ReadonlyArray<keyof AppState>;

const hasSameIncomingPlayerOperations = (latestState: AppState, remoteState: AppState) =>
  incomingPlayerOperationKeys.every((key) =>
    JSON.stringify(latestState[key]) === JSON.stringify(remoteState[key])
  );

export const mergeIncomingPlayerOperations = (latestState: AppState, remoteState: AppState): AppState => ({
  ...latestState,
  profiles: remoteState.profiles,
  interests: remoteState.interests,
  sessions: remoteState.sessions,
  playerSessions: remoteState.playerSessions,
  playerLedger: remoteState.playerLedger,
  staffRequests: remoteState.staffRequests,
  selfCheckIn: remoteState.selfCheckIn
});

export const useManagementPlayerUpdateSync = ({
  activeAccountKey,
  announceIncomingPlayerRequest,
  hasAuthenticated,
  setSaveStatus,
  setState,
  clearUndo,
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
        const remoteState = normalizeState(record.state);
        if (hasSameIncomingPlayerOperations(latestState, remoteState)) return;
        announceIncomingPlayerRequest(latestState, remoteState);
        const mergedState = mergeIncomingPlayerOperations(latestState, remoteState);
        clearUndo();
        stateRef.current = mergedState;
        setState(mergedState);
        saveBrowserManagementState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player operations synced' });
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
        if (hasSameIncomingPlayerOperations(latestState, remoteState)) return;

        announceIncomingPlayerRequest(latestState, remoteState);
        const mergedState = mergeIncomingPlayerOperations(latestState, remoteState);
        clearUndo();
        stateRef.current = mergedState;
        setState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player operations synced' });
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
