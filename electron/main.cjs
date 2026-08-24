const { app, autoUpdater: nativeAutoUpdater, BrowserWindow, Menu, ipcMain, safeStorage, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const branding = require('../branding.config.json');
const { redactDetails } = require('../apps/api/src/http/dataProtection');
const { createOrbitCore } = require('../apps/api/src/shared/orbitCore.cjs');
const { createEmbeddedBackend } = require('./embeddedBackend.cjs');
const { createLocalStore } = require('./localStore.cjs');
const { createManagementSessionStore } = require('./managementSessionStore.cjs');
const { createOrbitApiClient } = require('./orbitApiClient.cjs');
const { createStaffAuthorization } = require('./staffAuthorization.cjs');
const { createUpdateController } = require('./updateController.cjs');
function encodeProtectedState(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-backed local cache encryption is unavailable.');
  return `safe-storage:v1:${safeStorage.encryptString(value).toString('base64')}`;
}

function decodeProtectedState(value) {
  if (!value.startsWith('safe-storage:v1:')) return value;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS-backed local cache decryption is unavailable.');
  return safeStorage.decryptString(Buffer.from(value.slice('safe-storage:v1:'.length), 'base64'));
}

const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  getRecordProperty,
  isRecord,
  normalizeTextMessageBatch,
  sanitizeAccountKey
} = require('./runtimeUtils.cjs');

const isDev = process.env.ELECTRON_DEV === 'true';

if (process.env.TABLEMANAGER_USER_DATA_DIR) {
  app.setPath('userData', process.env.TABLEMANAGER_USER_DATA_DIR);
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');

const windows = new Map();
const validRoutes = new Set(['floor', 'table', 'builder', 'profiles', 'signals', 'summary', 'customization', 'kpis', 'tournaments', 'tournament-tv', 'pilot', 'outreach']);
let appStartedAt = new Date().toISOString();

function writeOrbitApiLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...redactDetails(details)
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

function openTrustedExternal(url) {
  try {
    const parsed = new URL(url);
    const configuredHosts = String(process.env.ORBIT_EXTERNAL_HTTPS_HOSTS || 'orbitpoker.com,www.orbitpoker.com')
      .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
    const allowed = parsed.protocol === 'https:'
      ? configuredHosts.includes(parsed.hostname.toLowerCase())
      : parsed.protocol === 'mailto:' && /@(?:www\.)?orbitpoker\.com$/i.test(parsed.pathname);
    if (allowed) shell.openExternal(url);
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
    const responseMessage = getRecordProperty(result, 'message');
    throw new Error(responseMessage ? String(responseMessage) : `Twilio returned ${response.status}.`);
  }
  return result;
}

async function sendTextMessages(payload) {
  const config = getTwilioConfig();
  if (!config.ok) return { ok: false, sent: 0, error: config.error };

  const messages = normalizeTextMessageBatch(payload);
  if (!messages.length) return { ok: true, sent: 0, skipped: 0 };

  const results = [];
  for (let offset = 0; offset < messages.length; offset += 5) {
    results.push(...await Promise.allSettled(messages.slice(offset, offset + 5).map((message) => sendTwilioTextMessage(config, message))));
  }
  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const firstFailure = results.find((result) => result.status === 'rejected');
  const error = firstFailure?.status === 'rejected'
    ? 'One or more text messages could not be sent.'
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

const {
  closeDatabase,
  getReportCount,
  migrateLocalAccountToPilotAccess,
  readLocalDatabase,
  storeAnalyticalReport,
  writeLocalDatabase
} = createLocalStore({
  app,
  encodeState: encodeProtectedState,
  decodeState: decodeProtectedState,
  updateBackendReportCount: (reportCount) => embeddedBackend.updateReportCount(reportCount)
});

const managementSessionStore = createManagementSessionStore({
  app,
  encodeState: encodeProtectedState,
  decodeState: decodeProtectedState
});

const { buildPlayerClubSnapshot } = createOrbitCore({
  profile: 'electron',
  validateState: false,
  createId: () => crypto.randomUUID()
});

async function loadStateWithFirebaseFallback(accountKey) {
  const record = readLocalDatabase(accountKey);
  return record ? { ...record, source: 'offline-cache', authoritative: false } : null;
}

async function saveStateEverywhere(state) {
  const localResult = writeLocalDatabase(state);
  return {
    ...localResult,
    authoritative: false,
    serverCommit: 'pending',
    publication: { status: 'not-queued' }
  };
}

const {
  completeManagementRecoveryApi,
  getClientUpdateState,
  getManagementRecoveryStatusApi,
  getRemoteBackendStatus,
  loadStateApiFirst,
  saveStateApiFirst,
  saveStateToApi,
  sendClientError,
  sendClientEvent,
  sendClientUpdateEvent,
  startClientTelemetry,
  stopClientTelemetry,
  submitAnalyticalReportApiFirst,
  validatePilotAccessApi
} = createOrbitApiClient({
  app,
  getAppStartedAt: () => appStartedAt,
  isDev,
  loadStateWithFirebaseFallback,
  migrateLocalAccountToPilotAccess,
  readLocalDatabase,
  saveStateEverywhere,
  storeAnalyticalReport,
  writeLocalDatabase,
  writeOrbitApiLog
});

const embeddedBackend = createEmbeddedBackend({
  buildPlayerClubSnapshot,
  getAccountKeyFromState,
  getReportCount,
  loadStateWithFirebaseFallback,
  storeAnalyticalReport
});

const staffAuthorization = createStaffAuthorization({
  loadStateForAccess: (access) => loadStateApiFirst(getAccountKeyFromAccess(access), access)
});
let nextTextBatchAt = 0;

const updateController = createUpdateController({
  app,
  autoUpdater,
  getAllWindows: () => BrowserWindow.getAllWindows(),
  getClientUpdateState,
  getFloorWindow: () => windows.get('floor'),
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  isDev,
  nativeAutoUpdater,
  saveStateToApi,
  sendClientEvent,
  sendClientUpdateEvent,
  writeLocalDatabase,
  writeOrbitApiLog
});

function isTrustedIpcSender(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender?.mainFrame) return false;
  const senderUrl = String(event.senderFrame.url || '');
  if (isDev) return senderUrl.startsWith('http://127.0.0.1:5173/');
  try {
    const parsed = new URL(senderUrl);
    const expected = path.resolve(__dirname, '..', 'dist', 'index.html').toLowerCase();
    return parsed.protocol === 'file:' && path.resolve(decodeURIComponent(parsed.pathname.replace(/^\//, ''))).toLowerCase() === expected;
  } catch {
    return false;
  }
}

function trustedIpc(handler) {
  return (event, ...args) => {
    if (!isTrustedIpcSender(event)) throw new Error('Untrusted renderer IPC request rejected.');
    return handler(...args);
  };
}

function boundedPayload(value, maximumBytes = 2_000_000) {
  if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value), 'utf8') > maximumBytes) {
    throw new Error('IPC payload is invalid or too large.');
  }
  return value;
}

ipcMain.handle('open-route-window', trustedIpc((route, context = {}) => {
  const normalizedRoute = route === 'outreach' ? 'signals' : validRoutes.has(route) ? route : 'floor';
  createWindow(normalizedRoute, isRecord(context) ? context : {});
}));

ipcMain.handle('load-state', trustedIpc(async () => loadStateApiFirst()));

ipcMain.handle('load-state-for-account', trustedIpc(async (access) => loadStateApiFirst(getAccountKeyFromAccess(access), boundedPayload(access, 16_000))));

ipcMain.handle('save-state', trustedIpc(async (state) => saveStateApiFirst(boundedPayload(state))));

ipcMain.handle('preserve-state-for-update', trustedIpc(async (requestId, state) => {
  if (!/^[a-zA-Z0-9._:-]{1,160}$/.test(String(requestId || ''))) throw new Error('Invalid update request ID.');
  return updateController.handleRendererStateFlush(requestId, boundedPayload(state));
}));

ipcMain.handle('get-update-status', trustedIpc(() => updateController.getStatus()));

ipcMain.handle('install-downloaded-update', trustedIpc(() => updateController.installDownloadedUpdate()));

ipcMain.handle('get-backend-status', trustedIpc(async () => {
  const remoteStatus = await getRemoteBackendStatus();
  if (remoteStatus) return remoteStatus;
  const localStatus = embeddedBackend.getStatus();
  return { ...localStatus, reportCount: getReportCount(), mode: localStatus.running ? 'legacy-embedded' : 'local-fallback' };
}));

ipcMain.handle('validate-pilot-access', trustedIpc(async (access) => validatePilotAccessApi(boundedPayload(access, 16_000))));

ipcMain.handle('get-management-recovery-status', trustedIpc(async (access) => getManagementRecoveryStatusApi(boundedPayload(access, 16_000))));

ipcMain.handle('complete-management-recovery', trustedIpc(async (payload) => {
  const bounded = boundedPayload(payload, 20_000);
  return completeManagementRecoveryApi(bounded.access, bounded.password);
}));

ipcMain.handle('persist-management-session', trustedIpc((binding) =>
  managementSessionStore.saveSession(boundedPayload(binding, 2_000))
));

ipcMain.handle('restore-management-session', trustedIpc((binding) =>
  managementSessionStore.restoreSession(boundedPayload(binding, 2_000))
));

ipcMain.handle('clear-management-session', trustedIpc((accountKey) =>
  managementSessionStore.clearSession(String(accountKey || ''))
));

ipcMain.handle('submit-analytical-report', trustedIpc((report) => submitAnalyticalReportApiFirst(boundedPayload(report, 500_000))));

ipcMain.handle('verify-staff-pin', trustedIpc(async (payload) => {
  const result = await staffAuthorization.activate(boundedPayload(payload, 20_000));
  sendClientEvent(result.ok ? 'staff-verification-succeeded' : 'staff-verification-failed', 'security', {
    staffId: String(payload?.staffId || '').slice(0, 120),
    result: result.ok ? 'accepted' : 'rejected'
  });
  return result;
}));

ipcMain.handle('authorize-staff-action', trustedIpc((payload) => {
  const bounded = boundedPayload(payload, 4_000);
  const result = staffAuthorization.authorize(bounded);
  sendClientEvent(result.ok ? 'staff-authorization-succeeded' : 'staff-authorization-failed', 'security', {
    action: String(bounded.action || '').slice(0, 80),
    result: result.ok ? 'accepted' : 'rejected'
  });
  return result;
}));

ipcMain.handle('send-text-messages', trustedIpc((payload, staffToken) => {
  const authorization = staffAuthorization.authorize({ token: staffToken, action: 'send-text-messages' });
  if (!authorization.ok) return { ok: false, sent: 0, error: authorization.error };
  if (Date.now() < nextTextBatchAt) return { ok: false, sent: 0, error: 'Text messaging is temporarily rate limited.' };
  nextTextBatchAt = Date.now() + 60_000;
  return sendTextMessages(boundedPayload(payload, 100_000));
}));

ipcMain.handle('record-client-event', trustedIpc((event, category, details, route) => {
  sendClientEvent(String(event || '').slice(0, 100), String(category || '').slice(0, 60), boundedPayload(details || {}, 20_000), { route: String(route || '').slice(0, 80) });
  return { ok: true };
}));

ipcMain.handle('record-client-error', trustedIpc((payload = {}) => {
  boundedPayload(payload, 30_000);
  sendClientError(new Error(payload.message || 'Renderer error'), payload.source || 'renderer', {
    route: payload.route || '',
    filename: payload.filename || '',
    line: payload.line || 0,
    column: payload.column || 0,
    details: payload.details || null,
    rendererStack: payload.stack || ''
  });
  return { ok: true };
}));

function loadRoute(window, route, context = {}) {
  const query = route === 'table' && context.sessionId
    ? `sessionId=${encodeURIComponent(context.sessionId)}`
    : route === 'tournament-tv' && context.tournamentId
      ? `tournamentId=${encodeURIComponent(context.tournamentId)}`
      : '';
  const hash = `/${route}${query ? `?${query}` : ''}`;
  if (isDev) {
    window.loadURL(`http://127.0.0.1:5173/#${hash}`);
    return;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    hash
  });
}

function createWindow(route = 'floor', context = {}) {
  const windowKey = route === 'table' && context.sessionId
    ? `table:${context.sessionId}`
    : route === 'tournament-tv' && context.tournamentId
      ? `tournament-tv:${context.tournamentId}`
      : route;
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
    frame: true,
    autoHideMenuBar: route === 'tournament-tv',
    titleBarStyle: 'default',
    fullscreenable: true,
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

  if (route === 'tournament-tv') {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
  }

  mainWindow.once('ready-to-show', () => {
    if (route === 'table') {
      mainWindow.maximize();
    }
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
    embeddedBackend.start();
  }
  startClientTelemetry();
  updateController.start();

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
  stopClientTelemetry();
  updateController.stop();
  embeddedBackend.stop();
  closeDatabase();
});

process.on('uncaughtException', (error) => {
  sendClientError(error, 'main-uncaught-exception');
});

process.on('unhandledRejection', (reason) => {
  sendClientError(reason instanceof Error ? reason : new Error(String(reason)), 'main-unhandled-rejection');
});

