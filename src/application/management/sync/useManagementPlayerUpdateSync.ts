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
  isManagementSavePending: (accountKey: string) => boolean;
  setSaveStatus: (status: ManagementSaveStatus) => void;
  setState: Dispatch<SetStateAction<AppState>>;
  clearUndo: () => void;
  state: AppState;
  stateRef: MutableRefObject<AppState>;
};

const incomingPlayerOperationKeys = [
  'physicalTables',
  'buyIns',
  'timeFeeLogs',
  'dropLogs',
  'dealerAssignments',
  'handCountLogs',
  'tableEvents',
  'correctionLog',
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
  // Keep balances, receipts, and activity from the same authoritative snapshot.
  physicalTables: remoteState.physicalTables,
  buyIns: remoteState.buyIns,
  timeFeeLogs: remoteState.timeFeeLogs,
  dropLogs: remoteState.dropLogs,
  dealerAssignments: remoteState.dealerAssignments,
  handCountLogs: remoteState.handCountLogs,
  tableEvents: remoteState.tableEvents,
  correctionLog: remoteState.correctionLog,
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
  isManagementSavePending,
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
    let syncInFlight = false;

    const syncLocalPlayerUpdates = async () => {
      if (cancelled || syncInFlight || isManagementSavePending(activeAccountKey)) return;
      syncInFlight = true;
      const stateWhenLoadStarted = stateRef.current;
      try {
        const record = await loadManagementStateFromLocalBridge(activeAccountKey);
        if (cancelled || isManagementSavePending(activeAccountKey) || stateRef.current !== stateWhenLoadStarted) return;
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
      } finally {
        syncInFlight = false;
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
    let timer: number | undefined;
    const pollIntervalMs = 30_000;
    const maximumRetryDelayMs = 5 * 60_000;
    let retryDelayMs = pollIntervalMs;
    let nextPollAt = Date.now();

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const scheduleNextPoll = () => {
      clearTimer();
      if (cancelled || document.hidden || syncInFlight) return;
      timer = window.setTimeout(() => void syncDesktopApiUpdates(), Math.max(0, nextPollAt - Date.now()));
    };

    const syncDesktopApiUpdates = async () => {
      if (cancelled || document.hidden || syncInFlight) return;
      if (isManagementSavePending(activeAccountKey)) {
        nextPollAt = Date.now() + pollIntervalMs;
        scheduleNextPoll();
        return;
      }
      syncInFlight = true;
      const stateWhenLoadStarted = stateRef.current;
      let readSucceeded = false;
      try {
        const record = await loadDesktopManagementStateForAccount(state.settings.pilotAccess!);
        if (!record?.state || record.authoritative === false) return;
        readSucceeded = true;
        if (cancelled ||
          isManagementSavePending(activeAccountKey) || stateRef.current !== stateWhenLoadStarted) return;
        const remoteState = normalizeState(record.state);
        const latestState = stateRef.current;
        if (hasSameIncomingPlayerOperations(latestState, remoteState)) return;

        announceIncomingPlayerRequest(latestState, remoteState);
        const mergedState = mergeIncomingPlayerOperations(latestState, remoteState);
        clearUndo();
        stateRef.current = mergedState;
        setState(mergedState);
        saveBrowserManagementState(mergedState);
        setSaveStatus({ state: 'saved', message: 'Player operations synced' });
      } catch {
        readSucceeded = false;
        // Retry failed reads more slowly without accepting cache data as a commit.
      } finally {
        syncInFlight = false;
        retryDelayMs = readSucceeded ? pollIntervalMs : Math.min(retryDelayMs * 2, maximumRetryDelayMs);
        nextPollAt = Date.now() + retryDelayMs;
        scheduleNextPoll();
      }
    };

    const handleVisibilityChange = () => {
      // Retain the deadline so hiding and showing cannot bypass failure backoff.
      if (document.hidden) clearTimer();
      else scheduleNextPoll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (!document.hidden) void syncDesktopApiUpdates();
    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeAccountKey, hasAuthenticated, state.settings.pilotAccess?.licenseId]);
};
