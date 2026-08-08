const { app, autoUpdater: nativeAutoUpdater, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const branding = require('../branding.config.json');
const { createOrbitCore } = require('../apps/api/src/shared/orbitCore.cjs');
const {
  fetchPendingPlayerRequests,
  isFirebaseConfigured,
  markPlayerRequestApplied,
  readStateFromFirebase,
  writeStateToFirebase
} = require('./firebaseSync.cjs');
const { createEmbeddedBackend } = require('./embeddedBackend.cjs');
const { createLocalStore } = require('./localStore.cjs');
const { createOrbitApiClient } = require('./orbitApiClient.cjs');
const { createUpdateController } = require('./updateController.cjs');
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

const {
  closeDatabase,
  getReportCount,
  readLocalDatabase,
  storeAnalyticalReport,
  writeLocalDatabase
} = createLocalStore({
  app,
  updateBackendReportCount: (reportCount) => embeddedBackend.updateReportCount(reportCount)
});

const {
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot
} = createOrbitCore({
  profile: 'electron',
  validateState: false,
  createId: () => crypto.randomUUID()
});

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

const {
  getClientUpdateState,
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
  buildPlayerClubSnapshot,
  getAppStartedAt: () => appStartedAt,
  isDev,
  isFirebaseConfigured,
  loadStateWithFirebaseFallback,
  readLocalDatabase,
  saveStateEverywhere,
  storeAnalyticalReport,
  writeLocalDatabase,
  writeOrbitApiLog,
  writeStateToFirebase
});

const embeddedBackend = createEmbeddedBackend({
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  getAccountKeyFromState,
  getReportCount,
  loadStateWithFirebaseFallback,
  saveStateEverywhere,
  storeAnalyticalReport,
  syncStateWithFirebaseRequests
});

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

ipcMain.handle('open-route-window', (_event, route, context = {}) => {
  const normalizedRoute = route === 'outreach' ? 'signals' : validRoutes.has(route) ? route : 'floor';
  createWindow(normalizedRoute, context);
});

ipcMain.handle('load-state', async () => loadStateApiFirst());

ipcMain.handle('load-state-for-account', async (_event, access) => loadStateApiFirst(getAccountKeyFromAccess(access), access));

ipcMain.handle('save-state', async (_event, state) => saveStateApiFirst(state));

ipcMain.handle('preserve-state-for-update', async (_event, requestId, state) => updateController.handleRendererStateFlush(requestId, state));

ipcMain.handle('get-backend-status', async () => {
  const remoteStatus = await getRemoteBackendStatus();
  if (remoteStatus) return remoteStatus;
  const localStatus = embeddedBackend.getStatus();
  return { ...localStatus, reportCount: getReportCount(), mode: localStatus.running ? 'legacy-embedded' : 'local-fallback' };
});

ipcMain.handle('validate-pilot-access', async (_event, access) => validatePilotAccessApi(access));

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
    frame: route !== 'tournament-tv',
    autoHideMenuBar: route === 'tournament-tv',
    titleBarStyle: route === 'tournament-tv' ? 'hidden' : 'default',
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
    if (route === 'tournament-tv') {
      mainWindow.setFullScreen(true);
    } else if (route === 'table') {
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

