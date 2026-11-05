import { normalizeState, seedState } from '../../domain/state';
import { getAccountKeyFromAccess, getAccountKeyFromState } from '../../domain/licensing';
import type { AppState, PersistedStateRecord, PilotAccess } from '../../domain/types';
import type { ManagementSaveResult } from '../../domain/managementSaveResult';
import { checkpointSha256, checkpointSourceLimit, downloadCheckpoint, parseCheckpointCapabilities, uploadCheckpoint, type CheckpointCapabilities, type CheckpointResponse } from './checkpointTransport';
import { BrowserCheckpointJournalError, createBrowserCheckpointJournal, type PendingBrowserCheckpoint } from './browserCheckpointJournal';
import { getManagementStatePayloadBytes, maximumManagementStatePayloadBytes } from './managementStatePayload';
import {
  loadBrowserManagementState,
  loadBrowserManagementStateForAccount,
  saveBrowserManagementState,
  type BrowserStorage
} from './browserStateRepository';

import { BrowserManagementRecoveryError, type DesktopStatePersistence, type LocalBridgeReadOptions, type LocalBridgeStateResult, type ManagementPersistenceDependencies, type PilotAccessValidationResult } from './managementPersistenceContracts';

type BrowserSaveResult = CheckpointResponse & {
  ok: boolean;
  path: string;
  accountKey: string;
  pending?: boolean;
  conflict?: boolean;
};

type RetryState = { attempts: number; nextAttemptAt: number; paused: boolean; status: number; error: string };
const maximumCanonicalAccounts = 2;
const maximumMetadataAccounts = 32;
const maximumVolatileCredentialBytes = 64 * 1024 * 1024;

const credentialContext = (state: AppState) => JSON.stringify({
  pilot: state.settings.pilotAccess?.authorizationCode,
  login: state.settings.accountLogin && [state.settings.accountLogin.username, state.settings.accountLogin.passwordSalt, state.settings.accountLogin.passwordHash],
  staff: state.settings.staffAccounts.map((staff) => [staff.id, staff.pinSalt, staff.pinHash, staff.role, staff.active])
});

export const createBrowserManagementPersistence = (dependencies: ManagementPersistenceDependencies) => {
  const bridgeRevisionByAccount = new Map<string, number>();
  const capabilitiesByAccount = new Map<string, CheckpointCapabilities>();
  const canonicalByAccount = new Map<string, AppState>();
  const accessByAccount = new Map<string, PilotAccess>();
  const pendingByAccount = new Map<string, PendingBrowserCheckpoint>();
  const desktopPendingByAccount = new Map<string, string>();
  const canonicalReadByAccount = new Map<string, { revision: number; state: AppState; sourceHash: string }>();
  const volatileByAccount = new Map<string, PendingBrowserCheckpoint>();
  const volatileBytesByAccount = new Map<string, number>();
  const metadataRecency = new Map<string, true>();
  const confirmedByAccount = new Map<string, BrowserSaveResult>();
  const retryByAccount = new Map<string, RetryState>();
  const blockedByAccount = new Map<string, string>();
  const flightsByAccount = new Map<string, { source: string; promise: Promise<BrowserSaveResult> }>();
  const journal = dependencies.checkpointJournal ?? createBrowserCheckpointJournal();
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;

  const rememberCanonical = (accountKey: string, state: AppState) => {
    const protectedCopy = structuredClone(state);
    canonicalByAccount.delete(accountKey);
    canonicalByAccount.set(accountKey, protectedCopy);
    canonicalReadByAccount.delete(accountKey);
    while (canonicalByAccount.size > maximumCanonicalAccounts) {
      const oldest = canonicalByAccount.keys().next().value;
      if (oldest === undefined) break;
      canonicalByAccount.delete(oldest);
      canonicalReadByAccount.delete(oldest);
    }
    return protectedCopy;
  };

  const touchMetadata = (accountKey: string) => {
    metadataRecency.delete(accountKey);
    metadataRecency.set(accountKey, true);
    for (const candidate of metadataRecency.keys()) {
      if (metadataRecency.size <= maximumMetadataAccounts) break;
      if (pendingByAccount.has(candidate) || volatileByAccount.has(candidate) || confirmedByAccount.has(candidate)
        || flightsByAccount.has(candidate) || desktopPendingByAccount.has(candidate) || canonicalByAccount.has(candidate)) continue;
      metadataRecency.delete(candidate);
      bridgeRevisionByAccount.delete(candidate);
      capabilitiesByAccount.delete(candidate);
      accessByAccount.delete(candidate);
      retryByAccount.delete(candidate);
      blockedByAccount.delete(candidate);
    }
  };

  const retryBlocked = (accountKey: string) => {
    const retry = retryByAccount.get(accountKey);
    return retry && (retry.paused || retry.nextAttemptAt > now()) ? retry : undefined;
  };

  const retryAfterMs = (response: Response) => {
    const value = response.headers.get('retry-after');
    if (!value) return 0;
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now();
    return Number.isFinite(delay) ? Math.max(0, delay) : 0;
  };

  const retainFailure = (accountKey: string, result: CheckpointResponse, guidance = 0) => {
    const attempts = (retryByAccount.get(accountKey)?.attempts ?? 0) + 1;
    const status = result.httpStatus ?? 0;
    const paused = status >= 400 && status < 500 && ![408, 425, 429].includes(status);
    const delay = Math.min(15 * 60_000, 1000 * 2 ** Math.min(attempts - 1, 10)) * (0.75 + 0.5 * random());
    const error = result.error || (paused
      ? 'Pending work is retained. Sign in again or reconcile the rejected checkpoint before replay.'
      : 'Pending work is retained locally; the server has not confirmed it.');
    retryByAccount.set(accountKey, { attempts, status, paused, nextAttemptAt: now() + Math.max(delay, guidance), error });
  };

  const getDurablePendingAdmission = (accountKey: string): { pending: boolean; error?: string } => {
    if (dependencies.getDesktopPersistence()) {
      const error = desktopPendingByAccount.get(accountKey);
      return { pending: Boolean(error), ...(error ? { error } : {}) };
    }
    const error = blockedByAccount.get(accountKey) || (confirmedByAccount.has(accountKey)
      ? 'Server saved; local recovery cleanup is pending. Resolve browser storage before accepting another change.'
      : retryByAccount.get(accountKey)?.error);
    const pending = pendingByAccount.has(accountKey) || volatileByAccount.has(accountKey) || flightsByAccount.has(accountKey)
      || Boolean(blockedByAccount.get(accountKey)) || Boolean(retryByAccount.get(accountKey)?.paused);
    return { pending, ...(pending ? { error: error || 'An earlier save still requires confirmation. Resolve it before accepting another change.' } : {}) };
  };

  const observeDesktopRecord = (record: PersistedStateRecord | null | undefined, access?: PilotAccess) => {
    if (record) {
      const accountKey = record.accountKey || (access && getAccountKeyFromAccess(access)) || getAccountKeyFromAccess(record.state.settings?.pilotAccess)
        || getAccountKeyFromState({ settings: { ...seedState.settings, clubAccount: record.state.settings?.clubAccount } });
      if (record.pending) desktopPendingByAccount.set(accountKey, 'Pending desktop work is retained. Wait for confirmation or reconcile it before accepting another change.');
      else if (record.authoritative === true) desktopPendingByAccount.delete(accountKey);
    }
    return record;
  };
  const loadDesktopState = () => dependencies.getDesktopPersistence()?.loadState?.().then((record) => observeDesktopRecord(record));
  const loadDesktopStateForAccount = (access: PilotAccess) => dependencies.getDesktopPersistence()?.loadStateForAccount?.(access)
    .then((record) => observeDesktopRecord(record, access));

  const getCapabilities = async (state: AppState) => {
    const accountKey = getAccountKeyFromState(state);
    touchMetadata(accountKey);
    if (state.settings.pilotAccess) accessByAccount.set(accountKey, state.settings.pilotAccess);
    const desktop = dependencies.getDesktopPersistence();
    const cached = capabilitiesByAccount.get(accountKey);
    if (cached) return cached;
    try {
      const value: unknown = desktop
        ? await desktop.getPersistenceCapabilities?.(state.settings.pilotAccess)
        : await (await dependencies.fetchState(`${dependencies.bridgeBaseUrl}/state/capabilities`, {
            headers: { 'x-orbit-api-key': state.settings.pilotAccess?.authorizationCode || '' }, signal: AbortSignal.timeout(15_000)
          })).json();
      const cap = parseCheckpointCapabilities(value);
      if (cap) capabilitiesByAccount.set(accountKey, cap);
      return cap;
    } catch { return null; }
  };

  const cleanupConfirmed = async (accountKey: string, pending: PendingBrowserCheckpoint) => {
    try {
      const removed = await journal.acknowledge(pending.state, pending.mutationId);
      const remaining = removed ? null : await journal.load(pending.state);
      if (!remaining) {
        pendingByAccount.delete(accountKey);
        confirmedByAccount.delete(accountKey);
      } else if (remaining.mutationId !== pending.mutationId) {
        pendingByAccount.set(accountKey, remaining);
        confirmedByAccount.delete(accountKey);
      }
    } catch {
      // Retain the acknowledged recovery record and block new edits. A later
      // local cleanup attempt must not recursively replay the business save.
    }
  };

  const performBrowserSave = async (state: AppState): Promise<BrowserSaveResult> => {
    const accountKey = getAccountKeyFromState(state);
    const expectedRevision = bridgeRevisionByAccount.get(accountKey) ?? 0;
    let mutationId = `browser:${globalThis.crypto.randomUUID()}`;
    const fullEnvelope = { state, expectedRevision, mutationId };
    const cap = await getCapabilities(state);
    if (cap) {
      let pending = pendingByAccount.get(accountKey) || volatileByAccount.get(accountKey);
      if (!pending) {
        try { pending = await journal.load(state) ?? undefined; }
        catch (error) {
          const message = error instanceof Error ? error.message : 'Pending work requires its original credential context.';
          blockedByAccount.set(accountKey, message);
          throw error;
        }
      }
      if (pending && JSON.stringify(pending.state) !== JSON.stringify(state)) {
        return { ok: false, path: 'browser-pending', accountKey, conflict: true, error: 'An earlier change is retained locally. Reconnect and resolve it before accepting another change.' };
      }
      if (!pending) {
        const canonical = canonicalByAccount.get(accountKey);
        const credentialChange = canonical ? credentialContext(canonical) !== credentialContext(state)
          : Boolean(state.settings.accountLogin || state.settings.staffAccounts.length);
        try {
          if (credentialChange) throw new BrowserCheckpointJournalError('BROWSER_CHECKPOINT_CREDENTIAL_CHANGE', 'Credential changes require an online save.');
          pending = await journal.store({ state, expectedRevision, mutationId, previousState: canonicalByAccount.get(accountKey) });
          pendingByAccount.set(accountKey, pending);
        } catch (error) {
          if (!(error instanceof BrowserCheckpointJournalError) || error.code !== 'BROWSER_CHECKPOINT_CREDENTIAL_CHANGE') throw error;
          // Restricted credential changes remain online-only. Their exact retry
          // identity lives in this tab; no credentials enter browser storage.
          const source = new TextEncoder().encode(JSON.stringify(state));
          const retainedBytes = [...volatileBytesByAccount.values()].reduce((sum, bytes) => sum + bytes, 0);
          if (source.byteLength > checkpointSourceLimit || volatileByAccount.size >= 2 || retainedBytes + source.byteLength > maximumVolatileCredentialBytes) {
            throw new BrowserManagementRecoveryError('BROWSER_CREDENTIAL_CAPACITY', 'Two credential saves or 64 MiB are already awaiting online confirmation. Resolve them before accepting another credential change; retained work has not been evicted.');
          }
          const sourceHash = await checkpointSha256(source);
          pending = { schemaVersion: 1, accountKey, state, expectedRevision, sourceHash,
            createdAt: new Date(now()).toISOString(), mutationId: `browser-credentials:${expectedRevision}:${sourceHash}` };
          volatileByAccount.set(accountKey, pending);
          volatileBytesByAccount.set(accountKey, source.byteLength);
        }
      } else if (!volatileByAccount.has(accountKey)) pendingByAccount.set(accountKey, pending);
      const durable = pendingByAccount.has(accountKey);
      const confirmed = confirmedByAccount.get(accountKey);
      if (confirmed) {
        await cleanupConfirmed(accountKey, pending);
        return confirmed;
      }
      const retry = retryBlocked(accountKey);
      if (retry) return { ok: false, path: 'orbit-api', accountKey, pending: durable, conflict: retry.status === 409, error: retry.error };
      mutationId = pending.mutationId;
      let guidance = 0;
      const authoritative = canonicalByAccount.get(accountKey);
      const authKey = state.settings.pilotAccess?.authorizationCode || authoritative?.settings.pilotAccess?.authorizationCode || '';
      const result = await uploadCheckpoint(pending.state, { accountKey, expectedRevision: pending.expectedRevision, mutationId }, cap, async (path, body) => {
        const response = await dependencies.fetchState(`${dependencies.bridgeBaseUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'content-type': 'application/json', 'x-orbit-api-key': authKey },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) guidance = retryAfterMs(response);
        const payload = await response.json() as CheckpointResponse;
        return { ...payload, ok: response.ok && payload.ok === true, httpStatus: response.status };
      }).catch((): CheckpointResponse => ({ ok: false, error: 'The change is retained locally; the server commit is not confirmed.' }));
      if (!result.ok) {
        retainFailure(accountKey, durable ? result : { ...result, error: 'Credential changes require online confirmation. Keep this tab open; no durable browser queue was created.' }, guidance);
        return { ok: false, path: 'orbit-api', accountKey, pending: durable, conflict: result.httpStatus === 409,
          error: durable ? result.error : 'Credential changes require online confirmation. Keep this tab open and retry; no durable browser queue was created.' };
      }
      if (!Number.isSafeInteger(result.revision) || Number(result.revision) < 1) {
        const error = 'The server acknowledgement was invalid; the recovery record is retained.';
        retryByAccount.set(accountKey, { attempts: 1, nextAttemptAt: 0, paused: true, status: 426, error });
        return { ok: false, path: 'orbit-api', accountKey, pending: durable, error };
      }
      retryByAccount.delete(accountKey);
      blockedByAccount.delete(accountKey);
      bridgeRevisionByAccount.set(accountKey, Number(result.revision));
      rememberCanonical(accountKey, state);
      const accepted: BrowserSaveResult = { ...result, ok: true, path: 'orbit-api', accountKey };
      if (durable) {
        confirmedByAccount.set(accountKey, accepted);
        await cleanupConfirmed(accountKey, pending);
      } else { volatileByAccount.delete(accountKey); volatileBytesByAccount.delete(accountKey); }
      return accepted;
    }
    if (getManagementStatePayloadBytes(fullEnvelope) > maximumManagementStatePayloadBytes) {
      return { ok: false, path: 'orbit-api', accountKey, error: 'A compatible checkpoint server is required to save this venue. Keep pending work and upgrade the API before retrying.' };
    }
    const response = await dependencies.fetchState(`${dependencies.bridgeBaseUrl}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-orbit-mutation-id': mutationId, 'x-orbit-api-key': state.settings.pilotAccess?.authorizationCode || '' },
      body: JSON.stringify(fullEnvelope)
    });
    const payload = await response.json().catch(() => ({})) as {
      ok?: boolean;
      revision?: number;
      currentRevision?: number;
      publication?: { status?: string };
      error?: string;
    };
    if (response.status === 409) {
      return { ok: false, path: 'orbit-api', accountKey, conflict: true, error: payload.error };
    }
    if (!response.ok || !payload.ok) return { ok: false, path: 'orbit-api', accountKey, error: payload.error };
    bridgeRevisionByAccount.set(accountKey, Number(payload.revision || expectedRevision + 1));
    rememberCanonical(accountKey, state);
    return {
      ok: true,
      path: 'orbit-api',
      accountKey,
      revision: Number(payload.revision || expectedRevision + 1),
      publication: payload.publication
    };
  };

  const publishStateToLocalBridge = (state: AppState): Promise<BrowserSaveResult> => {
    const accountKey = getAccountKeyFromState(state);
    const source = JSON.stringify(state);
    const flight = flightsByAccount.get(accountKey);
    if (flight) return flight.source === source ? flight.promise : Promise.resolve({ ok: false, path: 'browser-busy', accountKey,
      error: 'An earlier save is in progress. Wait for its result before accepting another change.' });
    const promise = performBrowserSave(state).finally(() => {
      if (flightsByAccount.get(accountKey)?.promise === promise) flightsByAccount.delete(accountKey);
    });
    flightsByAccount.set(accountKey, { source, promise });
    return promise;
  };

  const loadStateFromLocalBridge = async (
    accountKey: string,
    canAcceptRead?: () => boolean,
    options?: LocalBridgeReadOptions
  ): Promise<LocalBridgeStateResult> => {
    if (blockedByAccount.has(accountKey)) throw new BrowserManagementRecoveryError('BROWSER_PENDING_RECONCILIATION', blockedByAccount.get(accountKey) || 'Pending work requires reconciliation.');
    const retained = pendingByAccount.get(accountKey) || volatileByAccount.get(accountKey);
    if (retained) {
      if (retryBlocked(accountKey)) return { status: 'unavailable' };
      const resumed = await publishStateToLocalBridge(retained.state);
      if (!resumed.ok) return { status: 'unavailable' };
    }
    const access = accessByAccount.get(accountKey);
    const headers = { 'x-orbit-api-key': access?.authorizationCode || '' };
    const cap = capabilitiesByAccount.get(accountKey);
    if (cap) {
      let manifestStatus = 0;
      let manifestHash = '';
      let unchanged = false;
      const cached = canonicalReadByAccount.get(accountKey);
      const manifestPath = `/state/checkpoint/${encodeURIComponent(accountKey)}`;
      const readVerifiedCheckpoint = () => downloadCheckpoint(accountKey, cap, async (path) => {
        const requestPath = cached && path === manifestPath ? `${path}?knownRevision=${cached.revision}` : path;
        const response = await dependencies.fetchState(`${dependencies.bridgeBaseUrl}${requestPath}`, { headers, signal: AbortSignal.timeout(30_000) });
        manifestStatus ||= response.status;
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        if (path === manifestPath && typeof payload === 'object' && payload !== null
          && typeof Reflect.get(payload, 'sha256') === 'string') manifestHash = String(Reflect.get(payload, 'sha256'));
        if (cached && path === manifestPath && response.ok && typeof payload === 'object' && payload !== null
          && Reflect.get(payload, 'ok') === true && Reflect.get(payload, 'notModified') === true
          && Reflect.get(payload, 'protocol') === cap.protocol && Reflect.get(payload, 'accountKey') === accountKey
          && Reflect.get(payload, 'revision') === cached.revision && manifestHash === cached.sourceHash) {
          unchanged = true;
          return null;
        }
        return payload;
      });
      let record = await readVerifiedCheckpoint();
      if (unchanged && cached) record = { accountKey, revision: cached.revision, state: cached.state };
      if (!record || !record.state || typeof record.state !== 'object') {
        if (await journal.hasPending(accountKey)) throw new BrowserManagementRecoveryError('BROWSER_PENDING_CONTEXT_UNAVAILABLE', 'Pending work is retained. Restore its existing account before starting or replacing a venue.');
        return { status: manifestStatus === 404 ? 'missing' : 'unavailable' };
      }
      let normalized = normalizeState(record.state);
      // Hydration supplies credentials from the authenticated context only.
      if (access) normalized.settings.pilotAccess = access;
      let pending: PendingBrowserCheckpoint | null;
      try { pending = await journal.load(normalized); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Pending work requires its original credentials.';
        blockedByAccount.set(accountKey, message);
        throw new BrowserManagementRecoveryError('BROWSER_PENDING_RECONCILIATION', message);
      }
      if (pending) {
        pendingByAccount.set(accountKey, pending);
        // Resume at most once per read. Cleanup failures leave a confirmed
        // record for local retry; they never recurse into another network save.
        const resumed = await publishStateToLocalBridge(pending.state);
        if (!resumed.ok) return { status: 'unavailable' };
        if (record.revision < Number(resumed.revision)) {
          // The server can preserve private fields or apply privacy tombstones.
          // Only a second verified read may become the canonical projection.
          // This is one bounded read, never recursive save/recovery replay.
          unchanged = false;
          record = await readVerifiedCheckpoint();
          if (unchanged && cached) record = { accountKey, revision: cached.revision, state: structuredClone(cached.state) };
          if (!record || record.revision < Number(resumed.revision) || !record.state || typeof record.state !== 'object') return { status: 'unavailable' };
          normalized = normalizeState(record.state);
          if (access) normalized.settings.pilotAccess = access;
        }
      }
      const readRevision = record.revision;
      const readHash = manifestHash;
      const verifiedCanonical = structuredClone(normalized);
      const acceptReadRevision = () => {
        if (canAcceptRead && !canAcceptRead()) return false;
        const prior = bridgeRevisionByAccount.get(accountKey);
        if (prior !== undefined && readRevision < prior) return false;
        bridgeRevisionByAccount.set(accountKey, readRevision);
        const protectedCanonical = rememberCanonical(accountKey, verifiedCanonical);
        canonicalReadByAccount.set(accountKey, { revision: readRevision, state: protectedCanonical, sourceHash: readHash });
        return true;
      };
      if (options?.deferRevisionAcceptance) return { status: 'available', state: normalized, acceptReadRevision };
      if (!acceptReadRevision()) return { status: 'unavailable' };
      return { status: 'available', state: normalized };
    }
    const response = await dependencies.fetchState(
      `${dependencies.bridgeBaseUrl}/state/${encodeURIComponent(accountKey)}`, { headers }
    );
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return { status: 'unavailable' };
    const record = await response.json() as { accountKey?: string; revision?: number; state?: AppState };
    const readAccountKey = record.accountKey;
    const readRevision = readAccountKey ? Number(record.revision || 0) : 0;
    const verifiedCanonical = record.state ? structuredClone(record.state) : undefined;
    const acceptReadRevision = () => {
      if (canAcceptRead && !canAcceptRead()) return false;
      if (readAccountKey) {
        const priorRevision = bridgeRevisionByAccount.get(readAccountKey);
        if (priorRevision !== undefined && readRevision < priorRevision) return false;
        bridgeRevisionByAccount.set(readAccountKey, readRevision);
      }
      if (verifiedCanonical) rememberCanonical(accountKey, verifiedCanonical);
      return true;
    };
    if (options?.deferRevisionAcceptance) return { status: 'available', state: record.state, acceptReadRevision };
    if (!acceptReadRevision()) return { status: 'unavailable' };
    return { status: 'available', state: record.state };
  };

  const loadExistingStateForAccount = async (access: PilotAccess): Promise<AppState | null> => {
    const accountKey = getAccountKeyFromAccess(access);
    accessByAccount.set(accountKey, access);
    if (!dependencies.getDesktopPersistence()) {
      const retry = retryByAccount.get(accountKey);
      if (retry && [401, 403].includes(retry.status)) retryByAccount.delete(accountKey);
      // A deliberate sign-in may supply renewed credentials. Recovery still
      // verifies their binding against the retained checkpoint before replay.
      blockedByAccount.delete(accountKey);
      await getCapabilities({ ...seedState, settings: { ...seedState.settings, pilotAccess: access } });
      let remote: LocalBridgeStateResult;
      try { remote = await loadStateFromLocalBridge(accountKey); }
      catch (error) {
        if (error instanceof BrowserManagementRecoveryError) throw error;
        throw new BrowserManagementRecoveryError('BROWSER_RECOVERY_UNAVAILABLE', error instanceof Error ? error.message : 'The existing account could not be recovered.');
      }
      if (remote.status === 'available' && remote.state) return remote.state;
      if (remote.status === 'unavailable' || await journal.hasPending(accountKey)) {
        throw new BrowserManagementRecoveryError('BROWSER_RECOVERY_UNAVAILABLE', 'The existing account or retained pending work could not be verified. Reconnect before starting a new venue.');
      }
    }
    let desktopRecord: PersistedStateRecord | null | undefined;
    try {
      desktopRecord = await loadDesktopStateForAccount(access);
    } catch {
      // Cloud or desktop lookup failures should not block activation of a valid local pilot key.
      desktopRecord = undefined;
    }
    const record = desktopRecord?.state
      ? desktopRecord
      : loadBrowserManagementStateForAccount(access, dependencies.storage);
    if (!record?.state) return null;
    return normalizeState({
      ...record.state,
      settings: {
        ...record.state.settings,
        pilotAccess: access
      }
    });
  };

  const registerUpdatePreservation = (getState: () => AppState) => {
    const desktop = dependencies.getDesktopPersistence();
    if (!desktop?.onPrepareForUpdate || !desktop.preserveStateForUpdate) return undefined;
    return desktop.onPrepareForUpdate((requestId) => {
      void desktop.preserveStateForUpdate?.(requestId, getState());
    });
  };

  const saveState = async (state: AppState): Promise<ManagementSaveResult> => {
    const desktop = dependencies.getDesktopPersistence();
    if (desktop?.getPersistenceCapabilities && getManagementStatePayloadBytes(state) > maximumManagementStatePayloadBytes) {
      // Negotiate before IPC; the desktop still preserves pending work when
      // the API is unavailable and never sends it through a legacy parser.
      await getCapabilities(state);
    }
    const result: Awaited<ReturnType<DesktopStatePersistence['saveState']>> = desktop
      ? await desktop.saveState(state)
      : await publishStateToLocalBridge(state).catch((error) => ({
          ok: false,
          path: 'browser-local-storage',
          error: error instanceof Error ? error.message : 'Authoritative server save failed.'
        }));
    if (desktop) {
      const accountKey = getAccountKeyFromState(state);
      if (result.pending) desktopPendingByAccount.set(accountKey, result.error || 'Pending desktop work requires server confirmation.');
      else if (result.ok) desktopPendingByAccount.delete(accountKey);
    }
    const accountKey = getAccountKeyFromState(state);
    const legacyMemoryFallback = !desktop && !capabilitiesByAccount.has(accountKey)
      && !pendingByAccount.has(accountKey) && !volatileByAccount.has(accountKey) && !blockedByAccount.has(accountKey)
      && !confirmedByAccount.has(accountKey) && !flightsByAccount.has(accountKey);
    if (result.ok || result.pending || legacyMemoryFallback) saveBrowserManagementState(state, dependencies.storage);
    const publicationStatus = String(result.publication?.status || '');
    return {
      ...result,
      cloud: !result.ok
        ? 'not-committed'
        : publicationStatus === 'published'
          ? 'published'
          : publicationStatus === 'failed'
            ? 'failed'
            : 'server-pending'
    };
  };

  return {
    getPilotAccessValidator: () => {
      const validatePilotAccess = dependencies.getDesktopPersistence()?.validatePilotAccess;
      return validatePilotAccess ? (access: PilotAccess) => validatePilotAccess(access) : undefined;
    },
    hasDesktopPersistence: () => Boolean(dependencies.getDesktopPersistence()),
    getDurablePendingAdmission,
    // This is the client's memory admission bound. The transport negotiates the
    // server protocol before invoking IPC/HTTP; it never raises a legacy parser.
    getSaveAdmissionBytes: () => {
      const desktop = dependencies.getDesktopPersistence();
      return !desktop || desktop.getPersistenceCapabilities ? checkpointSourceLimit : maximumManagementStatePayloadBytes;
    },
    loadDesktopState,
    loadDesktopStateForAccount,
    loadExistingStateForAccount,
    loadState: () => loadBrowserManagementState(dependencies.storage),
    loadStateFromLocalBridge,
    publishStateToLocalBridge,
    registerUpdatePreservation,
    saveDesktopState: (state: AppState) => dependencies.getDesktopPersistence()?.saveState(state),
    saveState
  };
};
