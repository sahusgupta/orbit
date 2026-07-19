const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const nodemailer = require('nodemailer');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const branding = require('../branding.config.json');
const {
  fetchPendingPlayerRequests,
  isFirebaseConfigured,
  markPlayerRequestApplied,
  readStateFromFirebase,
  writeStateToFirebase
} = require('./firebaseSync.cjs');

const isDev = process.env.ELECTRON_DEV === 'true';
const updateCheckIntervalMs = 30 * 60 * 1000;

if (process.env.TABLEMANAGER_USER_DATA_DIR) {
  app.setPath('userData', process.env.TABLEMANAGER_USER_DATA_DIR);
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');

const windows = new Map();
const validRoutes = new Set(['floor', 'table', 'builder', 'profiles', 'signals', 'summary', 'customization', 'kpis', 'tournaments', 'tournament-tv', 'pilot', 'outreach']);
let database;
let embeddedBackend;
let embeddedBackendStatus = { running: false, host: '127.0.0.1', port: 0, reportCount: 0 };
let updateCheckTimer;
let clientHeartbeatTimer;
let cachedDeviceId;
let lastUpdateStatus = '';
let lastUpdateEvent = '';
let appStartedAt = new Date().toISOString();
let lastUpdateProgressBucket = -1;
let warnedAboutMissingApiKey = false;

function writeOrbitApiLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };
  const message = `[orbit-api] ${JSON.stringify(entry)}`;
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger(message);
  try {
    const logPath = path.join(app.getPath('userData'), 'orbit-api.log');
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      fs.copyFileSync(logPath, `${logPath}.previous`);
      fs.truncateSync(logPath, 0);
    }
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Console logging remains available if the packaged log file cannot be written.
  }
}

function orbitApiErrorDetails(error) {
  const cause = error instanceof Error ? error.cause : undefined;
  return {
    errorName: error instanceof Error ? error.name : 'Error',
    errorMessage: error instanceof Error ? error.message : String(error || 'Request failed'),
    errorCode: error?.code || cause?.code || '',
    cause: cause instanceof Error ? cause.message : cause ? String(cause) : ''
  };
}

async function readApiResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return { payload: null, responsePreview: '' };
  try {
    return { payload: JSON.parse(text), responsePreview: '' };
  } catch {
    return { payload: null, responsePreview: text.replace(/\s+/g, ' ').slice(0, 300) };
  }
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateStatePayload(state) {
  if (!isRecord(state)) throw new Error('State payload must be an object.');
  if (!Array.isArray(state.games)) throw new Error('State payload is missing games.');
  if (!Array.isArray(state.sessions)) throw new Error('State payload is missing sessions.');
  if (!Array.isArray(state.playerSessions)) throw new Error('State payload is missing player sessions.');
  if (!isRecord(state.settings)) throw new Error('State payload is missing settings.');
}

function openTrustedExternal(url) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      shell.openExternal(url);
    }
  } catch {
    // Ignore malformed external links.
  }
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const apiKeySid = process.env.TWILIO_API_KEY_SID || '';
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_API_SECRET || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_KEY || '';
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_FROM || '';
  const username = apiKeySid || accountSid;
  const password = apiKeySid ? apiKeySecret : authToken;

  if (!accountSid || !username || !password || !from) {
    return {
      ok: false,
      error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET, and TWILIO_FROM_NUMBER.'
    };
  }

  return { ok: true, accountSid, username, password, from };
}

function normalizeTextMessageBatch(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return messages
    .map((message) => ({
      to: String(message?.to || '').trim(),
      body: String(message?.body || '').trim(),
      profileId: message?.profileId ? String(message.profileId) : '',
      playerName: message?.playerName ? String(message.playerName) : '',
      gameId: message?.gameId ? String(message.gameId) : '',
      reason: message?.reason ? String(message.reason) : ''
    }))
    .filter((message) => message.to && message.body)
    .slice(0, 200);
}

async function sendTwilioTextMessage(config, message) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    To: message.to,
    From: config.from,
    Body: message.body
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.message || `Twilio returned ${response.status}.`);
  }
  return result;
}

async function sendTextMessages(payload) {
  const config = getTwilioConfig();
  if (!config.ok) return { ok: false, sent: 0, error: config.error };

  const messages = normalizeTextMessageBatch(payload);
  if (!messages.length) return { ok: true, sent: 0, skipped: 0 };

  const results = await Promise.allSettled(messages.map((message) => sendTwilioTextMessage(config, message)));
  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const firstFailure = results.find((result) => result.status === 'rejected');
  const error = firstFailure?.status === 'rejected'
    ? firstFailure.reason?.message || 'One or more Twilio messages failed.'
    : undefined;

  sendClientEvent('player-outreach-texts', 'outreach', {
    sent,
    requested: messages.length,
    reason: messages[0]?.reason || '',
    gameId: messages[0]?.gameId || '',
    failed: messages.length - sent
  });

  return {
    ok: sent > 0 && sent === messages.length,
    sent,
    skipped: messages.length - sent,
    error
  };
}

function getLegacyDataPath() {
  return path.join(app.getPath('userData'), 'tablemanager-db.json');
}

function getDataPath() {
  return path.join(app.getPath('userData'), 'tablemanager.sqlite3');
}

function getDeviceIdPath() {
  return path.join(app.getPath('userData'), 'orbit-device.json');
}

function getOrCreateDeviceId() {
  if (cachedDeviceId) return cachedDeviceId;
  const filePath = getDeviceIdPath();
  try {
    if (fs.existsSync(filePath)) {
      const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (record?.deviceId) {
        cachedDeviceId = String(record.deviceId);
        return cachedDeviceId;
      }
    }
  } catch {
    // Device telemetry must never block desktop startup.
  }

  cachedDeviceId = crypto.randomUUID();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ deviceId: cachedDeviceId, createdAt: new Date().toISOString() }, null, 2));
  } catch {
    // If persistence fails, the current process can still report with the generated id.
  }
  return cachedDeviceId;
}

function sanitizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function getAccountKeyFromAccess(access) {
  if (!isRecord(access)) return '';
  return sanitizeAccountKey(access.licenseId || access.authorizationCode || access.issuedTo);
}

function getAccountKeyFromState(state) {
  const pilotKey = getAccountKeyFromAccess(state?.settings?.pilotAccess);
  if (pilotKey) return pilotKey;
  const club = state?.settings?.clubAccount;
  return sanitizeAccountKey(club?.email || club?.clubName || 'unlicensed-local') || 'unlicensed-local';
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

function getClientAuthKeyFromAccess(access) {
  if (!isRecord(access)) return '';
  return String(access.authorizationCode || '').trim();
}

function getClientAuthKeyFromState(state) {
  return getClientAuthKeyFromAccess(state?.settings?.pilotAccess);
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
  const apiUrl = (process.env.ORBIT_API_URL || 'https://orbitapp-one.vercel.app').replace(/\/+$/, '');
  const apiKey = process.env.ORBIT_CLIENT_API_KEY || getLocalClientAuthKey();
  return { apiUrl, apiKey };
}

async function postClientTelemetry(pathname, payload) {
  const { apiUrl, apiKey } = getApiConfig();
  if (!apiKey || typeof fetch !== 'function') {
    if (!warnedAboutMissingApiKey) {
      warnedAboutMissingApiKey = true;
      writeOrbitApiLog('warn', 'request-skipped', { pathname, reason: !apiKey ? 'missing-api-key' : 'fetch-unavailable' });
    }
    return;
  }
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${apiUrl}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orbit-api-key': apiKey,
        'x-orbit-request-id': requestId
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      const { payload: responsePayload, responsePreview } = await readApiResponse(response);
      writeOrbitApiLog('warn', 'telemetry-http-error', {
        requestId, method: 'POST', pathname, status: response.status, durationMs: Date.now() - started,
        error: responsePayload?.error || '', responsePreview
      });
    }
  } catch (error) {
    writeOrbitApiLog('warn', 'telemetry-network-error', {
      requestId, method: 'POST', pathname, durationMs: Date.now() - started,
      timedOut: controller.signal.aborted, ...orbitApiErrorDetails(error)
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOrbitApi(pathname, options = {}) {
  const { apiUrl, apiKey } = getApiConfig();
  const authKey = options.authKey || apiKey;
  if (!authKey || typeof fetch !== 'function') {
    writeOrbitApiLog('warn', 'request-skipped', { pathname, reason: !authKey ? 'missing-api-key' : 'fetch-unavailable' });
    return null;
  }
  const requestId = crypto.randomUUID();
  const method = options.method || 'GET';
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3500);
  try {
    const response = await fetch(`${apiUrl}${pathname}`, {
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
      writeOrbitApiLog('warn', 'http-error', {
        requestId, method, pathname, status: response.status, durationMs: Date.now() - started,
        error: payload?.error || '', responsePreview
      });
      return null;
    }
    writeOrbitApiLog('info', 'request-succeeded', { requestId, method, pathname, status: response.status, durationMs: Date.now() - started });
    return payload;
  } catch (error) {
    writeOrbitApiLog('error', 'network-error', {
      requestId, method, pathname, durationMs: Date.now() - started,
      timedOut: controller.signal.aborted, ...orbitApiErrorDetails(error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getRemoteBackendStatus() {
  const { apiUrl, apiKey } = getApiConfig();
  if (typeof fetch !== 'function') return null;
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${apiUrl}/health`, {
      headers: { 'x-orbit-request-id': requestId, ...(apiKey ? { 'x-orbit-api-key': apiKey } : {}) },
      signal: controller.signal
    });
    const { payload, responsePreview } = await readApiResponse(response);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Orbit API returned ${response.status}`);
    const parsed = new URL(apiUrl);
    writeOrbitApiLog('info', 'health-succeeded', {
      requestId, pathname: '/health', status: response.status, durationMs: Date.now() - started,
      service: payload.service || '', environment: payload.environment || ''
    });
    return {
      running: true,
      host: parsed.hostname,
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      reportCount: 0,
      mode: 'api',
      service: payload.service,
      environment: payload.environment,
      startedAt: payload.startedAt,
      latencyMs: Date.now() - started
    };
  } catch (error) {
    writeOrbitApiLog('error', 'health-failed', {
      requestId, pathname: '/health', durationMs: Date.now() - started,
      timedOut: controller.signal.aborted, ...orbitApiErrorDetails(error)
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadStateFromApi(accountKey, access) {
  const resolvedAccountKey = sanitizeAccountKey(accountKey || getLocalAccountKey());
  const pathname = resolvedAccountKey ? `/state/${encodeURIComponent(resolvedAccountKey)}` : '/state/latest';
  const payload = await requestOrbitApi(pathname, { authKey: getClientAuthKeyFromAccess(access) || undefined });
  if (!payload?.state) return null;
  return {
    schemaVersion: payload.schemaVersion || 1,
    savedAt: payload.savedAt || new Date().toISOString(),
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
    deviceName: os.hostname(),
    appVersion: app.getVersion(),
    platform: process.platform,
    environment: process.env.NODE_ENV || (isDev ? 'development' : 'production'),
    updateStatus: lastUpdateStatus,
    updateEvent: lastUpdateEvent,
    lastSeenAt: new Date().toISOString(),
    ...overrides
  };
}

function sendClientHeartbeat(overrides = {}) {
  postClientTelemetry('/clients/heartbeat', buildClientTelemetryPayload(overrides));
}

function sendClientEvent(event, category = 'usage', details = {}, overrides = {}) {
  postClientTelemetry('/clients/event', buildClientTelemetryPayload({
    event,
    category,
    details,
    occurredAt: new Date().toISOString(),
    ...overrides
  }));
}

function sendClientError(error, source = 'main', details = {}) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  const stack = details.rendererStack || (error instanceof Error ? error.stack || '' : '');
  postClientTelemetry('/clients/error', buildClientTelemetryPayload({
    message,
    stack,
    source,
    route: details.route || '',
    details,
    occurredAt: new Date().toISOString(),
    lastError: message
  }));
}

function sendClientUpdateEvent(updateEvent, updateStatus, details = {}) {
  lastUpdateEvent = updateEvent;
  lastUpdateStatus = updateStatus;
  postClientTelemetry('/clients/update-event', buildClientTelemetryPayload({
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
    startedAt: appStartedAt,
    locale: app.getLocale()
  });
  clientHeartbeatTimer = setInterval(() => sendClientHeartbeat(), 5 * 60 * 1000);
}

function getDatabase() {
  if (database) return database;
  const filePath = getDataPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      schema_version INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      state_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_state (
      account_key TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      state_json TEXT NOT NULL,
      is_last_opened INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      birthday TEXT,
      membership_start_date TEXT,
      membership_expiration_date TEXT,
      total_time_played_hours REAL NOT NULL DEFAULT 0,
      last_session_time_played_hours REAL NOT NULL DEFAULT 0,
      preferred_game_id TEXT,
      preferred_stakes TEXT,
      notes TEXT,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile_companions (
      profile_id TEXT NOT NULL,
      companion_profile_id TEXT NOT NULL,
      PRIMARY KEY (profile_id, companion_profile_id),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (companion_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account_profiles (
      account_key TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      birthday TEXT,
      membership_start_date TEXT,
      membership_expiration_date TEXT,
      total_time_played_hours REAL NOT NULL DEFAULT 0,
      last_session_time_played_hours REAL NOT NULL DEFAULT 0,
      preferred_game_id TEXT,
      preferred_stakes TEXT,
      notes TEXT,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_key, id),
      FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account_profile_companions (
      account_key TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      companion_profile_id TEXT NOT NULL,
      PRIMARY KEY (account_key, profile_id, companion_profile_id),
      FOREIGN KEY (account_key, profile_id) REFERENCES account_profiles(account_key, id) ON DELETE CASCADE,
      FOREIGN KEY (account_key, companion_profile_id) REFERENCES account_profiles(account_key, id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS analytical_reports (
      id TEXT PRIMARY KEY,
      account_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      report_json TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'stored',
      delivered_at TEXT,
      delivery_error TEXT
    );
  `);
  return database;
}

function readLegacyLocalDatabase() {
  const filePath = getLegacyDataPath();
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readLocalDatabase(accountKey) {
  const db = getDatabase();
  const normalizedAccountKey = sanitizeAccountKey(accountKey);
  const row = normalizedAccountKey
    ? db.prepare('SELECT schema_version, saved_at, state_json FROM account_state WHERE account_key = ?').get(normalizedAccountKey)
    : db.prepare('SELECT schema_version, saved_at, state_json FROM account_state WHERE is_last_opened = 1 ORDER BY saved_at DESC LIMIT 1').get();
  if (row) {
    return {
      schemaVersion: row.schema_version,
      savedAt: row.saved_at,
      state: JSON.parse(row.state_json)
    };
  }

  if (normalizedAccountKey) return null;

  const legacySqliteRow = db.prepare('SELECT schema_version, saved_at, state_json FROM app_state WHERE id = 1').get();
  if (legacySqliteRow) {
    const state = JSON.parse(legacySqliteRow.state_json);
    writeLocalDatabase(state);
    return {
      schemaVersion: legacySqliteRow.schema_version,
      savedAt: legacySqliteRow.saved_at,
      state
    };
  }

  const legacyRecord = readLegacyLocalDatabase();
  if (legacyRecord?.state) {
    writeLocalDatabase(legacyRecord.state);
    return legacyRecord;
  }

  return null;
}

function writeLocalDatabase(state) {
  validateStatePayload(state);
  const db = getDatabase();
  const savedAt = new Date().toISOString();
  const stateJson = JSON.stringify(state);
  const accountKey = getAccountKeyFromState(state);
  const clearLastOpened = db.prepare('UPDATE account_state SET is_last_opened = 0');
  const saveState = db.prepare(`
    INSERT INTO account_state (account_key, schema_version, saved_at, state_json, is_last_opened)
    VALUES (?, 3, ?, ?, 1)
    ON CONFLICT(account_key) DO UPDATE SET
      schema_version = excluded.schema_version,
      saved_at = excluded.saved_at,
      state_json = excluded.state_json,
      is_last_opened = 1
  `);
  const upsertProfile = db.prepare(`
    INSERT INTO account_profiles (
      account_key,
      id,
      name,
      birthday,
      membership_start_date,
      membership_expiration_date,
      total_time_played_hours,
      last_session_time_played_hours,
      preferred_game_id,
      preferred_stakes,
      notes,
      raw_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_key, id) DO UPDATE SET
      name = excluded.name,
      birthday = excluded.birthday,
      membership_start_date = excluded.membership_start_date,
      membership_expiration_date = excluded.membership_expiration_date,
      total_time_played_hours = excluded.total_time_played_hours,
      last_session_time_played_hours = excluded.last_session_time_played_hours,
      preferred_game_id = excluded.preferred_game_id,
      preferred_stakes = excluded.preferred_stakes,
      notes = excluded.notes,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `);
  const deleteProfiles = db.prepare('DELETE FROM account_profiles WHERE account_key = ?');
  const insertCompanion = db.prepare('INSERT OR IGNORE INTO account_profile_companions (account_key, profile_id, companion_profile_id) VALUES (?, ?, ?)');
  const validProfileIds = new Set((state.profiles ?? []).map((profile) => profile.id));
  db.exec('BEGIN IMMEDIATE');
  try {
    clearLastOpened.run();
    saveState.run(accountKey, savedAt, stateJson);
    deleteProfiles.run(accountKey);
    for (const profile of state.profiles ?? []) {
      upsertProfile.run(
        accountKey,
        profile.id,
        profile.name,
        profile.birthday ?? '',
        profile.membershipStartDate ?? '',
        profile.membershipExpirationDate ?? '',
        Number(profile.totalTimePlayedHours ?? 0),
        Number(profile.lastSessionTimePlayedHours ?? 0),
        profile.preferredGameId ?? profile.preferredGameIds?.[0] ?? '',
        profile.preferredStakes ?? '',
        profile.notes ?? '',
        JSON.stringify(profile),
        savedAt
      );
    }
    for (const profile of state.profiles ?? []) {
      for (const companionId of profile.commonlyPlaysWithProfileIds ?? []) {
        if (validProfileIds.has(companionId)) {
          insertCompanion.run(accountKey, profile.id, companionId);
        }
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ok: true, path: getDataPath(), engine: 'sqlite', accountKey };
}

function getReportCount() {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM analytical_reports').get();
  return Number(row?.count ?? 0);
}

function validateReportPayload(report) {
  if (!isRecord(report)) throw new Error('Report payload must be an object.');
  if (!isRecord(report.account)) throw new Error('Report payload is missing account details.');
  if (!isRecord(report.operational)) throw new Error('Report payload is missing operational metrics.');
  if (!isRecord(report.usage)) throw new Error('Report payload is missing usage metrics.');
}

async function forwardReportIfConfigured(report) {
  const endpoint = process.env.TABLEMANAGER_REPORT_ENDPOINT;
  const emailTo = process.env.TABLEMANAGER_REPORT_EMAIL_TO;
  const deliveryResults = [];

  if (endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report)
    });

    if (!response.ok) {
      throw new Error(`Report endpoint returned ${response.status}`);
    }
    deliveryResults.push('endpoint');
  }

  if (emailTo) {
    await sendReportEmail(report, emailTo);
    deliveryResults.push('email');
  }

  if (!deliveryResults.length) return { status: 'stored' };
  return { status: 'delivered', deliveredAt: new Date().toISOString(), channels: deliveryResults };
}

function getSmtpTransport() {
  const host = process.env.TABLEMANAGER_SMTP_HOST;
  const user = process.env.TABLEMANAGER_SMTP_USER;
  const pass = process.env.TABLEMANAGER_SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('Email delivery requires TABLEMANAGER_SMTP_HOST, TABLEMANAGER_SMTP_USER, and TABLEMANAGER_SMTP_PASS.');
  }

  const port = Number(process.env.TABLEMANAGER_SMTP_PORT || 587);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

function buildReportEmailText(report) {
  const operational = report.operational ?? {};
  const usage = report.usage ?? {};
  const features = Array.isArray(usage.features) ? usage.features.slice(0, 8) : [];
  const actions = Array.isArray(usage.actions) ? usage.actions.slice(0, 8) : [];
  return [
    `Orbit report for ${report.account?.clubName || report.account?.accountName || 'Unknown club'}`,
    `Generated: ${report.generatedAt}`,
    '',
    `Occupied seat-hours: ${operational.occupiedSeatHours ?? 0}`,
    `Estimated time-fee revenue: $${operational.estimatedTimeFeeRevenue ?? 0}`,
    `Recorded table drop: $${operational.recordedDropTotal ?? 0}`,
    `Estimated drop revenue: $${operational.estimatedDropRevenue ?? 0}`,
    `Average wait: ${operational.averageWaitMinutes ?? 0}m`,
    `Waitlist conversion: ${operational.waitlistConversionRate ?? 0}%`,
    `Games started: ${operational.gamesStarted ?? 0}`,
    `Failed starts: ${operational.failedStarts ?? 0}`,
    `Table breaks: ${operational.tableBreaks ?? 0}`,
    '',
    'Feature usage:',
    ...features.map((entry) => `- ${entry.feature}: ${entry.count}`),
    '',
    'Action usage:',
    ...actions.map((entry) => `- ${entry.action} (${entry.feature}): ${entry.count}`),
    '',
    'Full JSON report is attached.'
  ].join('\n');
}

async function sendReportEmail(report, emailTo) {
  const transport = getSmtpTransport();
  const clubName = report.account?.clubName || report.account?.accountName || 'Orbit';
  const generatedDate = String(report.generatedAt || new Date().toISOString()).slice(0, 10);
  await transport.sendMail({
    from: process.env.TABLEMANAGER_SMTP_FROM || process.env.TABLEMANAGER_SMTP_USER,
    to: emailTo,
    subject: `Orbit report - ${clubName} - ${generatedDate}`,
    text: buildReportEmailText(report),
    attachments: [
      {
        filename: `tablemanager-report-${generatedDate}.json`,
        content: JSON.stringify(report, null, 2),
        contentType: 'application/json'
      }
    ]
  });
}

async function storeAnalyticalReport(report) {
  validateReportPayload(report);
  const db = getDatabase();
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const accountKey = sanitizeAccountKey(report.account.accountKey || report.account.license || report.account.email || report.account.clubName || 'unlicensed-local') || 'unlicensed-local';
  let delivery = { status: 'stored' };
  let deliveryError = '';

  try {
    delivery = await forwardReportIfConfigured(report);
  } catch (error) {
    delivery = { status: 'queued' };
    deliveryError = error instanceof Error ? error.message : 'Unable to deliver report.';
  }

  db.prepare(`
    INSERT INTO analytical_reports (
      id,
      account_key,
      created_at,
      report_json,
      delivery_status,
      delivered_at,
      delivery_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    accountKey,
    createdAt,
    JSON.stringify(report),
    delivery.status,
    delivery.deliveredAt ?? null,
    deliveryError
  );

  embeddedBackendStatus = { ...embeddedBackendStatus, reportCount: getReportCount() };
  return { ok: true, id, accountKey, createdAt, deliveryStatus: delivery.status, backend: embeddedBackendStatus };
}

const activeWaitlistStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const visibleTableStatuses = new Set(['Running', 'Forming', 'Paused']);

function getPlayerLoyalty(clubId, lifetimeHours = 0) {
  const hours = Math.max(0, Number(lifetimeHours) || 0);
  if (hours >= 120) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Anchor', nextTierAtHours: null };
  if (hours >= 50) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Preferred', nextTierAtHours: 120 };
  if (hours >= 12) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Regular', nextTierAtHours: 50 };
  return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'New', nextTierAtHours: 12 };
}

function isFutureDate(value) {
  return Boolean(value && new Date(`${String(value).slice(0, 10)}T23:59:59`).getTime() >= Date.now());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function mergeUnique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function appendSyncNote(existing, note) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}

function getInterestTime(interest) {
  return interest.interestedAt || interest.timestamp || '';
}

function getWaitlistEntriesForGame(interests, clubId, gameId) {
  return (interests || [])
    .filter((interest) => interest.gameId === gameId && activeWaitlistStatuses.has(interest.status))
    .sort((left, right) => getInterestTime(left).localeCompare(getInterestTime(right)))
    .map((interest, index) => ({
      id: interest.id,
      clubId,
      gameId,
      playerId: interest.profileId,
      playerName: interest.playerName,
      status: interest.status,
      position: index + 1,
      requestedAt: getInterestTime(interest)
    }));
}

function buildPlayerClubSnapshot(state, player) {
  const clubId = getAccountKeyFromState(state);
  const account = state.settings?.clubAccount || {};
  const activePlayerSessions = (state.playerSessions || []).filter((session) => !session.leftAt);
  const activeAdminCount = (state.settings?.staffAccounts || []).filter((staff) => staff.active !== false).length;
  const playerName = String(player?.name || '').trim().toLowerCase();
  const requestingProfile = (state.profiles || []).find(
    (profile) => profile.id === player?.id || String(profile.name || '').trim().toLowerCase() === playerName
  );
  const knownProfileIds = new Set(requestingProfile?.commonlyPlaysWithProfileIds || []);
  const knownPlayerNames = new Set((requestingProfile?.usualCompanions || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean));
  const isKnownPlayerSession = (session) =>
    Boolean((session.profileId && knownProfileIds.has(session.profileId)) || knownPlayerNames.has(String(session.playerName || '').trim().toLowerCase()));
  const tables = (state.sessions || [])
    .filter((session) => visibleTableStatuses.has(session.status))
    .map((session) => {
      const seatedSessions = activePlayerSessions.filter((playerSession) => playerSession.tableId === session.id);
      return {
        id: session.id,
        gameId: session.gameId,
        label: session.label,
        status: session.status,
        seatsFilled: Math.min(session.seatsFilled, session.maxSeats),
        maxSeats: session.maxSeats,
        availableSeats: Math.max(0, session.maxSeats - session.seatsFilled),
        collectionMode: session.collectionMode || (session.timeFeeBased ? 'Time' : 'Drop'),
        tags: session.tags || [],
        startedAt: session.startedAt,
        social: {
          seatedPlayerCount: seatedSessions.length || Math.min(session.seatsFilled, session.maxSeats),
          adminCount: activeAdminCount,
          knownPlayersCount: seatedSessions.filter(isKnownPlayerSession).length
        }
      };
    });
  const waitlists = (state.games || []).flatMap((game) => getWaitlistEntriesForGame(state.interests || [], clubId, game.id));
  const notifications = (state.inAppNotifications || []).filter((notification) => {
    if (!player?.id && !player?.name) return true;
    const playerId = String(player?.id || '').trim().toLowerCase();
    const targetIds = (notification.targetPlayerIds || []).map((target) => String(target).trim().toLowerCase());
    const targetNames = (notification.targetPlayerNames || []).map((target) => String(target).trim().toLowerCase());
    return Boolean(playerId && targetIds.includes(playerId)) || Boolean(playerName && targetNames.includes(playerName));
  });
  const memberships = (state.profiles || [])
    .filter((profile) => {
      if (!player?.id && !player?.name) return true;
      return profile.id === player.id || String(profile.name || '').toLowerCase() === String(player.name || '').toLowerCase();
    })
    .map((profile) => ({
      id: `${clubId}:${profile.id}`,
      clubId,
      playerId: profile.id,
      playerName: profile.name,
      status: isFutureDate(profile.membershipExpirationDate) ? 'Active' : 'Expired',
      joinedAt: profile.membershipStartDate || new Date().toISOString().slice(0, 10),
      expiresAt: profile.membershipExpirationDate,
      loyalty: getPlayerLoyalty(clubId, profile.totalTimePlayedHours || 0),
      preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : profile.preferredGameId ? [profile.preferredGameId] : [],
      preferredStakes: profile.preferredStakes,
      clubNote: profile.typicalAvailability
    }));

  return {
    club: {
      id: clubId,
      name: account.clubName || 'Local Poker Club',
      address: account.address,
      phone: account.phone
    },
    games: (state.games || []).map((game) => {
      const openTables = tables.filter((table) => table.gameId === game.id);
      const gameWaitlist = waitlists.filter((entry) => entry.gameId === game.id);
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: openTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: openTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    notifications,
    social: {
      activePlayerCount: activePlayerSessions.length || tables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.length
    },
    generatedAt: new Date().toISOString()
  };
}

function applyMembershipRequestToState(state, request) {
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const existingProfile = (state.profiles || []).find(
    (profile) => profile.id === player.id || String(profile.name || '').toLowerCase() === String(player.name || '').toLowerCase()
  );
  const membershipStartDate = String(request.requestedAt || new Date().toISOString()).slice(0, 10);
  const membershipExpirationDate = addDays(membershipStartDate, 365);

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              membershipStartDate: profile.membershipStartDate || membershipStartDate,
              membershipExpirationDate: profile.membershipExpirationDate || membershipExpirationDate,
              preferredGameId: player.preferredGameIds?.[0] || profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...(player.preferredGameIds || [])]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability,
              phone: player.phone || profile.phone,
              notes: appendSyncNote(profile.notes, `Player app: ${player.email || player.id}`)
            }
          : profile
      )
    };
  }

  return {
    ...state,
    profiles: [
      ...(state.profiles || []),
      {
        id: player.id || crypto.randomUUID(),
        name: player.name || 'Player',
        phone: player.phone || '',
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: player.preferredGameIds?.[0] || state.games?.[0]?.id || '',
        preferredGameIds: player.preferredGameIds || [],
        preferredStakes: player.preferredStakes || '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability || '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Player app: ${player.email || ''}${player.phone ? `, ${player.phone}` : ''}`.trim()
      }
    ]
  };
}

function applyWaitlistRequestToState(state, request) {
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const requestedTable = request.tableId
    ? (state.sessions || []).find((session) => session.id === request.tableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
    : undefined;
  const requestedTableHasSeat = Boolean(requestedTable && requestedTable.seatsFilled < requestedTable.maxSeats);
  const profile = (state.profiles || []).find(
    (candidate) => candidate.id === player.id || String(candidate.name || '').toLowerCase() === String(player.name || '').toLowerCase()
  );
  const alreadyWaiting = (state.interests || []).some(
    (interest) =>
      interest.gameId === request.gameId &&
      activeWaitlistStatuses.has(interest.status) &&
      (interest.profileId === profile?.id || String(interest.playerName || '').toLowerCase() === String(player.name || '').toLowerCase())
  );
  if (alreadyWaiting) return state;
  return {
    ...state,
    interests: [
      ...(state.interests || []),
      {
        id: request.id || crypto.randomUUID(),
        profileId: profile?.id || player.id,
        playerName: player.name || 'Player',
        gameId: request.gameId,
        status: requestedTableHasSeat ? 'Arrived' : 'Interested',
        timestamp: request.requestedAt || new Date().toISOString(),
        interestedAt: request.requestedAt || new Date().toISOString(),
        arrivedAt: requestedTableHasSeat ? request.requestedAt || new Date().toISOString() : undefined,
        notes: [
          requestedTableHasSeat ? `Seat requested from player app for ${requestedTable?.label || 'open table'}` : 'Waitlist requested from player app',
          request.note
        ].filter(Boolean).join(' | ')
      }
    ]
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function syncStateWithFirebaseRequests(state) {
  if (!isFirebaseConfigured()) return state;
  const accountKey = getAccountKeyFromState(state);
  let pending;
  try {
    pending = await fetchPendingPlayerRequests(accountKey);
  } catch {
    return state;
  }
  let nextState = state;

  for (const request of pending.membershipRequests) {
    nextState = applyMembershipRequestToState(nextState, request);
    await markPlayerRequestApplied(accountKey, 'membership', request.id);
  }

  for (const request of pending.waitlistRequests) {
    nextState = applyWaitlistRequestToState(nextState, request);
    await markPlayerRequestApplied(accountKey, 'waitlist', request.id);
  }

  return nextState;
}

async function loadStateWithFirebaseFallback(accountKey) {
  const localRecord = readLocalDatabase(accountKey);
  let record = localRecord;
  if (!record?.state && isFirebaseConfigured()) {
    try {
      record = await readStateFromFirebase(sanitizeAccountKey(accountKey));
    } catch {
      record = localRecord;
    }
  }
  if (!record?.state) return record;
  const syncedState = await syncStateWithFirebaseRequests(record.state);
  if (syncedState === record.state) return record;
  await saveStateEverywhere(syncedState);
  return {
    schemaVersion: record.schemaVersion || 4,
    savedAt: new Date().toISOString(),
    state: syncedState
  };
}

async function saveStateEverywhere(state) {
  const localResult = writeLocalDatabase(state);
  if (!isFirebaseConfigured()) return localResult;
  const accountKey = getAccountKeyFromState(state);
  const publicSnapshot = buildPlayerClubSnapshot(state);
  try {
    writeStateToFirebase(accountKey, state, publicSnapshot).catch(() => undefined);
  } catch {
    // Cloud sync must never block local persistence.
  }
  return {
    ...localResult,
    firebase: { ok: true, engine: 'firebase', accountKey, pending: true }
  };
}

async function loadStateApiFirst(accountKey, access) {
  return (await loadStateFromApi(accountKey, access)) || loadStateWithFirebaseFallback(accountKey);
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

function startEmbeddedBackend() {
  if (embeddedBackend) return;

  embeddedBackend = http.createServer(async (request, response) => {
    try {
      const remoteAddress = request.socket.remoteAddress;
      const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
      const allowLanPlayerSync = process.env.TABLEMANAGER_PLAYER_SYNC_ALLOW_LAN === 'true';
      if (!isLoopback && !allowLanPlayerSync) {
        sendJson(response, 403, { ok: false, error: 'Embedded backend only accepts loopback requests.' });
        return;
      }

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }

      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, { ok: true, ...embeddedBackendStatus, reportCount: getReportCount() });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/player/snapshot') {
        const accountKey = sanitizeAccountKey(requestUrl.searchParams.get('accountKey') || '');
        const record = await loadStateWithFirebaseFallback(accountKey);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No Orbit club database is available yet.' });
          return;
        }
        const syncedState = await syncStateWithFirebaseRequests(record.state);
        if (syncedState !== record.state) {
          await saveStateEverywhere(syncedState);
        }
        const player = {
          id: requestUrl.searchParams.get('playerId') || '',
          name: requestUrl.searchParams.get('playerName') || ''
        };
        sendJson(response, 200, {
          ok: true,
          accountKey: getAccountKeyFromState(syncedState),
          savedAt: record.savedAt,
          snapshot: buildPlayerClubSnapshot(syncedState, player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/player/membership-requests') {
        const requestPayload = JSON.parse(await readRequestBody(request));
        const record = await loadStateWithFirebaseFallback(requestPayload.clubId);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No matching club database was found for this membership request.' });
          return;
        }
        const nextState = applyMembershipRequestToState(record.state, requestPayload);
        await saveStateEverywhere(nextState);
        sendJson(response, 201, {
          ok: true,
          accountKey: getAccountKeyFromState(nextState),
          snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/player/waitlist-requests') {
        const requestPayload = JSON.parse(await readRequestBody(request));
        const record = await loadStateWithFirebaseFallback(requestPayload.clubId);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No matching club database was found for this waitlist request.' });
          return;
        }
        const nextState = applyWaitlistRequestToState(record.state, requestPayload);
        await saveStateEverywhere(nextState);
        sendJson(response, 201, {
          ok: true,
          accountKey: getAccountKeyFromState(nextState),
          snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/analytical-reports') {
        const body = await readRequestBody(request);
        const result = await storeAnalyticalReport(JSON.parse(body));
        sendJson(response, 201, result);
        return;
      }

      sendJson(response, 404, { ok: false, error: 'Not found.' });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
    }
  });

  const configuredPort = Number(process.env.TABLEMANAGER_SYNC_PORT || process.env.TABLEMANAGER_BACKEND_PORT || 4629);
  const configuredHost = process.env.TABLEMANAGER_SYNC_HOST || '127.0.0.1';

  embeddedBackend.listen(configuredPort, configuredHost, () => {
    const address = embeddedBackend.address();
    embeddedBackendStatus = {
      running: true,
      host: configuredHost,
      port: typeof address === 'object' && address ? address.port : 0,
      reportCount: getReportCount()
    };
  });

  embeddedBackend.on('close', () => {
    embeddedBackendStatus = { ...embeddedBackendStatus, running: false, port: 0 };
  });
}

function broadcastUpdateStatus(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('update-status', status);
    }
  }
}

function startAutoUpdates() {
  if (isDev || !app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendClientUpdateEvent('checking-for-update', 'checking');
    broadcastUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendClientUpdateEvent('update-available', 'available', { version: info.version });
    broadcastUpdateStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendClientUpdateEvent('update-not-available', 'current', { version: info.version });
    broadcastUpdateStatus({ state: 'current', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    const progressBucket = Math.floor(Math.round(progress.percent ?? 0) / 25);
    if (progressBucket !== lastUpdateProgressBucket) {
      lastUpdateProgressBucket = progressBucket;
      sendClientEvent('update-download-progress', 'update', { percent: Math.round(progress.percent ?? 0) });
    }
    broadcastUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent ?? 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    lastUpdateProgressBucket = -1;
    sendClientUpdateEvent('update-downloaded', 'downloaded', { version: info.version });
    broadcastUpdateStatus({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('before-quit-for-update', () => {
    sendClientEvent('update-installing', 'update', { updateStatus: lastUpdateStatus, updateEvent: lastUpdateEvent });
  });
  autoUpdater.on('error', (error) => {
    lastUpdateProgressBucket = -1;
    const message = error instanceof Error ? error.message : 'Update check failed.';
    sendClientUpdateEvent('update-error', 'error', { message });
    broadcastUpdateStatus({ state: 'error', message });
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      const message = error instanceof Error ? error.message : 'Update check failed.';
      sendClientUpdateEvent('update-error', 'error', { message });
      broadcastUpdateStatus({ state: 'error', message });
    });
  };

  checkForUpdates();
  updateCheckTimer = setInterval(checkForUpdates, updateCheckIntervalMs);
}

ipcMain.handle('open-route-window', (_event, route, context = {}) => {
  const normalizedRoute = route === 'outreach' ? 'signals' : validRoutes.has(route) ? route : 'floor';
  createWindow(normalizedRoute, context);
});

ipcMain.handle('load-state', async () => loadStateApiFirst());

ipcMain.handle('load-state-for-account', async (_event, access) => loadStateApiFirst(getAccountKeyFromAccess(access), access));

ipcMain.handle('save-state', async (_event, state) => saveStateApiFirst(state));

ipcMain.handle('get-backend-status', async () =>
  (await getRemoteBackendStatus()) || { ...embeddedBackendStatus, reportCount: getReportCount(), mode: embeddedBackendStatus.running ? 'legacy-embedded' : 'local-fallback' }
);

ipcMain.handle('submit-analytical-report', (_event, report) => submitAnalyticalReportApiFirst(report));

ipcMain.handle('send-text-messages', (_event, payload) => sendTextMessages(payload));

ipcMain.handle('record-client-event', (_event, event, category, details, route) => {
  sendClientEvent(event, category, details, { route });
  return { ok: true };
});

ipcMain.handle('record-client-error', (_event, payload = {}) => {
  sendClientError(new Error(payload.message || 'Renderer error'), payload.source || 'renderer', {
    route: payload.route || '',
    filename: payload.filename || '',
    line: payload.line || 0,
    column: payload.column || 0,
    details: payload.details || null,
    rendererStack: payload.stack || ''
  });
  return { ok: true };
});

function loadRoute(window, route, context = {}) {
  const hash = route === 'table' && context.sessionId
    ? `/${route}?sessionId=${encodeURIComponent(context.sessionId)}`
    : `/${route}`;
  if (isDev) {
    window.loadURL(`http://127.0.0.1:5173/#${hash}`);
    return;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    hash
  });
}

function createWindow(route = 'floor', context = {}) {
  const windowKey = route === 'table' && context.sessionId ? `table:${context.sessionId}` : route;
  const existing = windows.get(windowKey);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const routeConfig = {
    floor: { width: 1280, height: 860, minWidth: 1040, minHeight: 720, title: branding.desktop.windowTitles.floor },
    table: { width: 1440, height: 940, minWidth: 1180, minHeight: 760, title: 'Table View' },
    builder: { width: 920, height: 760, minWidth: 760, minHeight: 620, title: branding.desktop.windowTitles.builder },
    profiles: { width: 940, height: 760, minWidth: 760, minHeight: 620, title: branding.desktop.windowTitles.profiles },
    signals: { width: 980, height: 780, minWidth: 780, minHeight: 640, title: branding.desktop.windowTitles.signals },
    summary: { width: 1040, height: 820, minWidth: 820, minHeight: 640, title: branding.desktop.windowTitles.summary },
    customization: { width: 920, height: 700, minWidth: 760, minHeight: 600, title: branding.desktop.windowTitles.customization ?? 'Customization' },
    kpis: { width: 860, height: 620, minWidth: 720, minHeight: 520, title: branding.desktop.windowTitles.kpis ?? 'KPIs' },
    tournaments: { width: 1180, height: 820, minWidth: 940, minHeight: 680, title: 'Tournament Manager' },
    'tournament-tv': { width: 1280, height: 720, minWidth: 960, minHeight: 540, title: 'Tournament TV' },
    pilot: { width: 980, height: 760, minWidth: 780, minHeight: 620, title: branding.desktop.windowTitles.pilot }
  }[route] ?? { width: 900, height: 700, minWidth: 700, minHeight: 560, title: branding.product.name };

  const mainWindow = new BrowserWindow({
    ...routeConfig,
    backgroundColor: branding.desktop.backgroundColor,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (route === 'table') mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl && !url.startsWith('file://') && !url.startsWith('http://127.0.0.1:5173/')) {
      event.preventDefault();
      openTrustedExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    sendClientError(new Error(`Renderer process gone: ${details.reason}`), 'renderer-process', {
      route,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  mainWindow.webContents.on('unresponsive', () => {
    sendClientError(new Error('Renderer window became unresponsive'), 'renderer-process', { route });
  });

  mainWindow.on('closed', () => {
    windows.delete(windowKey);
  });

  windows.set(windowKey, mainWindow);
  loadRoute(mainWindow, route, context);

  if (isDev && route === 'floor') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

app.whenReady().then(() => {
  appStartedAt = new Date().toISOString();
  if (process.env.ORBIT_ENABLE_EMBEDDED_BACKEND === 'true') {
    startEmbeddedBackend();
  }
  startClientTelemetry();
  startAutoUpdates();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ])
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  sendClientEvent('app-closed', 'lifecycle', {
    startedAt: appStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    openWindowCount: BrowserWindow.getAllWindows().length
  });
  if (clientHeartbeatTimer) {
    clearInterval(clientHeartbeatTimer);
    clientHeartbeatTimer = undefined;
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = undefined;
  }
  if (embeddedBackend) {
    embeddedBackend.close();
    embeddedBackend = undefined;
  }
  if (database) {
    database.close();
    database = undefined;
  }
});

process.on('uncaughtException', (error) => {
  sendClientError(error, 'main-uncaught-exception');
});

process.on('unhandledRejection', (reason) => {
  sendClientError(reason instanceof Error ? reason : new Error(String(reason)), 'main-unhandled-rejection');
});

