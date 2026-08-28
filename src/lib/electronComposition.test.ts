import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
const electronPreloadSource = readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8');

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

describe('Electron IPC and preload composition audit', () => {
  it('keeps the exact main/preload invoke channel surface synchronized', () => {
    const mainChannels = [...electronMainSource.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]);
    const preloadChannels = [...electronPreloadSource.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((match) => match[1]);
    const expectedChannels = [
      'open-route-window',
      'load-state',
      'load-state-for-account',
      'save-state',
      'preserve-state-for-update',
      'get-update-status',
      'install-downloaded-update',
      'get-backend-status',
      'validate-pilot-access',
      'get-management-recovery-status',
      'complete-management-recovery',
      'generate-self-check-in-kit',
      'persist-management-session',
      'restore-management-session',
      'clear-management-session',
      'submit-analytical-report',
      'verify-staff-pin',
      'authorize-staff-action',
      'send-text-messages',
      'record-client-event',
      'record-client-error'
    ];

    expect(mainChannels).toEqual(expectedChannels);
    expect([...preloadChannels].sort()).toEqual([...expectedChannels].sort());
    expect(electronMainSource).not.toMatch(/ipcMain\.on\(/);
  });

  it('exposes only the reviewed preload bridge and preserves argument/event forwarding', async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const on = vi.fn();
    const removeListener = vi.fn();
    const exposeInMainWorld = vi.fn();
    const electron = { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, removeListener } };
    Function('require', 'process', electronPreloadSource)((moduleName: string) => {
      expect(moduleName).toBe('electron');
      return electron;
    }, { platform: 'win32' });

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [bridgeName, bridge] = exposeInMainWorld.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(bridgeName).toBe('tableManagerDesktop');
    expect(Object.keys(bridge)).toEqual([
      'platform',
      'isDesktop',
      'openWindow',
      'loadState',
      'loadStateForAccount',
      'saveState',
      'preserveStateForUpdate',
      'getUpdateStatus',
      'installDownloadedUpdate',
      'onPrepareForUpdate',
      'onUpdateStatus',
      'getBackendStatus',
      'validatePilotAccess',
      'getManagementRecoveryStatus',
      'completeManagementRecovery',
      'generateSelfCheckInKit',
      'persistManagementSession',
      'restoreManagementSession',
      'clearManagementSession',
      'verifyStaffPin',
      'authorizeStaffAction',
      'submitAnalyticalReport',
      'sendTextMessages',
      'recordClientEvent',
      'recordClientError'
    ]);
    expect(bridge.platform).toBe('win32');
    expect(bridge.isDesktop).toBe(true);

    const openWindow = bridge.openWindow as (route: string, context: unknown) => Promise<unknown>;
    const preserveStateForUpdate = bridge.preserveStateForUpdate as (requestId: string, state: unknown) => Promise<unknown>;
    const getUpdateStatus = bridge.getUpdateStatus as () => Promise<unknown>;
    const installDownloadedUpdate = bridge.installDownloadedUpdate as () => Promise<unknown>;
    const getManagementRecoveryStatus = bridge.getManagementRecoveryStatus as (access: unknown) => Promise<unknown>;
    const completeManagementRecovery = bridge.completeManagementRecovery as (payload: unknown) => Promise<unknown>;
    const generateSelfCheckInKit = bridge.generateSelfCheckInKit as (payload: unknown) => Promise<unknown>;
    const persistManagementSession = bridge.persistManagementSession as (binding: unknown) => Promise<unknown>;
    const restoreManagementSession = bridge.restoreManagementSession as (binding: unknown) => Promise<unknown>;
    const clearManagementSession = bridge.clearManagementSession as (accountKey: string) => Promise<unknown>;
    const recordClientEvent = bridge.recordClientEvent as (...args: unknown[]) => Promise<unknown>;
    await openWindow('table', { sessionId: 'session-1' });
    await preserveStateForUpdate('flush-1', { games: [] });
    await getUpdateStatus();
    await installDownloadedUpdate();
    await getManagementRecoveryStatus({ authorizationCode: 'pilot-code' });
    await completeManagementRecovery({ access: { authorizationCode: 'pilot-code' }, password: 'new-password' });
    await generateSelfCheckInKit({ access: { authorizationCode: 'pilot-code' }, staffToken: 'staff-token' });
    await persistManagementSession({ accountKey: 'club-one' });
    await restoreManagementSession({ accountKey: 'club-one' });
    await clearManagementSession('club-one');
    await recordClientEvent('table-started', 'tables', { tableId: 'table-1' }, 'floor');
    expect(invoke.mock.calls).toEqual([
      ['open-route-window', 'table', { sessionId: 'session-1' }],
      ['preserve-state-for-update', 'flush-1', { games: [] }],
      ['get-update-status'],
      ['install-downloaded-update'],
      ['get-management-recovery-status', { authorizationCode: 'pilot-code' }],
      ['complete-management-recovery', { access: { authorizationCode: 'pilot-code' }, password: 'new-password' }],
      ['generate-self-check-in-kit', { access: { authorizationCode: 'pilot-code' }, staffToken: 'staff-token' }],
      ['persist-management-session', { accountKey: 'club-one' }],
      ['restore-management-session', { accountKey: 'club-one' }],
      ['clear-management-session', 'club-one'],
      ['record-client-event', 'table-started', 'tables', { tableId: 'table-1' }, 'floor']
    ]);

    const callback = vi.fn();
    const dispose = (bridge.onPrepareForUpdate as (callback: (requestId: string) => void) => () => void)(callback);
    expect(on).toHaveBeenCalledWith('prepare-for-update', expect.any(Function));
    const listener = on.mock.calls[0][1] as (_event: unknown, requestId: string) => void;
    listener(undefined, 'flush-2');
    expect(callback).toHaveBeenCalledWith('flush-2');
    dispose();
    expect(removeListener).toHaveBeenCalledWith('prepare-for-update', listener);

    const statusCallback = vi.fn();
    const disposeStatus = (bridge.onUpdateStatus as (callback: (status: unknown) => void) => () => void)(statusCallback);
    expect(on).toHaveBeenCalledWith('update-status', expect.any(Function));
    const statusListener = on.mock.calls[1][1] as (_event: unknown, status: unknown) => void;
    statusListener(undefined, { state: 'downloaded' });
    expect(statusCallback).toHaveBeenCalledWith({ state: 'downloaded' });
    disposeStatus();
    expect(removeListener).toHaveBeenCalledWith('update-status', statusListener);
  });

  it('normalizes requested routes without widening the reviewed route set', () => {
    const createWindow = vi.fn();
    const handler = loadIpcHandler<(route: string, context?: unknown) => void>('open-route-window', {
      createWindow,
      isRecord: (value: unknown) => typeof value === 'object' && value !== null,
      trustedIpc: (candidate: unknown) => candidate,
      validRoutes: new Set(['floor', 'table', 'builder', 'profiles', 'signals', 'summary', 'customization', 'kpis', 'tournaments', 'tournament-tv', 'pilot', 'outreach'])
    });

    handler('outreach', { source: 'signals' });
    handler('table', { sessionId: 'session-1' });
    handler('unknown', {});
    expect(createWindow.mock.calls).toEqual([
      ['signals', { source: 'signals' }],
      ['table', { sessionId: 'session-1' }],
      ['floor', {}]
    ]);
  });

  it('requires manager authorization, chooses a destination before rotation, and keeps the capability out of IPC results', async () => {
    expect(electronMainSource).toContain(
      'loadStateForAccess: (access) => peekStateFromApi(getAccountKeyFromAccess(access), access)'
    );
    const authorization = vi.fn().mockReturnValue({ ok: true, accountKey: 'club-one', staffId: 'manager-one', role: 'Manager' });
    const peekStateFromApi = vi.fn().mockResolvedValue({
      authoritative: true,
      state: { settings: { clubAccount: { clubName: 'Orbit Room' } } }
    });
    const selectSelfCheckInPdfDestination = vi.fn().mockResolvedValue({ ok: true, filePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf' });
    const createSelfCheckInQrKitApi = vi.fn().mockResolvedValue({
      ok: true,
      clubName: 'Orbit Room',
      checkInUrl: 'https://check-in.example.test/check-in#token=renderer-secret',
      expiresAt: '2027-08-24T12:00:00.000Z',
      selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T12:00:00.000Z' },
      rotatedPreviousCode: true
    });
    const createSelfCheckInPdf = vi.fn().mockResolvedValue({ ok: true, filePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf' });
    const sendClientEvent = vi.fn();
    const handler = loadIpcHandler<(payload: unknown) => Promise<Record<string, unknown>>>('generate-self-check-in-kit', {
      boundedPayload: (value: unknown) => value,
      createSelfCheckInPdf,
      createSelfCheckInQrKitApi,
      getAccountKeyFromAccess: () => 'club-one',
      peekStateFromApi,
      selectSelfCheckInPdfDestination,
      sendClientEvent,
      staffAuthorization: { authorize: authorization },
      String,
      trustedIpc: (candidate: unknown) => candidate
    });

    const result = await handler({ access: { licenseId: 'club-one' }, staffToken: 'staff-token' });

    expect(authorization).toHaveBeenCalledWith({ token: 'staff-token', action: 'staff-admin' });
    expect(selectSelfCheckInPdfDestination).toHaveBeenCalledWith('Orbit Room');
    expect(selectSelfCheckInPdfDestination.mock.invocationCallOrder[0]).toBeLessThan(createSelfCheckInQrKitApi.mock.invocationCallOrder[0]);
    expect(createSelfCheckInPdf).toHaveBeenCalledWith(expect.objectContaining({
      checkInUrl: expect.stringContaining('renderer-secret')
    }), { outputFilePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf' });
    expect(result).toEqual({
      ok: true,
      filePath: 'C:\\safe\\Orbit-Room-self-check-in.pdf',
      error: undefined,
      selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T12:00:00.000Z' },
      rotatedPreviousCode: true
    });
    expect(JSON.stringify(result)).not.toContain('renderer-secret');

    selectSelfCheckInPdfDestination.mockResolvedValueOnce({ ok: false, canceled: true });
    await expect(handler({ access: { licenseId: 'club-one' }, staffToken: 'staff-token' })).resolves.toEqual({
      ok: false,
      canceled: true
    });
    expect(peekStateFromApi).toHaveBeenCalledTimes(2);
    expect(createSelfCheckInQrKitApi).toHaveBeenCalledOnce();

    authorization.mockReturnValueOnce({ ok: false, error: 'Staff reauthentication is required.' });
    await expect(handler({ access: { licenseId: 'club-one' }, staffToken: 'expired' })).resolves.toEqual({
      ok: false,
      error: 'Staff reauthentication is required.'
    });
  });
});

describe('Electron window and navigation composition audit', () => {
  it('opens only allowlisted HTTPS/mailto links and ignores malformed or untrusted protocols', () => {
    const openExternal = vi.fn();
    const openTrustedExternal = loadFunction<(url: string) => void>('openTrustedExternal', { URL, shell: { openExternal } });

    for (const url of ['https://orbitpoker.com/path', 'mailto:ops@orbitpoker.com']) {
      openTrustedExternal(url);
    }
    for (const url of ['https://example.test/path', 'http://orbitpoker.com/path', 'mailto:ops@example.test', 'javascript:alert(1)', 'ftp://example.test/file', 'not a url']) {
      openTrustedExternal(url);
    }

    expect(openExternal.mock.calls.map((call) => call[0])).toEqual([
      'https://orbitpoker.com/path',
      'mailto:ops@orbitpoker.com'
    ]);
  });

  it('loads exact encoded route hashes in development and packaged modes', () => {
    const devWindow = { loadURL: vi.fn(), loadFile: vi.fn() };
    const loadDevRoute = loadFunction<(window: typeof devWindow, route: string, context?: Record<string, string>) => void>('loadRoute', {
      __dirname: 'C:\\repo\\electron',
      encodeURIComponent,
      isDev: true,
      path
    });
    loadDevRoute(devWindow, 'table', { sessionId: 'session / one' });
    expect(devWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/#/table?sessionId=session%20%2F%20one');
    expect(devWindow.loadFile).not.toHaveBeenCalled();

    const packagedWindow = { loadURL: vi.fn(), loadFile: vi.fn() };
    const loadPackagedRoute = loadFunction<typeof loadDevRoute>('loadRoute', {
      __dirname: 'C:\\repo\\electron',
      encodeURIComponent,
      isDev: false,
      path
    });
    loadPackagedRoute(packagedWindow, 'tournament-tv', { tournamentId: 'event #1' });
    expect(packagedWindow.loadFile).toHaveBeenCalledWith(path.join('C:\\repo\\electron', '..', 'dist', 'index.html'), {
      hash: '/tournament-tv?tournamentId=event%20%231'
    });
  });

  it('opens Tournament TV with native window chrome instead of forcing fullscreen', () => {
    let browserOptions: Record<string, unknown> | undefined;
    let readyToShow: (() => void) | undefined;
    const webContents = {
      getURL: vi.fn().mockReturnValue('file:///C:/repo/dist/index.html#/tournament-tv'),
      on: vi.fn(),
      openDevTools: vi.fn(),
      setWindowOpenHandler: vi.fn()
    };
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      maximize: vi.fn(),
      on: vi.fn(),
      once: vi.fn((event: string, callback: () => void) => {
        if (event === 'ready-to-show') readyToShow = callback;
      }),
      removeMenu: vi.fn(),
      setFullScreen: vi.fn(),
      setMenuBarVisibility: vi.fn(),
      show: vi.fn(),
      webContents
    };
    const BrowserWindow = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
      browserOptions = options;
      return window;
    });
    const loadRoute = vi.fn();
    const createWindow = loadFunction<(route?: string, context?: Record<string, string>) => typeof window>('createWindow', {
      BrowserWindow,
      __dirname: 'C:\\repo\\electron',
      branding: {
        product: { name: 'Orbit' },
        desktop: { backgroundColor: '#000000', windowTitles: {} }
      },
      isDev: false,
      loadRoute,
      openTrustedExternal: vi.fn(),
      path,
      sendClientError: vi.fn(),
      windows: new Map<string, typeof window>()
    });

    expect(createWindow('tournament-tv', { tournamentId: 'event-1' })).toBe(window);
    expect(browserOptions).toMatchObject({
      width: 1280,
      height: 720,
      minWidth: 960,
      minHeight: 540,
      title: 'Tournament TV',
      frame: true,
      autoHideMenuBar: true,
      titleBarStyle: 'default'
    });
    expect(window.setMenuBarVisibility).toHaveBeenCalledWith(false);
    expect(window.removeMenu).toHaveBeenCalledOnce();
    expect(loadRoute).toHaveBeenCalledWith(window, 'tournament-tv', { tournamentId: 'event-1' });

    expect(readyToShow).toBeTypeOf('function');
    readyToShow?.();
    expect(window.setFullScreen).not.toHaveBeenCalled();
    expect(window.maximize).not.toHaveBeenCalled();
    expect(window.show).toHaveBeenCalledOnce();
  });

  it('creates sandboxed isolated windows, denies child windows, and blocks navigation outside the local allowlist', () => {
    let browserOptions: Record<string, unknown> | undefined;
    let windowOpenHandler: ((details: { url: string }) => unknown) | undefined;
    const webContentsListeners = new Map<string, (...args: unknown[]) => void>();
    const windowListeners = new Map<string, (...args: unknown[]) => void>();
    const webContents = {
      getURL: vi.fn().mockReturnValue('file:///C:/repo/dist/index.html#/floor'),
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => webContentsListeners.set(event, callback)),
      openDevTools: vi.fn(),
      setWindowOpenHandler: vi.fn((callback: (details: { url: string }) => unknown) => { windowOpenHandler = callback; })
    };
    const window = {
      focus: vi.fn(),
      isDestroyed: () => false,
      maximize: vi.fn(),
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => windowListeners.set(event, callback)),
      once: vi.fn((event: string, callback: (...args: unknown[]) => void) => windowListeners.set(event, callback)),
      removeMenu: vi.fn(),
      setFullScreen: vi.fn(),
      setMenuBarVisibility: vi.fn(),
      show: vi.fn(),
      webContents
    };
    const BrowserWindow = vi.fn(function BrowserWindowConstructor(options: Record<string, unknown>) {
      browserOptions = options;
      return window;
    });
    const openTrustedExternal = vi.fn();
    const loadRoute = vi.fn();
    const windows = new Map<string, typeof window>();
    const branding = {
      product: { name: 'Orbit' },
      desktop: {
        backgroundColor: '#000000',
        windowTitles: {
          floor: 'Orbit', builder: 'Builder', profiles: 'Profiles', signals: 'Signals', summary: 'Summary',
          customization: 'Customization', kpis: 'KPIs', pilot: 'Pilot'
        }
      }
    };
    const createWindow = loadFunction<(route?: string, context?: Record<string, string>) => typeof window>('createWindow', {
      BrowserWindow,
      __dirname: 'C:\\repo\\electron',
      branding,
      isDev: false,
      loadRoute,
      openTrustedExternal,
      path,
      sendClientError: vi.fn(),
      windows
    });

    expect(createWindow('floor')).toBe(window);
    expect(browserOptions).toMatchObject({
      show: false,
      webPreferences: {
        preload: path.join('C:\\repo\\electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    expect(loadRoute).toHaveBeenCalledWith(window, 'floor', {});

    expect(windowOpenHandler?.({ url: 'https://example.test' })).toEqual({ action: 'deny' });
    expect(openTrustedExternal).toHaveBeenCalledWith('https://example.test');

    const willNavigate = webContentsListeners.get('will-navigate');
    if (!willNavigate) throw new Error('will-navigate handler was not registered.');
    const preventDefault = vi.fn();
    willNavigate({ preventDefault }, 'file:///C:/repo/other.html');
    willNavigate({ preventDefault }, 'http://127.0.0.1:5173/#/floor');
    willNavigate({ preventDefault }, 'file:///C:/repo/dist/index.html#/floor');
    expect(preventDefault).not.toHaveBeenCalled();

    willNavigate({ preventDefault }, 'https://example.test/redirect');
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openTrustedExternal).toHaveBeenLastCalledWith('https://example.test/redirect');

    expect(createWindow('floor')).toBe(window);
    expect(window.focus).toHaveBeenCalledOnce();
    expect(BrowserWindow).toHaveBeenCalledOnce();
  });
});
