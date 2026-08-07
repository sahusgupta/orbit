import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');

function extractFunctionSource(name: string) {
  const asyncStart = electronMainSource.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : electronMainSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in electron/main.cjs.`);
  const parametersStart = electronMainSource.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '(') parameterDepth += 1;
    if (electronMainSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = electronMainSource.indexOf('{', parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '{') depth += 1;
    if (electronMainSource[index] === '}') depth -= 1;
    if (depth === 0) return electronMainSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in electron/main.cjs.`);
}

function loadFunction<T>(name: string, globals: Record<string, unknown> = {}): T {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(name)}; return ${name};`);
  return factory(...names.map((key) => globals[key])) as T;
}

function extractIpcRegistration(channel: string) {
  const start = electronMainSource.indexOf(`ipcMain.handle('${channel}'`);
  if (start < 0) throw new Error(`Could not find IPC registration for ${channel}.`);
  const callStart = electronMainSource.indexOf('(', start);
  let depth = 0;
  for (let index = callStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '(') depth += 1;
    if (electronMainSource[index] === ')') depth -= 1;
    if (depth === 0) return electronMainSource.slice(start, index + 2);
  }
  throw new Error(`Could not find the end of IPC registration for ${channel}.`);
}

function loadIpcHandler<T>(channel: string, globals: Record<string, unknown>): T {
  let captured: T | undefined;
  const ipcMain = { handle: (_channel: string, handler: T) => { captured = handler; } };
  const names = Object.keys(globals);
  Function('ipcMain', ...names, extractIpcRegistration(channel))(ipcMain, ...names.map((key) => globals[key]));
  if (!captured) throw new Error(`IPC registration for ${channel} did not provide a handler.`);
  return captured;
}

function createEmitter() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => listeners.set(event, callback))
  };
}

describe('Electron update orchestration characterization', () => {
  it('broadcasts update status only to live renderer windows', () => {
    const liveSend = vi.fn();
    const destroyedSend = vi.fn();
    const broadcastUpdateStatus = loadFunction<(status: unknown) => void>('broadcastUpdateStatus', {
      BrowserWindow: {
        getAllWindows: () => [
          { isDestroyed: () => false, webContents: { send: liveSend } },
          { isDestroyed: () => true, webContents: { send: destroyedSend } }
        ]
      }
    });

    broadcastUpdateStatus({ state: 'checking' });
    expect(liveSend).toHaveBeenCalledWith('update-status', { state: 'checking' });
    expect(destroyedSend).not.toHaveBeenCalled();
  });

  it('selects the floor window for the state-flush handshake and resolves its acknowledgement', async () => {
    const floorSend = vi.fn();
    const focusedSend = vi.fn();
    const floorWindow = { isDestroyed: () => false, webContents: { send: floorSend } };
    const focusedWindow = { isDestroyed: () => false, webContents: { send: focusedSend } };
    const pendingUpdateStateFlushes = new Map<string, (ok: boolean) => void>();
    const clearTimeout = vi.fn();
    const setTimeout = vi.fn().mockReturnValue(81);
    const preserveRendererStateBeforeUpdate = loadFunction<() => Promise<void>>('preserveRendererStateBeforeUpdate', {
      BrowserWindow: { getAllWindows: () => [focusedWindow], getFocusedWindow: () => focusedWindow },
      clearTimeout,
      crypto: { randomUUID: () => 'flush-001' },
      pendingUpdateStateFlushes,
      setTimeout,
      windows: new Map([['floor', floorWindow]]),
      writeOrbitApiLog: vi.fn()
    });

    const result = preserveRendererStateBeforeUpdate();
    expect(floorSend).toHaveBeenCalledWith('prepare-for-update', 'flush-001');
    expect(focusedSend).not.toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);

    pendingUpdateStateFlushes.get('flush-001')?.(true);
    await expect(result).resolves.toBeUndefined();
    expect(clearTimeout).toHaveBeenCalledWith(81);
    expect(pendingUpdateStateFlushes.has('flush-001')).toBe(false);
  });

  it('logs and clears a timed-out state-flush handshake while no-window startup is a no-op', async () => {
    let timeoutCallback: (() => void) | undefined;
    const pendingUpdateStateFlushes = new Map<string, (ok: boolean) => void>();
    const writeOrbitApiLog = vi.fn();
    const preserveRendererStateBeforeUpdate = loadFunction<() => Promise<void>>('preserveRendererStateBeforeUpdate', {
      BrowserWindow: {
        getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: vi.fn() } }],
        getFocusedWindow: () => undefined
      },
      clearTimeout: vi.fn(),
      crypto: { randomUUID: () => 'flush-002' },
      pendingUpdateStateFlushes,
      setTimeout: vi.fn((callback: () => void) => {
        timeoutCallback = callback;
        return 82;
      }),
      windows: new Map(),
      writeOrbitApiLog
    });
    const result = preserveRendererStateBeforeUpdate();
    timeoutCallback?.();
    await expect(result).resolves.toBeUndefined();
    expect(pendingUpdateStateFlushes.has('flush-002')).toBe(false);
    expect(writeOrbitApiLog).toHaveBeenCalledWith('warn', 'update-state-flush-timed-out', { requestId: 'flush-002' });

    const noWindow = loadFunction<() => Promise<void>>('preserveRendererStateBeforeUpdate', {
      BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => undefined },
      clearTimeout: vi.fn(),
      crypto: { randomUUID: vi.fn() },
      pendingUpdateStateFlushes: new Map(),
      setTimeout: vi.fn(),
      windows: new Map(),
      writeOrbitApiLog: vi.fn()
    });
    await expect(noWindow()).resolves.toBeUndefined();
  });

  it('installs a pending update once, after state preservation and the three-second delay', async () => {
    const order: string[] = [];
    let installCallback: (() => void) | undefined;
    const autoUpdater = { quitAndInstall: vi.fn(() => order.push('quit-and-install')) };
    const installDownloadedUpdate = loadFunction<() => Promise<void>>('installDownloadedUpdate', {
      autoUpdater,
      broadcastUpdateStatus: vi.fn((status: { state: string }) => order.push(`status:${status.state}`)),
      preserveRendererStateBeforeUpdate: vi.fn(async () => { order.push('preserved'); }),
      sendClientUpdateEvent: vi.fn((event: string) => order.push(`event:${event}`)),
      setTimeout: vi.fn((callback: () => void, delay: number) => {
        expect(delay).toBe(3000);
        installCallback = callback;
        return 83;
      }),
      updateInstallPending: true,
      updateInstallStarted: false
    });

    await Promise.all([installDownloadedUpdate(), installDownloadedUpdate()]);
    expect(order).toEqual([
      'event:update-preserving-state',
      'status:preserving-state',
      'preserved',
      'event:update-installing-automatically',
      'status:installing'
    ]);
    installCallback?.();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(order.at(-1)).toBe('quit-and-install');
  });

  it('does not configure update checks in development or an unpackaged application', () => {
    const autoUpdater = Object.assign(createEmitter(), { checkForUpdatesAndNotify: vi.fn() });
    const startInDev = loadFunction<() => void>('startAutoUpdates', {
      app: { isPackaged: true },
      autoUpdater,
      isDev: true
    });
    startInDev();
    expect(autoUpdater.on).not.toHaveBeenCalled();
    expect(autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();

    const startUnpackaged = loadFunction<() => void>('startAutoUpdates', {
      app: { isPackaged: false },
      autoUpdater,
      isDev: false
    });
    startUnpackaged();
    expect(autoUpdater.on).not.toHaveBeenCalled();
  });

  it('owns updater configuration, event/status routing, progress buckets, and the periodic check timer', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined)
    });
    const nativeAutoUpdater = createEmitter();
    const sendClientEvent = vi.fn();
    const sendClientUpdateEvent = vi.fn();
    const broadcastUpdateStatus = vi.fn();
    const installDownloadedUpdate = vi.fn().mockResolvedValue(undefined);
    let intervalCallback: (() => void) | undefined;
    const setInterval = vi.fn((callback: () => void) => {
      intervalCallback = callback;
      return 84;
    });
    const startAutoUpdates = loadFunction<() => void>('startAutoUpdates', {
      app: { isPackaged: true },
      autoUpdater,
      broadcastUpdateStatus,
      getClientUpdateState: () => ({ updateStatus: 'installing', updateEvent: 'update-installing-automatically' }),
      installDownloadedUpdate,
      isDev: false,
      lastUpdateProgressBucket: -1,
      nativeAutoUpdater,
      sendClientEvent,
      sendClientUpdateEvent,
      setInterval,
      updateCheckIntervalMs: 30 * 60 * 1000,
      updateCheckTimer: undefined,
      updateInstallPending: false
    });

    startAutoUpdates();
    expect(autoUpdater).toMatchObject({
      autoDownload: true,
      autoInstallOnAppQuit: true,
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
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 60 * 1000);

    autoUpdater.listeners.get('checking-for-update')?.();
    autoUpdater.listeners.get('update-available')?.({ version: '2.0.0' });
    autoUpdater.listeners.get('update-not-available')?.({ version: '1.0.0' });
    autoUpdater.listeners.get('download-progress')?.({ percent: 1 });
    autoUpdater.listeners.get('download-progress')?.({ percent: 20 });
    autoUpdater.listeners.get('download-progress')?.({ percent: 26 });
    autoUpdater.listeners.get('update-downloaded')?.({ version: '2.0.0' });
    nativeAutoUpdater.listeners.get('before-quit-for-update')?.();
    autoUpdater.listeners.get('error')?.(new Error('update failed'));

    expect(sendClientUpdateEvent.mock.calls).toEqual([
      ['checking-for-update', 'checking'],
      ['update-available', 'available', { version: '2.0.0' }],
      ['update-not-available', 'current', { version: '1.0.0' }],
      ['update-downloaded', 'downloaded', { version: '2.0.0' }],
      ['update-error', 'error', { message: 'update failed' }]
    ]);
    expect(sendClientEvent.mock.calls).toEqual([
      ['update-download-progress', 'update', { percent: 1 }],
      ['update-download-progress', 'update', { percent: 26 }],
      ['update-installing', 'update', { updateStatus: 'installing', updateEvent: 'update-installing-automatically' }]
    ]);
    expect(broadcastUpdateStatus.mock.calls.map((call) => call[0])).toEqual([
      { state: 'checking' },
      { state: 'available', version: '2.0.0' },
      { state: 'current', version: '1.0.0' },
      { state: 'downloading', percent: 1 },
      { state: 'downloading', percent: 20 },
      { state: 'downloading', percent: 26 },
      { state: 'downloaded', version: '2.0.0' },
      { state: 'error', message: 'update failed' }
    ]);
    expect(installDownloadedUpdate).toHaveBeenCalledOnce();

    intervalCallback?.();
    expect(autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });

  it('routes check promise failures without throwing', async () => {
    const autoUpdater = Object.assign(createEmitter(), {
      checkForUpdatesAndNotify: vi.fn().mockRejectedValue(new Error('check failed'))
    });
    const sendClientUpdateEvent = vi.fn();
    const broadcastUpdateStatus = vi.fn();
    const startAutoUpdates = loadFunction<() => void>('startAutoUpdates', {
      app: { isPackaged: true },
      autoUpdater,
      broadcastUpdateStatus,
      getClientUpdateState: vi.fn(),
      installDownloadedUpdate: vi.fn(),
      isDev: false,
      lastUpdateProgressBucket: -1,
      nativeAutoUpdater: createEmitter(),
      sendClientEvent: vi.fn(),
      sendClientUpdateEvent,
      setInterval: vi.fn().mockReturnValue(85),
      updateCheckIntervalMs: 30 * 60 * 1000,
      updateCheckTimer: undefined,
      updateInstallPending: false
    });

    startAutoUpdates();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendClientUpdateEvent).toHaveBeenCalledWith('update-error', 'error', { message: 'check failed' });
    expect(broadcastUpdateStatus).toHaveBeenCalledWith({ state: 'error', message: 'check failed' });
  });

  it('preserves state locally before best-effort cloud flush and resolves the pending handshake on success or failure', async () => {
    const pendingSuccess = vi.fn();
    const saveStateToApi = vi.fn().mockRejectedValue(new Error('cloud unavailable'));
    const writeOrbitApiLog = vi.fn();
    const state = { games: [], sessions: [], playerSessions: [], settings: {} };
    const handler = loadIpcHandler<(_event: unknown, requestId: string, state: unknown) => Promise<{ ok: boolean }>>('preserve-state-for-update', {
      orbitApiErrorDetails: (error: Error) => ({ errorMessage: error.message }),
      pendingUpdateStateFlushes: new Map([['flush-003', pendingSuccess]]),
      saveStateToApi,
      validateStatePayload: vi.fn(),
      writeLocalDatabase: vi.fn(),
      writeOrbitApiLog
    });

    await expect(handler(undefined, 'flush-003', state)).resolves.toEqual({ ok: true });
    expect(pendingSuccess).toHaveBeenCalledWith(true);
    expect(saveStateToApi).toHaveBeenCalledWith(state);
    await Promise.resolve();
    expect(writeOrbitApiLog).toHaveBeenCalledWith('warn', 'update-cloud-state-flush-failed', { errorMessage: 'cloud unavailable' });

    const pendingFailure = vi.fn();
    const localError = new Error('local unavailable');
    const failureHandler = loadIpcHandler<(_event: unknown, requestId: string, state: unknown) => Promise<{ ok: boolean }>>('preserve-state-for-update', {
      orbitApiErrorDetails: (error: Error) => ({ errorMessage: error.message }),
      pendingUpdateStateFlushes: new Map([['flush-004', pendingFailure]]),
      saveStateToApi: vi.fn(),
      validateStatePayload: vi.fn(() => { throw localError; }),
      writeLocalDatabase: vi.fn(),
      writeOrbitApiLog
    });
    await expect(failureHandler(undefined, 'flush-004', state)).resolves.toEqual({ ok: false });
    expect(pendingFailure).toHaveBeenCalledWith(false);
    expect(writeOrbitApiLog).toHaveBeenCalledWith('error', 'update-local-state-flush-failed', { errorMessage: 'local unavailable' });
  });
});
