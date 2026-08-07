const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  isRecord,
  orbitApiErrorDetails,
  sanitizeAccountKey
} = require('./runtimeUtils.cjs');

async function readApiResponse(response) {
  const text = await response.text().catch(() => '');
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
    buildPlayerClubSnapshot,
    getAppStartedAt,
    isDev,
    isFirebaseConfigured,
    loadStateWithFirebaseFallback,
    saveStateEverywhere,
    storeAnalyticalReport,
    writeLocalDatabase,
    writeOrbitApiLog,
    writeStateToFirebase
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
  const setIntervalImpl = dependencies.setIntervalImpl || setInterval;
  const setTimeoutImpl = dependencies.setTimeoutImpl || setTimeout;
  const userDataPath = dependencies.userDataPath || (() => app.getPath('userData'));

  let cachedDeviceId;
  let clientHeartbeatTimer;
  let lastUpdateStatus = '';
  let lastUpdateEvent = '';

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

  function getApiConfig() {
    // Vercel's generated hostname is valid without www. The www variant does not
    // currently present a matching TLS certificate and must not be used by clients.
    const apiUrl = (environment.ORBIT_API_URL || 'https://orbitapp-one.vercel.app').replace(/\/+$/, '');
    const apiKey = environment.ORBIT_CLIENT_API_KEY || getLocalClientAuthKey();
    return { apiUrl, apiKey };
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

  async function requestOrbitApi(pathname, options = {}) {
    const { apiUrl, apiKey } = getApiConfig();
    const authKey = options.authKey || apiKey;
    if (!authKey || typeof fetchImpl !== 'function') {
      return null;
    }
    const requestId = randomUUID();
    const method = options.method || 'GET';
    const started = nowMs();
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), options.timeoutMs ?? 3500);
    try {
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
        signal: controller.signal
      });
      const { payload, responsePreview } = await readApiResponse(response);
      if (!response.ok || payload?.ok === false) {
        if (method !== 'GET') {
          writeOrbitApiLog('warn', 'sync-update-failed', {
            requestId, method, pathname, status: response.status, durationMs: nowMs() - started,
            error: payload?.error || '', responsePreview
          });
        }
        return null;
      }
      return payload;
    } catch (error) {
      if (method !== 'GET') {
        writeOrbitApiLog('error', 'sync-update-failed', {
          requestId, method, pathname, durationMs: nowMs() - started,
          timedOut: controller.signal.aborted, ...orbitApiErrorDetails(error)
        });
      }
      return null;
    } finally {
      clearTimeoutImpl(timeout);
    }
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

  async function loadStateFromApi(accountKey, access) {
    const resolvedAccountKey = sanitizeAccountKey(accountKey || getLocalAccountKey());
    const pathname = resolvedAccountKey ? `/state/${encodeURIComponent(resolvedAccountKey)}` : '/state/latest';
    const payload = await requestOrbitApi(pathname, { authKey: getClientAuthKeyFromAccess(access) || undefined });
    if (!payload?.state) return null;
    return {
      schemaVersion: payload.schemaVersion || 1,
      savedAt: payload.savedAt || now().toISOString(),
      state: payload.state,
      accountKey: payload.accountKey,
      source: 'api'
    };
  }

  async function saveStateToApi(state) {
    const payload = await requestOrbitApi('/state', {
      method: 'POST',
      body: { state },
      authKey: getClientAuthKeyFromState(state) || undefined,
      timeoutMs: 5000
    });
    if (!payload?.ok) return null;
    return {
      ok: true,
      path: 'orbit-api',
      engine: 'api',
      accountKey: payload.accountKey,
      savedAt: payload.savedAt
    };
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

  async function loadStateApiFirst(accountKey, access) {
    const apiRecord = await loadStateFromApi(accountKey, access);
    if (apiRecord) return apiRecord;

    const fallbackRecord = await loadStateWithFirebaseFallback(accountKey);
    if (fallbackRecord?.state) {
      // A new API database may not have this licensed venue yet. Seed it from the
      // local/Firebase source of truth so player requests have a matching target.
      await saveStateToApi(fallbackRecord.state).catch(() => null);
    }
    return fallbackRecord;
  }

  async function saveStateApiFirst(state) {
    const apiResult = await saveStateToApi(state);
    if (apiResult) {
      try {
        writeLocalDatabase(state);
      } catch {
        // Local cache writes are best-effort once the standalone API has accepted the state.
      }
      if (isFirebaseConfigured()) {
        const accountKey = getAccountKeyFromState(state);
        const publicSnapshot = buildPlayerClubSnapshot(state);
        try {
          writeStateToFirebase(accountKey, state, publicSnapshot).catch(() => undefined);
        } catch {
          // Firebase sync must never block an accepted API save.
        }
        return {
          ...apiResult,
          firebase: { ok: true, engine: 'firebase', accountKey, pending: true }
        };
      }
      return apiResult;
    }
    return saveStateEverywhere(state);
  }

  async function submitAnalyticalReportApiFirst(report) {
    return (await submitAnalyticalReportToApi(report)) || storeAnalyticalReport(report);
  }

  return {
    buildClientTelemetryPayload,
    getApiConfig,
    getClientUpdateState,
    getOrCreateDeviceId,
    getRemoteBackendStatus,
    loadStateApiFirst,
    loadStateFromApi,
    postClientTelemetry,
    requestOrbitApi,
    saveStateApiFirst,
    saveStateToApi,
    sendClientError,
    sendClientEvent,
    sendClientHeartbeat,
    sendClientUpdateEvent,
    startClientTelemetry,
    stopClientTelemetry,
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
