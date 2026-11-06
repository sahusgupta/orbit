const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createManagementStateEvents } = require('./managementStateEvents.cjs');
const { validatePendingRetryPolicy } = require('./pendingReplayPolicy.cjs');
const { downloadCheckpoint, sourceForState, supportedCheckpoint, uploadCheckpoint } = require('./checkpointTransport.cjs');
const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  isRecord,
  orbitApiErrorDetails,
  sanitizeAccountKey,
  validateStatePayload
} = require('./runtimeUtils.cjs');

async function readApiResponse(response, maximumBytes = 0) {
  let text;
  if (maximumBytes && response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new Error('The checkpoint response exceeds its envelope budget.');
      }
      chunks.push(Buffer.from(part.value));
    }
    text = Buffer.concat(chunks, bytes).toString('utf8');
  } else {
    text = await response.text().catch(() => '');
    if (maximumBytes && Buffer.byteLength(text, 'utf8') > maximumBytes) throw new Error('The checkpoint response exceeds its envelope budget.');
  }
  if (!text) return { payload: null, responsePreview: '' };
  try {
    return { payload: JSON.parse(text), responsePreview: '' };
  } catch {
    return { payload: null, responsePreview: text.replace(/\s+/g, ' ').slice(0, 300) };
  }
}

function getClientAuthKeyFromAccess(access) {
  if (!isRecord(access)) return '';
  return String(access.authorizationCode || '').trim();
}

function getClientAuthKeyFromState(state) {
  return getClientAuthKeyFromAccess(state?.settings?.pilotAccess);
}

function createOrbitApiClient(dependencies) {
  const {
    app,
    getAppStartedAt,
    isDev,
    loadStateWithFirebaseFallback,
    saveStateEverywhere,
    storeAnalyticalReport,
    writeLocalDatabase,
    writeOrbitApiLog
  } = dependencies;
  const clearIntervalImpl = dependencies.clearIntervalImpl || clearInterval;
  const clearTimeoutImpl = dependencies.clearTimeoutImpl || clearTimeout;
  const environment = dependencies.environment || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const fileSystem = dependencies.fileSystem || fs;
  const hostname = dependencies.hostname || (() => os.hostname());
  const now = dependencies.now || (() => new Date());
  const nowMs = dependencies.nowMs || (() => Date.now());
  const platform = dependencies.platform || process.platform;
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const readLocalDatabase = dependencies.readLocalDatabase;
  const migrateLocalAccountToPilotAccess = dependencies.migrateLocalAccountToPilotAccess || (() => null);
  const setIntervalImpl = dependencies.setIntervalImpl || setInterval;
  const setTimeoutImpl = dependencies.setTimeoutImpl || setTimeout;
  const userDataPath = dependencies.userDataPath || (() => app.getPath('userData'));
  const createStateEvents = dependencies.createStateEvents || createManagementStateEvents;

  let cachedDeviceId;
  let clientHeartbeatTimer;
  let lastUpdateStatus = '';
  let lastUpdateEvent = '';
  const revisionByAccount = new Map();
  /** @type {Map<string, { pending?: Promise<unknown>, epoch?: symbol, reads: number }>} */
  const accountMutationContexts = new Map();
  let lastMutationEpoch;
  let pendingMutationCount = 0;

  function getAccountMutationContext(accountKey) {
    let context = accountMutationContexts.get(accountKey);
    if (!context) {
      context = { reads: 0 };
      accountMutationContexts.set(accountKey, context);
    }
    return context;
  }

  function releaseAccountMutationContext(accountKey, context) {
    if (!context.pending && context.reads === 0 && accountMutationContexts.get(accountKey) === context) {
      accountMutationContexts.delete(accountKey);
    }
  }

  const capabilitiesByCredential = new Map();
  const capabilityHttpStatuses = new WeakMap();
  const replayAuthByAccount = new Map();
  const validatedReplayAuthByAccount = new Map();
  const lastReadOutcomeByAccount = new Map();
  const canonicalCheckpointsByAccount = new Map();
  const pendingRetries = new Map();
  const pausedAcknowledgements = new Map();
  const unpersistedRetryPolicies = new Map();
  const durablePendingEnabled = typeof dependencies.readPendingState === 'function'
    && typeof dependencies.writePendingState === 'function'
    && typeof dependencies.acknowledgePendingState === 'function';

  async function getPersistenceCapabilities(access) {
    const authKey = getClientAuthKeyFromAccess(access) || getApiConfig().apiKey;
    const credentialRef = crypto.createHash('sha256').update(authKey).digest('hex');
    const cached = capabilitiesByCredential.get(credentialRef);
    if (cached) return cached;
    let httpStatus = 0;
    const payload = await requestOrbitApi('/state/capabilities', { authKey, returnFailurePayload: true, observeHttpStatus: status => { httpStatus = status; } });
    const result = { ok: Boolean(payload?.ok), checkpoint: payload?.ok === true && supportedCheckpoint(payload?.checkpoint) ? payload.checkpoint : null,
      ...(payload?.httpStatus ? { httpStatus: payload.httpStatus } : {}),
      ...(payload?.retryAfterMs ? { retryAfterMs: payload.retryAfterMs } : {}) };
    capabilityHttpStatuses.set(result, httpStatus);
    if (result.checkpoint) capabilitiesByCredential.set(credentialRef, result);
    return result;
  }

  function preservePendingState(state) {
    const accountKey = getAccountKeyFromState(state);
    const { sha256 } = sourceForState(state);
    const existing = dependencies.readPendingState(accountKey);
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error('A different pending change requires recovery before this change can be accepted.');
      return existing;
    }
    const expectedRevision = revisionByAccount.get(accountKey) ?? readLocalDatabase(accountKey)?.revision ?? 0;
    const mutationId = `desktop:${accountKey}:${expectedRevision}:${sha256.slice(0, 32)}`;
    return dependencies.writePendingState({ accountKey, state, expectedRevision, mutationId, sha256 });
  }

  function clearPendingRetry(accountKey) {
    const retry = pendingRetries.get(accountKey);
    if (retry?.timer) clearTimeoutImpl(retry.timer);
    pendingRetries.delete(accountKey);
  }

  function retryPolicyFor(pending) {
    const fallback = unpersistedRetryPolicies.get(pending.accountKey);
    if (fallback && fallback.mutationId !== pending.mutationId) unpersistedRetryPolicies.delete(pending.accountKey);
    const policy = fallback?.mutationId === pending.mutationId ? fallback : pending.retryPolicy;
    return policy ? validatePendingRetryPolicy(policy, pending) : null;
  }

  function ensurePendingRetryTimer(accountKey, pending, policy) {
    if (policy.kind !== 'transient') return;
    const previous = pendingRetries.get(accountKey);
    if (previous?.timer && previous.mutationId === pending.mutationId && previous.notBeforeMs === policy.notBeforeMs) return;
    clearPendingRetry(accountKey);
    const retry = { mutationId: pending.mutationId, notBeforeMs: policy.notBeforeMs, timer: undefined };
    retry.timer = setTimeoutImpl(() => {
      if (pendingRetries.get(accountKey) !== retry) return;
      pendingRetries.delete(accountKey);
      try {
        const current = dependencies.readPendingState(accountKey);
        if (current?.mutationId === retry.mutationId) void saveStateToApi(current.state, undefined, retry.mutationId).catch(() => undefined);
      } catch {
        writeOrbitApiLog('warn', 'pending-save-recovery-unavailable', { recoverable: true });
      }
    }, Math.max(0, Math.min(2_147_483_647, policy.notBeforeMs - nowMs())));
    retry.timer?.unref?.();
    pendingRetries.set(accountKey, retry);
  }

  function schedulePendingRetry(accountKey, failure, capabilityUnavailable = false) {
    if (!durablePendingEnabled) return true;
    const pending = dependencies.readPendingState(accountKey);
    if (!pending) return true;
    const observedStatus = Number(failure?.httpStatus ?? (failure && capabilityHttpStatuses.get(failure)) ?? 0);
    const status = Number.isSafeInteger(observedStatus) && observedStatus >= 100 && observedStatus <= 599 ? observedStatus : 0;
    const failureType = capabilityUnavailable ? 'capability' : status === 0 ? 'transport' : status >= 200 && status < 300 ? 'application' : 'http';
    const previous = retryPolicyFor(pending);
    const attempts = Math.min(1_000_000, (previous?.attempts || 0) + 1);
    const retryAfterValue = Number(failure?.retryAfterMs || 0);
    const retryAfterMs = Number.isFinite(retryAfterValue) ? Math.min(Math.max(retryAfterValue, 0), 2_147_483_647) : 0;
    const conflict = failure?.code === 'STATE_REVISION_CONFLICT';
    const kind = status === 401 || status === 403 ? 'auth' : conflict || !capabilityUnavailable && status >= 400 && status < 500 && status !== 429 ? 'permanent' : 'transient';
    const delay = kind === 'transient'
      ? Math.max(retryAfterMs, Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6) * (0.75 + Math.random() * 0.5))) : retryAfterMs;
    const policy = validatePendingRetryPolicy({ schemaVersion: 1, mutationId: pending.mutationId, sha256: pending.sha256,
      expectedRevision: pending.expectedRevision, kind, httpStatus: status, failureType, ...(conflict ? { code: 'STATE_REVISION_CONFLICT' } : {}), attempts,
      notBeforeMs: delay ? Math.min(8_640_000_000_000_000, Math.ceil(nowMs() + delay)) : 0 }, pending);
    clearPendingRetry(accountKey);
    try {
      if (typeof dependencies.setPendingRetryPolicy !== 'function' || !dependencies.setPendingRetryPolicy(accountKey, pending.mutationId, policy)) throw new Error('Retry policy not preserved');
      unpersistedRetryPolicies.delete(accountKey);
    } catch {
      // Keep this runtime closed if the additive policy cannot reach disk.
      // The original encrypted operation remains intact; no durable-policy claim.
      unpersistedRetryPolicies.set(accountKey, policy);
      return false;
    }
    if (kind === 'transient') ensurePendingRetryTimer(accountKey, pending, policy);
    return true;
  }

  function pendingRetryBlock(accountKey, pending) {
    const policy = retryPolicyFor(pending);
    if (!policy) return null;
    if (unpersistedRetryPolicies.has(accountKey)) {
      try {
        if (typeof dependencies.setPendingRetryPolicy !== 'function' || !dependencies.setPendingRetryPolicy(accountKey, pending.mutationId, policy)) throw new Error('Retry policy not preserved');
        unpersistedRetryPolicies.delete(accountKey);
      } catch {
        return { ok: false, path: 'pending-local-save', accountKey, pending: true, localPersistenceFailure: true,
          code: 'PENDING_POLICY_PERSISTENCE_FAILED', error: 'Pending work is retained, but its retry policy could not be preserved. Restore local storage before recovery.' };
      }
    }
    if (policy.kind === 'transient' && nowMs() >= policy.notBeforeMs) {
      clearPendingRetry(accountKey);
      return null;
    }
    if (policy.kind === 'transient' && !unpersistedRetryPolicies.has(accountKey)) ensurePendingRetryTimer(accountKey, pending, policy);
    return { ok: false, path: 'pending-local-save', accountKey, pending: true,
      code: policy.kind === 'auth' ? 'PENDING_AUTHENTICATION_REQUIRED' : policy.kind === 'permanent' ? 'PENDING_RECONCILIATION_REQUIRED' : 'PENDING_RETRY_WAIT',
      ...(policy.kind === 'transient' ? { retryAfterMs: Math.max(0, policy.notBeforeMs - nowMs()) } : {}),
      error: policy.kind === 'auth' ? 'Sign in to the same venue again to resume this retained pending save.'
        : policy.kind === 'permanent' ? 'The retained change needs explicit reconciliation before it can be replayed.'
          : 'The change is retained locally until its scheduled retry time.' };
  }

  function enqueueAccountMutation(accountKey, mutation) {
    const context = getAccountMutationContext(accountKey);
    const epoch = Symbol('account-mutation');
    context.epoch = epoch;
    lastMutationEpoch = epoch;
    pendingMutationCount += 1;
    const previousMutation = context.pending || Promise.resolve();
    const pendingMutation = previousMutation
      .catch(() => undefined)
      .then(() => mutation(epoch));
    context.pending = pendingMutation;
    void pendingMutation.finally(() => {
      pendingMutationCount -= 1;
      if (context.pending === pendingMutation) context.pending = undefined;
      releaseAccountMutationContext(accountKey, context);
    }).catch(() => undefined);
    return pendingMutation;
  }

  function getDeviceIdPath() {
    return path.join(userDataPath(), 'orbit-device.json');
  }

  function getOrCreateDeviceId() {
    if (cachedDeviceId) return cachedDeviceId;
    const filePath = getDeviceIdPath();
    try {
      if (fileSystem.existsSync(filePath)) {
        const record = JSON.parse(fileSystem.readFileSync(filePath, 'utf8'));
        if (record?.deviceId) {
          cachedDeviceId = String(record.deviceId);
          return cachedDeviceId;
        }
      }
    } catch {
      // Device telemetry must never block desktop startup.
    }

    cachedDeviceId = randomUUID();
    try {
      fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
      fileSystem.writeFileSync(filePath, JSON.stringify({ deviceId: cachedDeviceId, createdAt: now().toISOString() }, null, 2));
    } catch {
      // If persistence fails, the current process can still report with the generated id.
    }
    return cachedDeviceId;
  }

  function getTelemetryVenueInfo() {
    try {
      const record = readLocalDatabase();
      const state = record?.state;
      return {
        venueId: state ? getAccountKeyFromState(state) : 'unassigned',
        venueName: state?.settings?.clubAccount?.clubName || ''
      };
    } catch {
      return { venueId: 'unassigned', venueName: '' };
    }
  }

  function getLocalClientAuthKey() {
    try {
      const record = readLocalDatabase();
      return getClientAuthKeyFromState(record?.state);
    } catch {
      return '';
    }
  }

  function getLocalAccountKey() {
    try {
      const record = readLocalDatabase();
      return record?.state ? getAccountKeyFromState(record.state) : '';
    } catch {
      return '';
    }
  }

  function getApiUrl() {
    // Vercel's generated hostname is valid without www. The www variant does not
    // currently present a matching TLS certificate and must not be used by clients.
    return (environment.ORBIT_API_URL || 'https://orbitapp-one.vercel.app').replace(/\/+$/, '');
  }

  function getApiAuthKey() {
    return environment.ORBIT_CLIENT_API_KEY || getLocalClientAuthKey();
  }

  function getApiConfig() {
    return { apiUrl: getApiUrl(), apiKey: getApiAuthKey() };
  }

  async function postClientTelemetry(pathname, payload) {
    const { apiUrl, apiKey } = getApiConfig();
    if (!apiKey || typeof fetchImpl !== 'function') {
      return;
    }
    const requestId = randomUUID();
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), 2500);
    try {
      const response = await fetchImpl(`${apiUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-orbit-api-key': apiKey,
          'x-orbit-request-id': requestId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) await readApiResponse(response);
    } catch {
      // Telemetry transport is intentionally silent; operational logs show domain changes only.
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  async function performOrbitApiRequest(pathname, options = {}, statePayloadBytes) {
    const apiUrl = getApiUrl();
    const authKey = options.authKey || getApiAuthKey();
    if (!authKey || typeof fetchImpl !== 'function') {
      return null;
    }
    const requestId = randomUUID();
    const method = options.method || 'GET';
    const durableStateFailure = durablePendingEnabled && options.returnFailurePayload && /^\/state(?:\/|$)/.test(pathname);
    let responseStatus = 0;
    const started = nowMs();
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), options.timeoutMs ?? 3500);
    try {
      if (pathname === '/state') writeOrbitApiLog('info', 'state-api-request', { requestId, expectedRevision: options.body?.expectedRevision, payloadBytes: statePayloadBytes ?? Buffer.byteLength(JSON.stringify(options.body?.state || {}), 'utf8') });
      const response = await fetchImpl(`${apiUrl}${pathname}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-orbit-api-key': authKey,
          'x-orbit-auth-key': authKey,
          'x-orbit-request-id': requestId,
          ...(options.headers || {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        ...(options.redirect ? { redirect: options.redirect } : {})
      });
      responseStatus = response.status;
      if (typeof options.observeHttpStatus === 'function') options.observeHttpStatus(response.status);
      const boundedResponse = pathname === '/state/capabilities' || pathname.startsWith('/state/checkpoint');
      const { payload, responsePreview } = await readApiResponse(response, boundedResponse ? 400_000 : options.maximumResponseBytes || 0);
      if (!response.ok || payload?.ok === false) {
        if (method !== 'GET') {
          writeOrbitApiLog('warn', 'sync-update-failed', {
            requestId, method, pathname, status: response.status, durationMs: nowMs() - started,
            error: payload?.error || '', responsePreview
          });
        }
        const retryAfter = response.headers?.get?.('retry-after');
        const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000 : retryAfter ? Math.max(0, Date.parse(retryAfter) - nowMs()) : 0;
        return options.returnFailurePayload ? { ...payload, ...(boundedResponse || durablePendingEnabled && /^\/state(?:\/|$)/.test(pathname) ? { ok: false } : {}), httpStatus: response.status, ...(retryAfterMs ? { retryAfterMs } : {}) } : null;
      }
      return payload === null && durableStateFailure ? { ok: false, httpStatus: responseStatus } : payload;
    } catch (error) {
      if (method !== 'GET') {
        writeOrbitApiLog('error', 'sync-update-failed', {
          requestId, method, pathname, durationMs: nowMs() - started,
          timedOut: controller.signal.aborted, ...orbitApiErrorDetails(error)
        });
      }
      return durableStateFailure ? { ok: false, httpStatus: responseStatus } : null;
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  function requestOrbitApi(pathname, options = {}) {
    return performOrbitApiRequest(pathname, options);
  }

  async function getRemoteBackendStatus() {
    const { apiUrl, apiKey } = getApiConfig();
    if (typeof fetchImpl !== 'function') return null;
    const requestId = randomUUID();
    const started = nowMs();
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), 2500);
    try {
      const response = await fetchImpl(`${apiUrl}/health`, {
        headers: { 'x-orbit-request-id': requestId, ...(apiKey ? { 'x-orbit-api-key': apiKey } : {}) },
        signal: controller.signal
      });
      const { payload } = await readApiResponse(response);
      if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Orbit API returned ${response.status}`);
      const parsed = new URL(apiUrl);
      return {
        running: true,
        host: parsed.hostname,
        port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
        reportCount: 0,
        mode: 'api',
        service: payload.service,
        environment: payload.environment,
        startedAt: payload.startedAt,
        latencyMs: nowMs() - started
      };
    } catch {
      return null;
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  async function validatePilotAccessApi(access) {
    const { apiUrl } = getApiConfig();
    const authKey = getClientAuthKeyFromAccess(access);
    const accountKey = getAccountKeyFromAccess(access);
    if (!authKey || typeof fetchImpl !== 'function') return { ok: false, managed: false, active: false, error: 'Pilot authorization is unavailable.' };
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(`${apiUrl}/license/status?accountKey=${encodeURIComponent(accountKey)}`, {
        headers: {
          'x-orbit-api-key': authKey,
          'x-orbit-auth-key': authKey,
          'x-orbit-request-id': randomUUID()
        },
        signal: controller.signal
      });
      const { payload } = await readApiResponse(response);
      return {
        ok: response.ok && payload?.ok !== false,
        managed: Boolean(payload?.managed || payload?.license),
        active: Boolean(payload?.active),
        license: payload?.license || null,
        error: payload?.error || (response.ok ? '' : `Orbit API returned ${response.status}`)
      };
    } catch (error) {
      return { ok: false, managed: false, active: false, error: error instanceof Error ? error.message : 'Unable to validate pilot access.' };
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  async function peekStateFromApi(accountKey, access) {
    const resolvedAccountKey = sanitizeAccountKey(accountKey || getLocalAccountKey());
    const pathname = resolvedAccountKey ? `/state/${encodeURIComponent(resolvedAccountKey)}` : '/state/latest';
    const capabilities = durablePendingEnabled && resolvedAccountKey ? await getPersistenceCapabilities(access) : null;
    let manifestStatus = 0;
    const payload = capabilities?.checkpoint
      ? await downloadCheckpoint(async (path, options) => {
          const response = await requestOrbitApi(path, options);
          if (path.split('?')[0] === `/state/checkpoint/${encodeURIComponent(resolvedAccountKey)}`) manifestStatus = Number(response?.httpStatus || 0);
          return response;
        }, resolvedAccountKey, getClientAuthKeyFromAccess(access) || undefined, canonicalCheckpointsByAccount.get(resolvedAccountKey))
      : await requestOrbitApi(pathname, { authKey: getClientAuthKeyFromAccess(access) || undefined, returnFailurePayload: durablePendingEnabled });
    const readRejected = durablePendingEnabled && payload?.ok === false;
    if (durablePendingEnabled && resolvedAccountKey) lastReadOutcomeByAccount.set(resolvedAccountKey,
      !readRejected && payload?.state ? 'available' : manifestStatus === 404 || payload?.httpStatus === 404 ? 'missing' : 'unavailable');
    if (readRejected || !payload?.state) return null;
    if (capabilities?.checkpoint && payload.revision >= (canonicalCheckpointsByAccount.get(resolvedAccountKey)?.revision || 0)) {
      // Cache only fully verified server snapshots, never optimistic save input.
      // Two account snapshots cap this bridge cache at 64 MiB of source data.
      canonicalCheckpointsByAccount.delete(resolvedAccountKey);
      canonicalCheckpointsByAccount.set(resolvedAccountKey, structuredClone(payload));
      while (canonicalCheckpointsByAccount.size > 2) canonicalCheckpointsByAccount.delete(canonicalCheckpointsByAccount.keys().next().value);
    }
    const record = {
      schemaVersion: payload.schemaVersion || 1,
      savedAt: payload.savedAt || now().toISOString(),
      state: payload.state,
      accountKey: payload.accountKey,
      source: 'api',
      authoritative: true,
      revision: Number(payload.revision || 0),
      publication: payload.publication || { status: 'not-queued' }
    };
    return record;
  }

  function subscribeToManagementState(access, onEvent) {
    const accountKey = getAccountKeyFromAccess(access);
    const accessKey = getClientAuthKeyFromAccess(access);
    // Unlike legacy state reads, the event URL must never fall back to an auth
    // code as its account identifier. Legacy access keeps the existing GET path.
    if (!isRecord(access) || typeof access.licenseId !== 'string' || !access.licenseId.trim() || !accountKey || typeof onEvent !== 'function') {
      throw new Error('A current management account is required.');
    }
    return createStateEvents({
      onEvent,
      setTimeoutImpl,
      clearTimeoutImpl,
      connect: ({ signal }) => {
        const apiUrl = getApiUrl();
        const authKey = accessKey || getApiAuthKey();
        if (!authKey || typeof fetchImpl !== 'function') throw new Error('Management state notifications are unavailable.');
        const url = new URL(`${apiUrl}/state/${encodeURIComponent(accountKey)}/events`);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          throw new Error('Management notification API URL is invalid.');
        }
        return fetchImpl(url.href, {
          method: 'GET',
          headers: {
            accept: 'text/event-stream',
            'x-orbit-api-key': authKey,
            'x-orbit-auth-key': authKey,
            'x-orbit-request-id': randomUUID()
          },
          cache: 'no-store',
          redirect: 'error',
          signal
        });
      }
    });
  }

  async function readStateWithRevisionOwnership(accountKey, access, owningMutation) {
    const resolvedAccountKey = sanitizeAccountKey(accountKey || getLocalAccountKey());
    const context = resolvedAccountKey ? getAccountMutationContext(resolvedAccountKey) : undefined;
    if (context) context.reads += 1;
    const epochAtStart = context ? context.epoch : lastMutationEpoch;
    const queuedAtStart = context ? Boolean(context.pending) : pendingMutationCount > 0;
    try {
      const record = await peekStateFromApi(resolvedAccountKey, access);
      if (!record) return null;
      const priorRevision = revisionByAccount.get(record.accountKey)
        ?? (durablePendingEnabled ? readLocalDatabase(record.accountKey)?.revision : undefined);
      // A read can finish after a newer save; never roll its revision or cache back.
      if (priorRevision !== undefined && record.revision < priorRevision) {
        throw new Error('Discarded an outdated Orbit state response.');
      }
      const epochUnchanged = (context ? context.epoch : lastMutationEpoch) === epochAtStart;
      const queuedNow = context ? Boolean(context.pending) : pendingMutationCount > 0;
      // Renderer guards may discard this read while optimistic writes are queued.
      // Lending its revision to those older snapshots would bypass server CAS.
      // The QR mutation may adopt its own full read only without a queued successor.
      const ownedRead = owningMutation !== undefined && context &&
        epochAtStart === owningMutation && context.epoch === owningMutation;
      if (!ownedRead && (queuedAtStart || queuedNow || !epochUnchanged)) return record;
      revisionByAccount.set(record.accountKey, record.revision);
      if (priorRevision !== record.revision) {
        try {
          if (durablePendingEnabled) writeLocalDatabase(record.state, record.revision);
          else writeLocalDatabase(record.state);
        } catch {
          // The encrypted local cache is non-authoritative and best-effort.
        }
      }
      return record;
    } finally {
      if (context) {
        context.reads -= 1;
        releaseAccountMutationContext(resolvedAccountKey, context);
      }
    }
  }

  async function loadStateFromApi(accountKey, access) {
    const pending = durablePendingEnabled ? dependencies.readPendingState(accountKey || getLocalAccountKey()) : null;
    if (pending) {
      return {
        schemaVersion: 3, savedAt: pending.createdAt, state: pending.state,
        accountKey: pending.accountKey, source: 'pending-local-save', authoritative: false,
        revision: pending.expectedRevision, pending: true, publication: { status: 'not-queued' }
      };
    }
    return readStateWithRevisionOwnership(accountKey, access);
  }

  async function createSelfCheckInQrKitApi(access) {
    const authKey = getClientAuthKeyFromAccess(access);
    if (!authKey) return { ok: false, error: 'A current pilot license key is required.' };
    const accountKey = getAccountKeyFromAccess(access);
    return enqueueAccountMutation(accountKey, async () => {
      const knownRevision = revisionByAccount.get(accountKey);
      const mutationId = `kit:${randomUUID()}`;
      const requestKit = () => requestOrbitApi('/management/self-check-in/qr', {
        method: 'POST',
        authKey,
        body: { mutationId },
        timeoutMs: 10_000,
        returnFailurePayload: true
      });
      let payload = await requestKit();
      if (!payload) payload = await requestKit();
      if (!payload) {
        return {
          ok: false,
          error: 'Orbit could not confirm QR generation. Previously printed codes may have been deactivated; generate the PDF again before using an older print.'
        };
      }
      const responseRevision = Number(payload.revision);
      if (
        !payload?.ok ||
        typeof payload.accountKey !== 'string' ||
        typeof payload.clubName !== 'string' ||
        typeof payload.checkInUrl !== 'string' ||
        typeof payload.expiresAt !== 'string' ||
        !Number.isSafeInteger(responseRevision) ||
        responseRevision < 0 ||
        typeof payload.selfCheckIn?.capabilityGeneration !== 'string' ||
        typeof payload.selfCheckIn?.generatedAt !== 'string'
      ) {
        return { ok: false, error: payload?.error || 'The club self-check-in code could not be generated.' };
      }
      const responseAccountKey = sanitizeAccountKey(payload.accountKey);
      if (!responseAccountKey || (accountKey && responseAccountKey !== accountKey)) {
        return { ok: false, error: 'The generated self-check-in code did not match the active club.' };
      }
      // A QR response contains only the server-managed self-check-in slice. It is
      // safe to advance a full-state writer only when this was the sole revision.
      if (
        knownRevision !== undefined &&
        responseRevision === knownRevision + 1 &&
        revisionByAccount.get(responseAccountKey) === knownRevision
      ) {
        revisionByAccount.set(responseAccountKey, responseRevision);
      }
      return {
        ok: true,
        clubName: payload.clubName,
        checkInUrl: payload.checkInUrl,
        expiresAt: payload.expiresAt,
        selfCheckIn: payload.selfCheckIn,
        rotatedPreviousCode: Boolean(payload.rotatedPreviousCode)
      };
    });
  }

  async function redeemMembershipQrApi(access, token) {
    const authKey = getClientAuthKeyFromAccess(access);
    const accountKey = getAccountKeyFromAccess(access);
    const normalizedToken = String(token || '').trim();
    if (!authKey || !accountKey) {
      return { ok: false, code: 'MEMBERSHIP_QR_REDEEM_FORBIDDEN', error: 'A current club license is required.' };
    }
    if (!/^omq1_[A-Za-z0-9_-]{43}$/.test(normalizedToken)) {
      return { ok: false, code: 'INVALID_INPUT', error: 'That is not a valid Orbit membership QR.' };
    }
    return enqueueAccountMutation(accountKey, async (owningMutation) => {
      const mutationId = `scan:${randomUUID()}`;
      const redeem = () => requestOrbitApi('/management/membership-qr/redeem', {
        method: 'POST',
        authKey,
        body: { token: normalizedToken, mutationId },
        timeoutMs: 10_000,
        returnFailurePayload: true
      });
      let payload = await redeem();
      if (!payload) payload = await redeem();
      if (!payload?.ok) {
        return {
          ok: false,
          code: String(payload?.code || 'MEMBERSHIP_QR_REDEEM_UNCONFIRMED'),
          error: String(payload?.error || 'Orbit could not confirm this check-in. Scan the same code again.')
        };
      }
      const record = await readStateWithRevisionOwnership(accountKey, access, owningMutation).catch(() => null);
      return {
        ok: true,
        status: payload.status === 'already-checked-in' ? 'already-checked-in' : 'checked-in',
        playerName: String(payload.playerName || '').slice(0, 160),
        duplicate: Boolean(payload.duplicate),
        state: record?.authoritative ? record.state : undefined
      };
    });
  }

  async function getManagementRecoveryStatusApi(access) {
    const authKey = getClientAuthKeyFromAccess(access);
    if (!authKey) return { ok: false, active: false, error: 'A current pilot license key is required.' };
    const payload = await requestOrbitApi('/management/recovery/status', {
      authKey,
      timeoutMs: 5000,
      returnFailurePayload: true
    });
    return payload?.ok
      ? { ok: true, active: Boolean(payload.active), expiresAt: payload.expiresAt || null, username: payload.username || '' }
      : { ok: false, active: false, error: payload?.error || 'Unable to check owner-assisted recovery.' };
  }

  async function completeManagementRecoveryApi(access, password) {
    const authKey = getClientAuthKeyFromAccess(access);
    if (!authKey) return { ok: false, error: 'A current pilot license key is required.' };
    const requestedAccountKey = getAccountKeyFromAccess(access);
    const payload = await requestOrbitApi('/management/recovery/complete', {
      method: 'POST',
      authKey,
      body: { password: String(password || '') },
      timeoutMs: 15_000,
      returnFailurePayload: true
    });
    if (!payload?.ok || !payload.accountLogin) {
      return { ok: false, error: payload?.error || 'Owner-assisted recovery could not be completed.' };
    }
    const accountKey = sanitizeAccountKey(payload.accountKey);
    const recoveryRevision = Number(payload.revision);
    if (!requestedAccountKey || accountKey !== requestedAccountKey || !Number.isSafeInteger(recoveryRevision) || recoveryRevision < 1) {
      return { ok: false, error: 'The recovered account did not match the active club. Reload the club before signing in.' };
    }
    // A credential-only response must never advance the full-state writer: the
    // renderer may still hold an empty or outdated room. Fetch the complete
    // record without changing the write revision, then let the renderer adopt
    // it without issuing another full-state save.
    const record = await peekStateFromApi(accountKey, access).catch(() => null);
    const login = record?.state?.settings?.accountLogin;
    if (
      !record?.state ||
      sanitizeAccountKey(record.accountKey) !== accountKey ||
      getAccountKeyFromState(record.state) !== accountKey ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < recoveryRevision ||
      record.revision < (revisionByAccount.get(accountKey) || 0) ||
      !Array.isArray(record.state.games) ||
      !Array.isArray(record.state.sessions) ||
      !Array.isArray(record.state.playerSessions) ||
      typeof login?.username !== 'string' || !login.username.trim() ||
      typeof login.passwordSalt !== 'string' || !login.passwordSalt ||
      typeof login.passwordHash !== 'string' || !login.passwordHash ||
      login.username.trim().toLowerCase() !== String(payload.accountLogin.username || '').trim().toLowerCase() ||
      login.passwordSalt !== payload.accountLogin.passwordSalt ||
      login.passwordHash !== payload.accountLogin.passwordHash
    ) {
      return { ok: false, error: 'Password recovery completed, but the latest club data could not be loaded safely. Reopen Orbit and sign in with the new password.' };
    }
    return {
      ok: true,
      accountKey,
      accountLogin: login,
      state: record.state,
      revision: record.revision,
      publication: record.publication
    };
  }

  async function performStateSave(state, accountKey) {
    const authKey = replayAuthByAccount.get(accountKey) || getClientAuthKeyFromState(state) || undefined;
    const { source, sha256 } = sourceForState(state);
    let expectedRevision = revisionByAccount.get(accountKey) ?? (durablePendingEnabled ? readLocalDatabase(accountKey)?.revision : undefined) ?? 0;
    const stateHash = sha256.slice(0, 32);
    let mutationId = `desktop:${accountKey}:${expectedRevision}:${stateHash}`;
    let pending;
    if (durablePendingEnabled) {
      try {
        pending = dependencies.readPendingState(accountKey);
        if (pending && pending.sha256 !== sha256) {
          return { ok: false, path: 'pending-local-save', accountKey, pending: false, blockedByPending: true, conflict: true,
            code: 'PENDING_SAVE_REQUIRES_RECOVERY', error: 'A previous change is retained locally. Recover or reconcile it before accepting another change.' };
        }
        if (!pending) pending = preservePendingState(state);
        if (pending.pauseCode === 'CHECKPOINT_ACK_INVALID' || pausedAcknowledgements.get(accountKey) === pending.mutationId) {
          return { ok: false, path: 'pending-local-save', accountKey, pending: true, code: 'CHECKPOINT_ACK_INVALID',
            error: 'The pending checkpoint is retained. Replay is paused until its mismatched acknowledgement has been reconciled.' };
        }
        const blocked = pendingRetryBlock(accountKey, pending);
        if (blocked) return blocked;
        expectedRevision = pending.expectedRevision;
        mutationId = pending.mutationId;
      } catch {
        return { ok: false, path: 'local-persistence', accountKey, localPersistenceFailure: true,
          error: 'This change could not be durably preserved locally. Free disk space or restore OS-backed encryption, then retry. Existing pending work has been retained.' };
      }
    }
    const diagnostic = {
      accountRef: crypto.createHash('sha256').update(accountKey).digest('hex').slice(0, 12),
      expectedRevision, mutationRef: stateHash.slice(0, 12),
      payloadBytes: source.length,
      authAvailable: Boolean(getClientAuthKeyFromState(state) || getApiConfig().apiKey)
    };
    writeOrbitApiLog('info', 'state-save-attempt', diagnostic);
    const capabilities = durablePendingEnabled ? await getPersistenceCapabilities(authKey ? { authorizationCode: authKey } : state.settings?.pilotAccess) : null;
    if (capabilities?.httpStatus === 401 || capabilities?.httpStatus === 403) {
      schedulePendingRetry(accountKey, capabilities);
      return { ok: false, path: 'pending-local-save', accountKey, pending: true,
        error: 'Sign in to the same venue again to resume this retained pending save.' };
    }
    if (capabilities?.httpStatus === 429 || capabilities?.httpStatus >= 500) {
      schedulePendingRetry(accountKey, capabilities);
      return { ok: false, path: 'pending-local-save', accountKey, pending: true,
        error: 'The change is retained locally while Orbit is unavailable. Server confirmation will retry automatically.' };
    }
    // Reuse the serialized source for the envelope-size decision. This keeps
    // the released legacy path at two state traversals, including the request.
    const envelopeBytes = durablePendingEnabled
      ? source.length + Buffer.byteLength(JSON.stringify({ expectedRevision, mutationId }), 'utf8') + 9 : 0;
    if (envelopeBytes > 2_000_000 && !capabilities?.checkpoint && pending?.transport !== 'checkpoint-v1' && durablePendingEnabled) {
      schedulePendingRetry(accountKey, capabilities, true);
      return { ok: false, path: 'pending-local-save', accountKey, pending: true,
        error: 'This venue needs compatible checkpoint support on the Orbit API before its retained pending save can be confirmed.' };
    }
    if (durablePendingEnabled && !pending.transport) {
      try {
        pending = dependencies.selectPendingTransport(accountKey, mutationId, capabilities?.checkpoint ? 'checkpoint-v1' : 'legacy');
      } catch {
        return { ok: false, path: 'pending-local-save', accountKey, pending: true,
          error: 'The change is retained locally, but its transfer could not be durably prepared. Restore local disk access, then retry.' };
      }
    }
    const payload = pending?.transport === 'checkpoint-v1'
      ? await uploadCheckpoint(requestOrbitApi, pending, authKey)
      : await performOrbitApiRequest('/state', {
      method: 'POST',
      body: { state, expectedRevision, mutationId },
      headers: { 'x-orbit-mutation-id': mutationId },
      authKey,
      timeoutMs: 5000,
      returnFailurePayload: true
      }, state ? source.length : 2);
    writeOrbitApiLog(payload?.ok ? 'info' : 'warn', 'state-api-result', { ...diagnostic, result: payload?.ok ? 'accepted' : payload?.code || 'api-failure', currentRevision: Number(payload?.revision || payload?.currentRevision || 0), httpStatus: payload?.httpStatus || 0 });
    if (payload?.code === 'STATE_REVISION_CONFLICT') {
      schedulePendingRetry(accountKey, payload);
      return {
        ok: false,
        path: 'orbit-api',
        accountKey,
        conflict: true,
        ...(durablePendingEnabled ? { pending: true } : {}),
        expectedRevision,
        currentRevision: Number(payload.currentRevision || 0),
        error: payload.error || 'Venue state changed elsewhere.'
      };
    }
    if (!payload?.ok) {
      if (payload?.code === 'CHECKPOINT_ACK_INVALID') {
        pausedAcknowledgements.set(accountKey, mutationId);
        try { dependencies.pausePendingState?.(accountKey, mutationId); } catch {
          // The encrypted source still exists. Keep this runtime paused even
          // when local storage cannot record the additional recovery marker.
        }
      }
      if (payload?.code === 'CHECKPOINT_ACK_INVALID') clearPendingRetry(accountKey);
      else schedulePendingRetry(accountKey, payload);
      return durablePendingEnabled ? {
      ok: false, path: 'pending-local-save', accountKey, pending: true,
      code: payload?.code, httpStatus: payload?.httpStatus,
      error: payload?.httpStatus === 401 || payload?.httpStatus === 403
        ? 'Sign in to the same venue again to resume this retained pending save.'
        : payload?.error || 'The change is retained locally; the server commit is not confirmed.'
      } : null;
    }
    if (durablePendingEnabled && (payload.accountKey !== accountKey
      || !Number.isSafeInteger(payload.revision) || payload.revision < 1)) {
      return { ok: false, path: 'pending-local-save', accountKey, pending: true,
        error: 'The server acknowledgement did not match this venue. The pending change has been retained.' };
    }
    clearPendingRetry(accountKey);
    const validatedAuth = validatedReplayAuthByAccount.get(accountKey);
    if (validatedAuth?.mutationId === mutationId && replayAuthByAccount.get(accountKey) === validatedAuth.authKey) replayAuthByAccount.delete(accountKey);
    validatedReplayAuthByAccount.delete(accountKey);
    revisionByAccount.set(accountKey, Number(payload.revision || expectedRevision + 1));
    if (durablePendingEnabled) {
      try { dependencies.acknowledgePendingState(accountKey, mutationId, Number(payload.revision)); } catch {
        // The commit is authoritative. Retaining the same operation on disk is
        // safe: restart retries the receipt rather than repeating its effect.
      }
    }
    return {
      ok: true,
      path: 'orbit-api',
      engine: 'api',
      accountKey: payload.accountKey,
      savedAt: payload.savedAt,
      revision: Number(payload.revision || expectedRevision + 1),
      duplicate: Boolean(payload.duplicate),
      publication: payload.publication || { status: 'pending' },
      authoritative: true
    };
  }

  function saveStateToApi(state, access, expectedPendingMutationId) {
    const accountKey = getAccountKeyFromState(state);
    const calledWithPending = durablePendingEnabled ? dependencies.readPendingState(accountKey) : null;
    const requiredOperation = expectedPendingMutationId || calledWithPending?.mutationId;
    const validatedAuth = validatedReplayAuthByAccount.get(accountKey);
    if (validatedAuth && validatedAuth.mutationId !== calledWithPending?.mutationId) {
      if (replayAuthByAccount.get(accountKey) === validatedAuth.authKey) replayAuthByAccount.delete(accountKey);
      validatedReplayAuthByAccount.delete(accountKey);
    }
    if (access) {
      if (getAccountKeyFromAccess(access) !== accountKey) return Promise.reject(new Error('Pending work belongs to another venue.'));
      const authKey = getClientAuthKeyFromAccess(access);
      if (authKey && (!validatedAuth || validatedAuth.mutationId !== calledWithPending?.mutationId)) replayAuthByAccount.set(accountKey, authKey);
    }
    return enqueueAccountMutation(accountKey, async () => {
      if (requiredOperation && dependencies.readPendingState(accountKey)?.mutationId !== requiredOperation) {
        return { ok: false, accountKey, conflict: true, code: 'PENDING_REPLAY_SUPERSEDED',
          error: 'The retained operation changed or completed. Load canonical state before another save.' };
      }
      const result = await performStateSave(state, accountKey);
      if ((result?.ok || result?.pending) && typeof dependencies.onManagementSaveStatus === 'function') {
        dependencies.onManagementSaveStatus({
          accountKey, ok: Boolean(result.ok), pending: Boolean(result.pending),
          sourceHash: sourceForState(state).sha256,
          revision: Number('revision' in result ? result.revision || 0 : 0),
          publication: 'publication' in result ? result.publication || { status: 'not-queued' } : { status: 'not-queued' }
        });
      }
      return result;
    });
  }

  async function submitAnalyticalReportToApi(report) {
    const payload = await requestOrbitApi('/analytical-reports', {
      method: 'POST',
      body: report,
      timeoutMs: 5000
    });
    if (!payload?.ok) return null;
    return {
      ...payload,
      backend: (await getRemoteBackendStatus()) || { running: true, host: 'api', port: 0, reportCount: 0, mode: 'api' }
    };
  }

  function buildClientTelemetryPayload(overrides = {}) {
    const venue = getTelemetryVenueInfo();
    return {
      ...venue,
      deviceId: getOrCreateDeviceId(),
      deviceName: hostname(),
      appVersion: app.getVersion(),
      platform,
      environment: environment.NODE_ENV || (isDev ? 'development' : 'production'),
      updateStatus: lastUpdateStatus,
      updateEvent: lastUpdateEvent,
      lastSeenAt: now().toISOString(),
      ...overrides
    };
  }

  function sendClientHeartbeat(overrides = {}) {
    void postClientTelemetry('/clients/heartbeat', buildClientTelemetryPayload(overrides));
  }

  function sendClientEvent(event, category = 'usage', details = {}, overrides = {}) {
    void postClientTelemetry('/clients/event', buildClientTelemetryPayload({
      event,
      category,
      details,
      occurredAt: now().toISOString(),
      ...overrides
    }));
  }

  function sendClientError(error, source = 'main', details = {}) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    const stack = details.rendererStack || (error instanceof Error ? error.stack || '' : '');
    void postClientTelemetry('/clients/error', buildClientTelemetryPayload({
      message,
      stack,
      source,
      route: details.route || '',
      details,
      occurredAt: now().toISOString(),
      lastError: message
    }));
  }

  function sendClientUpdateEvent(updateEvent, updateStatus, details = {}) {
    lastUpdateEvent = updateEvent;
    lastUpdateStatus = updateStatus;
    void postClientTelemetry('/clients/update-event', buildClientTelemetryPayload({
      updateEvent,
      updateStatus,
      details,
      lastError: details.error || details.message || ''
    }));
  }

  function startClientTelemetry() {
    sendClientHeartbeat();
    sendClientEvent('app-opened', 'lifecycle', {
      packaged: app.isPackaged,
      startedAt: getAppStartedAt(),
      locale: app.getLocale()
    });
    clientHeartbeatTimer = setIntervalImpl(() => sendClientHeartbeat(), 5 * 60 * 1000);
  }

  function stopClientTelemetry() {
    if (!clientHeartbeatTimer) return;
    clearIntervalImpl(clientHeartbeatTimer);
    clientHeartbeatTimer = undefined;
  }

  function getClientUpdateState() {
    return { updateStatus: lastUpdateStatus, updateEvent: lastUpdateEvent };
  }

  async function resumePendingManagementState(access) {
    const capturedAccess = isRecord(access) ? { ...access } : null;
    const accountKey = getAccountKeyFromAccess(capturedAccess);
    const authKey = getClientAuthKeyFromAccess(capturedAccess);
    if (!durablePendingEnabled || !accountKey || !authKey) return { ok: false, pending: false, error: 'A current same-venue sign-in is required.' };
    const pending = dependencies.readPendingState(accountKey);
    if (!pending) return { ok: true, pending: false };
    const policy = retryPolicyFor(pending);
    if (pending.pauseCode || pausedAcknowledgements.get(accountKey) === pending.mutationId || !policy || policy.kind !== 'auth' || policy.notBeforeMs > nowMs()) {
      return { ok: false, pending: true, code: 'PENDING_RECOVERY_PAUSED' };
    }
    const expiresAt = capturedAccess.expiresAt;
    if (expiresAt !== undefined) {
      const effectiveExpiry = typeof expiresAt === 'string' ? Date.parse(expiresAt.includes('T') ? expiresAt : expiresAt + 'T23:59:59.999') : Number.NaN;
      if (!Number.isFinite(effectiveExpiry) || effectiveExpiry <= nowMs()) return { ok: false, pending: true, code: 'PENDING_AUTHENTICATION_REQUIRED' };
    }
    const originalPolicy = JSON.stringify(policy);
    let manifestHttpStatus = 0;
    const manifest = await requestOrbitApi(`/state/checkpoint/${encodeURIComponent(accountKey)}`, { authKey, returnFailurePayload: true, redirect: 'error', observeHttpStatus: status => { manifestHttpStatus = status; } });
    const confirmedMissing = pending.expectedRevision === 0 && manifestHttpStatus === 404 && manifest?.code === 'CHECKPOINT_STATE_NOT_FOUND';
    let proven = confirmedMissing || manifestHttpStatus === 200 && manifest?.ok === true && manifest.notModified !== true && manifest.protocol === 'checkpoint-v1' && manifest.accountKey === accountKey
      && Number.isSafeInteger(manifest.revision) && manifest.revision >= 1
      && Number.isSafeInteger(manifest.sourceBytes) && manifest.sourceBytes >= 2 && manifest.sourceBytes <= 33_554_432
      && manifest.chunkBytes === 262_144 && manifest.chunkCount === Math.ceil(manifest.sourceBytes / 262_144)
      && manifest.chunkCount <= 128 && typeof manifest.sha256 === 'string' && /^[a-f0-9]{64}$/.test(manifest.sha256);
    if (!proven && manifestHttpStatus === 404 && manifest?.code !== 'CHECKPOINT_STATE_NOT_FOUND') {
      // Older small-state servers may not implement checkpoint manifests.
      let canonicalHttpStatus = 0;
      const record = await requestOrbitApi(`/state/${encodeURIComponent(accountKey)}`, { authKey, returnFailurePayload: true, redirect: 'error', maximumResponseBytes: 2_000_000, observeHttpStatus: status => { canonicalHttpStatus = status; } });
      try {
        validateStatePayload(record?.state);
        proven = canonicalHttpStatus === 200 && record?.ok === true && record.accountKey === accountKey && getAccountKeyFromState(record.state) === accountKey
          && Number.isSafeInteger(record.revision) && record.revision >= 1;
      } catch { proven = false; }
    }
    if (!proven) return { ok: false, pending: true, code: 'PENDING_AUTHENTICATION_REQUIRED' };
    return enqueueAccountMutation(accountKey, async () => {
      const current = dependencies.readPendingState(accountKey);
      if (!current || current.mutationId !== pending.mutationId || current.sha256 !== pending.sha256
        || current.expectedRevision !== pending.expectedRevision || current.transport !== pending.transport || current.pauseCode
        || pausedAcknowledgements.get(accountKey) === pending.mutationId
        || JSON.stringify(retryPolicyFor(current)) !== originalPolicy) return { ok: false, pending: Boolean(current), code: 'PENDING_RECOVERY_CHANGED' };
      try {
        if (typeof dependencies.setPendingRetryPolicy !== 'function' || !dependencies.setPendingRetryPolicy(accountKey, current.mutationId, null)) throw new Error('Retry policy changed');
      } catch { return { ok: false, pending: true, code: 'PENDING_POLICY_PERSISTENCE_FAILED' }; }
      unpersistedRetryPolicies.delete(accountKey);
      replayAuthByAccount.set(accountKey, authKey);
      validatedReplayAuthByAccount.set(accountKey, { mutationId: current.mutationId, authKey });
      clearPendingRetry(accountKey);
      return { ok: true, pending: true };
    });
  }

  async function loadStateApiFirst(accountKey, access) {
    if (durablePendingEnabled) {
      const resolvedAccountKey = sanitizeAccountKey(accountKey || getLocalAccountKey());
      const pending = dependencies.readPendingState(resolvedAccountKey);
      if (pending) {
        if (access && getAccountKeyFromAccess(access) !== resolvedAccountKey) throw new Error('Pending work belongs to another venue.');
        await saveStateToApi(pending.state, access, pending.mutationId).catch(() => undefined);
        if (dependencies.readPendingState(resolvedAccountKey)) return loadStateFromApi(resolvedAccountKey, access);
      }
    }
    const apiRecord = await loadStateFromApi(accountKey, access);
    if (apiRecord) return apiRecord;

    let fallbackRecord = await loadStateWithFirebaseFallback(accountKey);
    if (!fallbackRecord?.state && access) {
      fallbackRecord = migrateLocalAccountToPilotAccess(access);
    }
    if (fallbackRecord?.state) {
      // A new durable API database may be initialized once from the characterized
      // local cache. Compare-and-swap revision zero prevents overwriting a venue.
      const mayInitialize = !durablePendingEnabled || lastReadOutcomeByAccount.get(getAccountKeyFromState(fallbackRecord.state)) === 'missing';
      const migration = mayInitialize ? await saveStateToApi(fallbackRecord.state).catch(() => null) : null;
      if (migration?.ok) {
        return {
          ...fallbackRecord,
          accountKey: migration.accountKey,
          savedAt: migration.savedAt || fallbackRecord.savedAt,
          revision: migration.revision,
          publication: migration.publication,
          source: 'api-cache-migration',
          authoritative: true
        };
      }
    }
    return fallbackRecord ? { ...fallbackRecord, source: fallbackRecord.source || 'offline-cache', authoritative: false } : null;
  }

  async function saveStateApiFirst(state) {
    const apiResult = await saveStateToApi(state);
    if (apiResult?.ok) {
      try {
        if (durablePendingEnabled) writeLocalDatabase(state, apiResult.revision);
        else writeLocalDatabase(state);
      } catch {
        // Local cache writes are best-effort once the standalone API has accepted the state.
      }
      return apiResult;
    }
    // A revision conflict means this renderer state is stale. Persisting it to
    // the offline cache would let a later fallback resurrect sessions that the
    // authoritative API has already changed (for example, a QR check-in).
    if (apiResult?.conflict || apiResult?.pending || apiResult?.localPersistenceFailure) return apiResult;
    const cacheResult = await saveStateEverywhere(state);
    return {
      ...cacheResult,
      ok: false,
      conflict: Boolean(apiResult?.conflict),
      currentRevision: apiResult?.currentRevision,
      error: apiResult?.error || 'Saved to offline cache; the server commit is still required.'
    };
  }

  async function submitAnalyticalReportApiFirst(report) {
    return (await submitAnalyticalReportToApi(report)) || storeAnalyticalReport(report);
  }

  return {
    buildClientTelemetryPayload,
    completeManagementRecoveryApi,
    createSelfCheckInQrKitApi,
    getApiConfig,
    getClientUpdateState,
    getOrCreateDeviceId,
    getRemoteBackendStatus,
    getPersistenceCapabilities,
    preservePendingState,
    getManagementRecoveryStatusApi,
    loadStateApiFirst,
    resumePendingManagementState,
    loadStateFromApi,
    peekStateFromApi,
    postClientTelemetry,
    redeemMembershipQrApi,
    requestOrbitApi,
    saveStateApiFirst,
    saveStateToApi,
    sendClientError,
    sendClientEvent,
    sendClientHeartbeat,
    sendClientUpdateEvent,
    startClientTelemetry,
    stopClientTelemetry,
    subscribeToManagementState,
    submitAnalyticalReportApiFirst,
    submitAnalyticalReportToApi,
    validatePilotAccessApi
  };
}

module.exports = {
  createOrbitApiClient,
  getClientAuthKeyFromAccess,
  getClientAuthKeyFromState,
  readApiResponse
};
