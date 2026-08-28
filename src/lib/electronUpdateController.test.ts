import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

type UpdateController = {
  broadcastStatus: (status: unknown) => void;
  getStatus: () => unknown;
  handleRendererStateFlush: (requestId: string, state: unknown) => Promise<{ ok: boolean }>;
  installDownloadedUpdate: () => Promise<{ ok: boolean; error?: string }>;
  preserveRendererState: () => Promise<boolean>;
  start: () => void;
  stop: () => void;
};

const { createUpdateController }: { createUpdateController: (dependencies: Record<string, unknown>) => UpdateController } = require('../../electron/updateController.cjs');

function createEmitter() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback))
  };
}

function baseDependencies(overrides: Record<string, unknown> = {}) {
  return {
    app: { isPackaged: true },
    autoUpdater: Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    }),
    clearIntervalImpl: vi.fn(),
    clearTimeoutImpl: vi.fn(),
    getAllWindows: () => [],
    getClientUpdateState: () => ({ updateStatus: 'installing', updateEvent: 'update-install-approved' }),
    getFloorWindow: () => undefined,
    getFocusedWindow: () => undefined,
    isDev: false,
    nativeAutoUpdater: createEmitter(),
    randomUUID: () => 'flush-001',
    saveStateToApi: vi.fn().mockResolvedValue({ ok: true }),
    sendClientEvent: vi.fn(),
    sendClientUpdateEvent: vi.fn(),
    setIntervalImpl: vi.fn().mockReturnValue(84),
    setTimeoutImpl: vi.fn().mockReturnValue(83),
    writeLocalDatabase: vi.fn(),
    writeOrbitApiLog: vi.fn(),
    ...overrides
  };
}

describe('Electron update controller', () => {
  it('broadcasts update status only to live renderer windows', () => {
    const liveSend = vi.fn();
    const destroyedSend = vi.fn();
    const controller = createUpdateController(baseDependencies({
      getAllWindows: () => [
        { isDestroyed: () => false, webContents: { send: liveSend } },
        { isDestroyed: () => true, webContents: { send: destroyedSend } }
      ]
    }));

    controller.broadcastStatus({ state: 'checking' });
    expect(liveSend).toHaveBeenCalledWith('update-status', { state: 'checking' });
    expect(destroyedSend).not.toHaveBeenCalled();
  });

  it('selects the floor window for the state-flush handshake and resolves its acknowledgement', async () => {
    const floorSend = vi.fn();
    const focusedSend = vi.fn();
    const floorWindow = { isDestroyed: () => false, webContents: { send: floorSend } };
    const focusedWindow = { isDestroyed: () => false, webContents: { send: focusedSend } };
    const clearTimeoutImpl = vi.fn();
    const setTimeoutImpl = vi.fn().mockReturnValue(81);
    const writeLocalDatabase = vi.fn();
    const saveStateToApi = vi.fn().mockResolvedValue({ ok: true });
    const controller = createUpdateController(baseDependencies({
      clearTimeoutImpl,
      getAllWindows: () => [focusedWindow],
      getFloorWindow: () => floorWindow,
      getFocusedWindow: () => focusedWindow,
      saveStateToApi,
      setTimeoutImpl,
      writeLocalDatabase
    }));
    const state = { games: [], sessions: [], playerSessions: [], settings: {} };

    const result = controller.preserveRendererState();
    expect(floorSend).toHaveBeenCalledWith('prepare-for-update', 'flush-001');
    expect(focusedSend).not.toHaveBeenCalled();
    expect(setTimeoutImpl).toHaveBeenCalledWith(expect.any(Function), 15_000);

    await expect(controller.handleRendererStateFlush('flush-001', state)).resolves.toEqual({ ok: true });
    await expect(result).resolves.toBe(true);
    expect(writeLocalDatabase).toHaveBeenCalledWith(state);
    expect(saveStateToApi).toHaveBeenCalledWith(state);
    expect(clearTimeoutImpl).toHaveBeenCalledWith(81);
  });

  it('logs and clears a timed-out state-flush handshake while no-window startup is a no-op', async () => {
    let timeoutCallback: (() => void) | undefined;
    const writeOrbitApiLog = vi.fn();
    const window = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const controller = createUpdateController(baseDependencies({
      getAllWindows: () => [window],
      setTimeoutImpl: vi.fn((callback: () => void) => {
        timeoutCallback = callback;
        return 82;
      }),
      writeOrbitApiLog
    }));
    const result = controller.preserveRendererState();
    timeoutCallback?.();
    await expect(result).resolves.toBe(false);
    expect(writeOrbitApiLog).toHaveBeenCalledWith('warn', 'update-state-flush-timed-out', { requestId: 'flush-001' });

    const noWindow = createUpdateController(baseDependencies({ randomUUID: vi.fn() }));
    await expect(noWindow.preserveRendererState()).resolves.toBe(false);
  });

  it('requires an explicit install request, preserves state, and then uses the three-second restart delay', async () => {
    const order: string[] = [];
    let installCallback: (() => void) | undefined;
    const floorSend = vi.fn();
    const floorWindow = { isDestroyed: () => false, webContents: { send: floorSend } };
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(() => order.push('quit-and-install'))
    });
    const sendClientUpdateEvent = vi.fn((event: string) => order.push(`event:${event}`));
    const liveSend = vi.fn((_channel: string, status: { state: string }) => order.push(`status:${status.state}`));
    const controller = createUpdateController(baseDependencies({
      autoUpdater,
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: liveSend } }],
      getFloorWindow: () => floorWindow,
      sendClientUpdateEvent,
      setTimeoutImpl: vi.fn((callback: () => void, delay: number) => {
        if (delay === 3000) installCallback = callback;
        return delay;
      })
    }));
    controller.start();

    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });
    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });
    expect(floorSend).not.toHaveBeenCalled();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: 'downloaded', version: '2.0.0', requiresUserApproval: true });

    const install = controller.installDownloadedUpdate();
    expect(floorSend).toHaveBeenCalledTimes(1);
    expect(sendClientUpdateEvent.mock.calls.filter((call) => call[0] === 'update-install-requested')).toHaveLength(1);

    await controller.handleRendererStateFlush('flush-001', { games: [], sessions: [], playerSessions: [], settings: {} });
    await expect(install).resolves.toEqual({ ok: true });
    expect(sendClientUpdateEvent.mock.calls.filter((call) => call[0] === 'update-install-approved')).toHaveLength(1);
    expect(order).toContain('status:installing');
    installCallback?.();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(order.at(-1)).toBe('quit-and-install');
  });

  it('blocks installation when the renderer cannot preserve authoritative workspace state', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    });
    const writeOrbitApiLog = vi.fn();
    const controller = createUpdateController(baseDependencies({ autoUpdater, writeOrbitApiLog }));
    controller.start();
    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });

    await expect(controller.installDownloadedUpdate()).resolves.toEqual({
      ok: false,
      error: 'Orbit could not preserve the current workspace. The update was not installed.'
    });
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual(expect.objectContaining({ state: 'error', updateReady: true }));
    expect(writeOrbitApiLog).toHaveBeenCalledWith('error', 'update-install-blocked-state-not-preserved', {});
  });

  it('does not configure update checks in development or an unpackaged application', () => {
    const devDependencies = baseDependencies({ isDev: true });
    const devController = createUpdateController(devDependencies);
    devController.start();
    expect((devDependencies.autoUpdater as ReturnType<typeof createEmitter>).on).not.toHaveBeenCalled();

    const unpackagedDependencies = baseDependencies({ app: { isPackaged: false } });
    const unpackagedController = createUpdateController(unpackagedDependencies);
    unpackagedController.start();
    expect((unpackagedDependencies.autoUpdater as ReturnType<typeof createEmitter>).on).not.toHaveBeenCalled();
  });

  it('owns updater configuration, event/status routing, progress buckets, and periodic timer cleanup', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    });
    const nativeAutoUpdater = createEmitter();
    const sendClientEvent = vi.fn();
    const sendClientUpdateEvent = vi.fn();
    const statuses: unknown[] = [];
    const liveWindow = { isDestroyed: () => false, webContents: { send: vi.fn((_channel: string, status: unknown) => statuses.push(status)) } };
    let intervalCallback: (() => void) | undefined;
    const setIntervalImpl = vi.fn((callback: () => void) => {
      intervalCallback = callback;
      return 84;
    });
    const clearIntervalImpl = vi.fn();
    const controller = createUpdateController(baseDependencies({
      autoUpdater,
      clearIntervalImpl,
      getAllWindows: () => [liveWindow],
      nativeAutoUpdater,
      sendClientEvent,
      sendClientUpdateEvent,
      setIntervalImpl
    }));

    controller.start();
    expect(autoUpdater).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowPrerelease: false
    });
    expect([...autoUpdater.listeners.keys()]).toEqual([
      'checking-for-update',
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'error'
    ]);
    expect([...nativeAutoUpdater.listeners.keys()]).toEqual(['before-quit-for-update']);
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledOnce();
    expect(setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);

    autoUpdater.listeners.get('checking-for-update')?.();
    autoUpdater.listeners.get('update-available')?.({ version: '2.0.0' });
    autoUpdater.listeners.get('update-not-available')?.({ version: '1.0.0' });
    autoUpdater.listeners.get('download-progress')?.({ percent: 1 });
    autoUpdater.listeners.get('download-progress')?.({ percent: 20 });
    autoUpdater.listeners.get('download-progress')?.({ percent: 26 });
    nativeAutoUpdater.listeners.get('before-quit-for-update')?.();
    autoUpdater.listeners.get('error')?.(new Error('update failed'));

    expect(sendClientUpdateEvent.mock.calls).toEqual([
      ['checking-for-update', 'checking'],
      ['update-available', 'available', { version: '2.0.0' }],
      ['update-not-available', 'current', { version: '1.0.0' }],
      ['update-error', 'error', { message: 'update failed' }]
    ]);
    expect(sendClientEvent.mock.calls).toEqual([
      ['update-download-progress', 'update', { percent: 1 }],
      ['update-download-progress', 'update', { percent: 26 }],
      ['update-installing', 'update', { updateStatus: 'installing', updateEvent: 'update-install-approved' }]
    ]);
    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'available', version: '2.0.0' },
      { state: 'current', version: '1.0.0' },
      { state: 'downloading', percent: 1 },
      { state: 'downloading', percent: 20 },
      { state: 'downloading', percent: 26 },
      { state: 'error', message: 'update failed' }
    ]);

    intervalCallback?.();
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    controller.stop();
    controller.stop();
    expect(clearIntervalImpl).toHaveBeenCalledWith(84);
    await Promise.resolve();
  });

  it('routes check promise failures without throwing', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockRejectedValue(new Error('check failed')),
      quitAndInstall: vi.fn()
    });
    const sendClientUpdateEvent = vi.fn();
    const statuses: unknown[] = [];
    const controller = createUpdateController(baseDependencies({
      autoUpdater,
      getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (_channel: string, status: unknown) => statuses.push(status) } }],
      sendClientUpdateEvent
    }));

    controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendClientUpdateEvent).toHaveBeenCalledWith('update-error', 'error', { message: 'check failed' });
    expect(statuses).toContainEqual({ state: 'error', message: 'check failed' });
  });

  it('keeps a downloaded update actionable after a later updater error', () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    });
    const controller = createUpdateController(baseDependencies({ autoUpdater }));

    controller.start();
    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });
    autoUpdater.listeners.get('error')?.(new Error('later check failed'));

    expect(controller.getStatus()).toEqual({
      state: 'error',
      message: 'later check failed',
      updateReady: true
    });
  });

  it('does not expose a duplicate install action while state preservation is in progress', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn()
    });
    const floorWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
    const controller = createUpdateController(baseDependencies({
      autoUpdater,
      getFloorWindow: () => floorWindow,
      getAllWindows: () => [floorWindow]
    }));

    controller.start();
    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });
    const installation = controller.installDownloadedUpdate();
    expect(controller.getStatus()).toEqual({ state: 'preserving-state' });

    autoUpdater.listeners.get('error')?.(new Error('concurrent updater error'));
    expect(controller.getStatus()).toEqual({ state: 'error', message: 'concurrent updater error' });

    await controller.handleRendererStateFlush('flush-001', { games: [], sessions: [], playerSessions: [], settings: {} });
    await expect(installation).resolves.toEqual({ ok: true });
  });

  it('preserves state locally before best-effort cloud flush and resolves failures through the same handshake', async () => {
    const saveStateToApi = vi.fn().mockRejectedValue(new Error('cloud unavailable'));
    const writeOrbitApiLog = vi.fn();
    const controller = createUpdateController(baseDependencies({ saveStateToApi, writeOrbitApiLog }));
    const state = { games: [], sessions: [], playerSessions: [], settings: {} };

    await expect(controller.handleRendererStateFlush('unknown-request', state)).resolves.toEqual({ ok: true });
    await Promise.resolve();
    expect(writeOrbitApiLog).toHaveBeenCalledWith('warn', 'update-cloud-state-flush-failed', expect.objectContaining({
      errorMessage: 'cloud unavailable'
    }));

    const failureLog = vi.fn();
    const failureController = createUpdateController(baseDependencies({
      writeLocalDatabase: vi.fn(() => { throw new Error('local unavailable'); }),
      writeOrbitApiLog: failureLog
    }));
    await expect(failureController.handleRendererStateFlush('unknown-request', state)).resolves.toEqual({ ok: false });
    expect(failureLog).toHaveBeenCalledWith('error', 'update-local-state-flush-failed', expect.objectContaining({
      errorMessage: 'local unavailable'
    }));
  });
});
