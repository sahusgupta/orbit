const crypto = require('crypto');
const { orbitApiErrorDetails, validateStatePayload } = require('./runtimeUtils.cjs');

const updateCheckIntervalMs = 30 * 60 * 1000;

function createUpdateController(dependencies) {
  const {
    app,
    autoUpdater,
    getAllWindows,
    getClientUpdateState,
    getFloorWindow,
    getFocusedWindow,
    isDev,
    nativeAutoUpdater,
    saveStateToApi,
    sendClientEvent,
    sendClientUpdateEvent,
    writeLocalDatabase,
    writeOrbitApiLog
  } = dependencies;
  const clearIntervalImpl = dependencies.clearIntervalImpl || clearInterval;
  const clearTimeoutImpl = dependencies.clearTimeoutImpl || clearTimeout;
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const setIntervalImpl = dependencies.setIntervalImpl || setInterval;
  const setTimeoutImpl = dependencies.setTimeoutImpl || setTimeout;

  const pendingStateFlushes = new Map();
  let checkTimer;
  let installPending = false;
  let installStarted = false;
  let lastProgressBucket = -1;
  let currentStatus = { state: 'idle' };

  function broadcastStatus(status) {
    currentStatus = { ...status };
    for (const window of getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send('update-status', status);
      }
    }
  }

  async function preserveRendererState() {
    const availableWindows = getAllWindows().filter((window) => !window.isDestroyed());
    const authoritativeWindow = getFloorWindow() || getFocusedWindow() || availableWindows[0];
    if (!authoritativeWindow || authoritativeWindow.isDestroyed()) {
      writeOrbitApiLog('error', 'update-state-flush-unavailable', {});
      return false;
    }

    return new Promise((resolve) => {
      const requestId = randomUUID();
      const timeout = setTimeoutImpl(() => {
        pendingStateFlushes.delete(requestId);
        writeOrbitApiLog('warn', 'update-state-flush-timed-out', { requestId });
        resolve(false);
      }, 15 * 1000);
      pendingStateFlushes.set(requestId, (ok) => {
        clearTimeoutImpl(timeout);
        pendingStateFlushes.delete(requestId);
        resolve(ok);
      });
      authoritativeWindow.webContents.send('prepare-for-update', requestId);
    });
  }

  async function installDownloadedUpdate() {
    if (!installPending) return { ok: false, error: 'No downloaded update is ready to install.' };
    if (installStarted) return { ok: false, error: 'Update installation is already in progress.' };
    installStarted = true;
    sendClientUpdateEvent('update-install-requested', 'downloaded');
    broadcastStatus({ state: 'preserving-state' });
    const preserved = await preserveRendererState();
    if (!preserved) {
      installStarted = false;
      const message = 'Orbit could not preserve the current workspace. The update was not installed.';
      writeOrbitApiLog('error', 'update-install-blocked-state-not-preserved', {});
      sendClientUpdateEvent('update-install-blocked', 'error', { message });
      broadcastStatus({ state: 'error', message, updateReady: true });
      return { ok: false, error: message };
    }
    installPending = false;
    sendClientUpdateEvent('update-install-approved', 'installing');
    broadcastStatus({ state: 'installing' });
    setTimeoutImpl(() => autoUpdater.quitAndInstall(false, true), 3000);
    return { ok: true };
  }

  function start() {
    if (isDev || !app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;

    autoUpdater.on('checking-for-update', () => {
      sendClientUpdateEvent('checking-for-update', 'checking');
      broadcastStatus({ state: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      sendClientUpdateEvent('update-available', 'available', { version: info.version });
      broadcastStatus({ state: 'available', version: info.version });
    });
    autoUpdater.on('update-not-available', (info) => {
      sendClientUpdateEvent('update-not-available', 'current', { version: info.version });
      broadcastStatus({ state: 'current', version: info.version });
    });
    autoUpdater.on('download-progress', (progress) => {
      const progressBucket = Math.floor(Math.round(progress.percent ?? 0) / 25);
      if (progressBucket !== lastProgressBucket) {
        lastProgressBucket = progressBucket;
        sendClientEvent('update-download-progress', 'update', { percent: Math.round(progress.percent ?? 0) });
      }
      broadcastStatus({ state: 'downloading', percent: Math.round(progress.percent ?? 0) });
    });
    autoUpdater.on('update-downloaded', (info) => {
      lastProgressBucket = -1;
      if (installStarted) return;
      if (!installPending) sendClientUpdateEvent('update-downloaded', 'downloaded', { version: info.version });
      installPending = true;
      broadcastStatus({ state: 'downloaded', version: info.version, requiresUserApproval: true });
    });
    nativeAutoUpdater.on('before-quit-for-update', () => {
      sendClientEvent('update-installing', 'update', getClientUpdateState());
    });
    autoUpdater.on('error', (error) => {
      lastProgressBucket = -1;
      const message = error instanceof Error ? error.message : 'Update check failed.';
      sendClientUpdateEvent('update-error', 'error', { message });
      broadcastStatus({ state: 'error', message, ...(installPending && !installStarted ? { updateReady: true } : {}) });
    });

    const checkForUpdates = () => {
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        const message = error instanceof Error ? error.message : 'Update check failed.';
        sendClientUpdateEvent('update-error', 'error', { message });
        broadcastStatus({ state: 'error', message, ...(installPending && !installStarted ? { updateReady: true } : {}) });
      });
    };

    checkForUpdates();
    checkTimer = setIntervalImpl(checkForUpdates, updateCheckIntervalMs);
  }

  function stop() {
    if (!checkTimer) return;
    clearIntervalImpl(checkTimer);
    checkTimer = undefined;
  }

  async function handleRendererStateFlush(requestId, state) {
    let ok = false;
    try {
      validateStatePayload(state);
      writeLocalDatabase(state);
      ok = true;
      void saveStateToApi(state).catch((error) => {
        writeOrbitApiLog('warn', 'update-cloud-state-flush-failed', orbitApiErrorDetails(error));
      });
    } catch (error) {
      writeOrbitApiLog('error', 'update-local-state-flush-failed', orbitApiErrorDetails(error));
    }
    pendingStateFlushes.get(requestId)?.(ok);
    return { ok };
  }

  return {
    broadcastStatus,
    getStatus: () => ({ ...currentStatus }),
    handleRendererStateFlush,
    installDownloadedUpdate,
    preserveRendererState,
    start,
    stop
  };
}

module.exports = { createUpdateController };
