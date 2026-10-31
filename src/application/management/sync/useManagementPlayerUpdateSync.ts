import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import { normalizeState } from '../../../domain/state';
import {
  hasManagementDesktopPersistence,
  loadDesktopManagementStateForAccount,
  subscribeToDesktopManagementStateForAccount,
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
        const record = await loadManagementStateFromLocalBridge(activeAccountKey, () =>
          !cancelled && !isManagementSavePending(activeAccountKey) && stateRef.current === stateWhenLoadStarted,
          { deferRevisionAcceptance: true }
        );
        if (cancelled || isManagementSavePending(activeAccountKey) || stateRef.current !== stateWhenLoadStarted) return;
        if (record.status === 'missing') {
          if (!bridgeInitialized) {
            const published = await publishStateToLocalOrbitBridge(stateRef.current);
            bridgeInitialized = Boolean(published?.ok);
          }
          return;
        }
        if (record.status === 'unavailable') return;
        if (cancelled || !record.state) return;
        const latestState = stateRef.current;
        const remoteState = normalizeState(record.state);
        const hasSameOperations = hasSameIncomingPlayerOperations(latestState, remoteState);
        if (record.acceptReadRevision && !record.acceptReadRevision()) return;
        bridgeInitialized = true;
        if (hasSameOperations) return;
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
    let unsubscribe: (() => void) | undefined;
    let wasHidden = document.hidden;
    let subscriptionGeneration = 0;
    let streamConnected = false;
    let refreshPending = true;
    let lastAcceptedRevision = -1;
    let lastAcceptedReadAt = 0;
    let pendingRevision: number | null = null;
    const fallbackIntervalMs = 3_000;
    const watchdogIntervalMs = 5 * 60_000;
    const localRetryMs = 100;
    const maximumRetryDelayMs = 5 * 60_000;
    let retryDelayMs = 30_000;
    let failureRetryAt = 0;
    let nextPollAt = Date.now();
    const isRevision = (revision: unknown): revision is number => Number.isSafeInteger(revision) && Number(revision) >= 0;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const scheduleNextPoll = () => {
      clearTimer();
      if (cancelled || document.hidden || syncInFlight) return;
      timer = window.setTimeout(() => void syncDesktopApiUpdates(), Math.max(0, Math.max(nextPollAt, failureRetryAt) - Date.now()));
    };

    const syncDesktopApiUpdates = async () => {
      if (cancelled || document.hidden || syncInFlight) return;
      clearTimer();
      if (Date.now() < failureRetryAt) {
        scheduleNextPoll();
        return;
      }
      if (isManagementSavePending(activeAccountKey)) {
        // Recheck only the local save gate; no API/Firestore request is issued here.
        nextPollAt = Date.now() + localRetryMs;
        scheduleNextPoll();
        return;
      }
      syncInFlight = true;
      const stateWhenLoadStarted = stateRef.current;
      const notifiedRevisionAtStart = pendingRevision;
      let readSucceeded = false;
      try {
        const record = await loadDesktopManagementStateForAccount(state.settings.pilotAccess!);
        if (!record?.state || record.authoritative === false) return;
        const recordRevision = isRevision(record.revision) ? record.revision : null;
        // Legacy polling records remain compatible. A notified revision must be
        // satisfied by an explicitly authoritative, revisioned response.
        if (pendingRevision !== null && (record.authoritative !== true || recordRevision === null)) return;
        if (recordRevision !== null && recordRevision < lastAcceptedRevision) return;
        if (notifiedRevisionAtStart !== null && (recordRevision === null || recordRevision < notifiedRevisionAtStart)) return;
        readSucceeded = true;
        if (cancelled) return;
        if (isManagementSavePending(activeAccountKey) || stateRef.current !== stateWhenLoadStarted) {
          refreshPending = true;
          nextPollAt = Date.now() + localRetryMs;
          return;
        }
        const remoteState = normalizeState(record.state);
        const latestState = stateRef.current;
        if (!hasSameIncomingPlayerOperations(latestState, remoteState)) {
          announceIncomingPlayerRequest(latestState, remoteState);
          const mergedState = mergeIncomingPlayerOperations(latestState, remoteState);
          clearUndo();
          stateRef.current = mergedState;
          setState(mergedState);
          saveBrowserManagementState(mergedState);
          setSaveStatus({ state: 'saved', message: 'Player operations synced' });
        }
        if (recordRevision !== null) lastAcceptedRevision = Math.max(lastAcceptedRevision, recordRevision);
        if (pendingRevision !== null && pendingRevision <= lastAcceptedRevision) pendingRevision = null;
        refreshPending = pendingRevision !== null;
        lastAcceptedReadAt = Date.now();
        nextPollAt = refreshPending ? Date.now() : Date.now() + (streamConnected ? watchdogIntervalMs : fallbackIntervalMs);
      } catch {
        readSucceeded = false;
        // Retry failed reads more slowly without accepting cache data as a commit.
      } finally {
        syncInFlight = false;
        if (readSucceeded) {
          retryDelayMs = 30_000;
          failureRetryAt = 0;
        } else {
          retryDelayMs = Math.min(retryDelayMs * 2, maximumRetryDelayMs);
          failureRetryAt = Date.now() + retryDelayMs;
          nextPollAt = failureRetryAt;
        }
        scheduleNextPoll();
      }
    };

    const stopSubscription = () => {
      subscriptionGeneration += 1;
      const cleanup = unsubscribe;
      unsubscribe = undefined;
      streamConnected = false;
      cleanup?.();
    };

    const startSubscription = () => {
      const generation = ++subscriptionGeneration;
      try {
        unsubscribe = subscribeToDesktopManagementStateForAccount(state.settings.pilotAccess!, (event) => {
          if (cancelled || document.hidden || generation !== subscriptionGeneration) return;
          if (event.type === 'change') {
            if (!isRevision(event.revision) || event.revision <= lastAcceptedRevision ||
              (pendingRevision !== null && event.revision <= pendingRevision)) return;
            pendingRevision = event.revision;
            nextPollAt = Date.now();
          } else {
            if (streamConnected === event.connected) return;
            streamConnected = event.connected;
            if (!syncInFlight && !refreshPending && pendingRevision === null && failureRetryAt === 0) {
              nextPollAt = streamConnected ? lastAcceptedReadAt + watchdogIntervalMs : Math.min(nextPollAt, Date.now() + fallbackIntervalMs);
            }
          }
          scheduleNextPoll();
        });
      } catch {
        streamConnected = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden === wasHidden) return;
      wasHidden = document.hidden;
      if (document.hidden) {
        clearTimer();
        stopSubscription();
      } else {
        refreshPending = true;
        nextPollAt = Date.now();
        startSubscription();
        scheduleNextPoll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (!document.hidden) {
      startSubscription();
      void syncDesktopApiUpdates();
    }
    return () => {
      cancelled = true;
      clearTimer();
      stopSubscription();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeAccountKey, hasAuthenticated, state.settings.pilotAccess?.licenseId, state.settings.pilotAccess?.authorizationCode, state.settings.pilotAccess?.expiresAt]);
};
