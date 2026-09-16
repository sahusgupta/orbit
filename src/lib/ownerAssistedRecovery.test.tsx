/** @vitest-environment jsdom */
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeState, seedState } from '../domain/state';
import type { AppState } from '../domain/types';

const harness = vi.hoisted(() => ({
  initialState: undefined as AppState | undefined,
  latestState: undefined as AppState | undefined,
  root: undefined as { unmount: () => void } | undefined,
  setState: undefined as unknown,
  saveState: vi.fn(async () => ({ ok: true, path: 'fixture' })),
  saveBrowserState: vi.fn(),
  persistSignIn: vi.fn(async () => true),
  completeRecovery: vi.fn(),
  setPilotKeyError: vi.fn()
}));

const isAppState = (value: unknown): value is AppState =>
  typeof value === 'object' && value !== null &&
  Array.isArray(Reflect.get(value, 'games')) &&
  Array.isArray(Reflect.get(value, 'profiles')) &&
  typeof Reflect.get(value, 'settings') === 'object' && Reflect.get(value, 'settings') !== null;
const replaceCurrentState = (state: AppState) => {
  if (typeof harness.setState !== 'function') throw new Error('Expected App state setter');
  harness.setState(state);
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initial);
      const value: unknown = result[0];
      if (isAppState(value)) {
        // AppState is the only application state with these collection fields.
        harness.latestState = value;
        harness.setState = result[1];
      }
      return result;
    }
  };
});
vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment) {
      const root = actual.createRoot(container);
      harness.root = root;
      return root;
    }
  };
});
vi.mock('../app/persistence/managementPersistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('../app/persistence/managementPersistence')>(),
  loadManagementState: () => harness.initialState
}));
vi.mock('../app/persistence/browserStateRepository', async (importOriginal) => ({
  ...await importOriginal<typeof import('../app/persistence/browserStateRepository')>(),
  saveBrowserManagementState: harness.saveBrowserState
}));
vi.mock('../domain/licensing', async (importOriginal) => ({
  ...await importOriginal<typeof import('../domain/licensing')>(),
  persistSignIn: harness.persistSignIn
}));
vi.mock('../features/settings/settingsWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/settings/settingsWorkspace')>();
  return {
    ...actual,
    useSettingsWorkspaceState(state: AppState) {
      return {
        ...actual.useSettingsWorkspaceState(state),
        hasAuthenticated: false,
        passwordRecoveryStage: 'owner-ready',
        loginDraft: { username: 'owner@example.com', password: 'fixture-long-password', staySignedIn: false },
        setPilotKeyError: harness.setPilotKeyError
      };
    }
  };
});
vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

const currentState = () => normalizeState({
  ...seedState,
  settings: {
    ...seedState.settings,
    pilotAccess: { authorized: true, authorizationCode: 'fixture-access', activatedAt: '2026-09-01', expiresAt: '2099-01-01', licenseId: 'lic_fixture' },
    accountLogin: { username: 'owner@example.com', passwordSalt: 'old-salt', passwordHash: 'old-hash', createdAt: '2026-07-01' }
  }
});
const serverState = () => {
  const state = currentState();
  state.settings.accountLogin = { username: 'owner@example.com', passwordSalt: 'new-salt', passwordHash: 'new-hash', createdAt: '2026-07-01' };
  state.revenueTransactions = [{ id: 'server-payment', type: 'membership', amountCents: 3000, occurredAt: '2026-09-01', paymentStatus: 'paid', source: 'manual' }];
  return state;
};
const submitRecovery = async () => {
  const form = document.querySelector('form.account-form');
  if (!form) throw new Error('Expected recovery form');
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
};

describe('owner-assisted recovery renderer submission', () => {
  beforeAll(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = '#access';
    harness.initialState = currentState();
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => null),
      loadStateForAccount: vi.fn(async () => null),
      saveState: harness.saveState,
      completeManagementRecovery: harness.completeRecovery,
      onPrepareForUpdate: vi.fn(() => () => undefined),
      recordClientError: vi.fn(async () => ({ ok: true })),
      recordClientEvent: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: false, active: true }))
    });
    await act(async () => { await import('../main'); });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    harness.persistSignIn.mockImplementation(async () => true);
    const authoritative = serverState();
    harness.completeRecovery.mockResolvedValue({ ok: true, accountKey: 'lic_fixture', revision: 8, accountLogin: authoritative.settings.accountLogin, state: authoritative });
    await act(async () => { replaceCurrentState(currentState()); });
    harness.saveState.mockClear();
    harness.saveBrowserState.mockClear();
  });
  afterAll(() => {
    act(() => harness.root?.unmount());
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('adopts server data in memory without a full server-state save', async () => {
    await submitRecovery();
    expect(harness.completeRecovery).toHaveBeenCalledOnce();
    expect(harness.latestState?.revenueTransactions).toEqual(serverState().revenueTransactions);
    expect(harness.latestState?.settings.accountLogin?.passwordHash).toBe('new-hash');
    expect(harness.saveBrowserState).toHaveBeenCalledOnce();
    expect(harness.saveState).not.toHaveBeenCalled();
  });

  it('does not adopt a recovery result after switching accounts during sign-in persistence', async () => {
    let finishSignIn: ((value: boolean) => void) | undefined;
    harness.persistSignIn.mockImplementation(() => new Promise<boolean>((resolve) => { finishSignIn = resolve; }));
    await submitRecovery();
    expect(harness.persistSignIn).toHaveBeenCalledOnce();
    const otherAccount = currentState();
    if (!otherAccount.settings.pilotAccess) throw new Error('Expected fixture access');
    otherAccount.settings.pilotAccess = { ...otherAccount.settings.pilotAccess, licenseId: 'lic_other' };
    await act(async () => { replaceCurrentState(otherAccount); });
    // Account selection has its own initialization effects; measure only the
    // resumed recovery handler after that separate transition has settled.
    harness.saveState.mockClear();
    harness.saveBrowserState.mockClear();
    await act(async () => { finishSignIn?.(true); });
    expect(harness.latestState?.settings.pilotAccess?.licenseId).toBe('lic_other');
    expect(harness.latestState?.revenueTransactions).toEqual([]);
    expect(harness.saveBrowserState).not.toHaveBeenCalled();
    expect(harness.saveState).not.toHaveBeenCalled();
    expect(harness.setPilotKeyError).toHaveBeenCalledWith(expect.stringContaining('active account'));
  });

  it('preserves newer same-account data received during sign-in persistence', async () => {
    let finishSignIn: ((value: boolean) => void) | undefined;
    harness.persistSignIn.mockImplementation(() => new Promise<boolean>((resolve) => { finishSignIn = resolve; }));
    await submitRecovery();
    expect(harness.persistSignIn).toHaveBeenCalledOnce();
    const newerState = serverState();
    newerState.revenueTransactions.push({ id: 'newer-server-payment', type: 'membership', amountCents: 4500, occurredAt: '2026-09-16', paymentStatus: 'paid', source: 'manual' });
    await act(async () => { replaceCurrentState(newerState); });
    harness.saveState.mockClear();
    harness.saveBrowserState.mockClear();

    await act(async () => { finishSignIn?.(true); });

    expect(harness.latestState?.settings.pilotAccess?.licenseId).toBe('lic_fixture');
    expect(harness.latestState?.revenueTransactions).toEqual(newerState.revenueTransactions);
    expect(harness.saveBrowserState).not.toHaveBeenCalled();
    expect(harness.saveState).not.toHaveBeenCalled();
    expect(harness.setPilotKeyError).toHaveBeenCalledWith(expect.stringContaining('Reload the account'));
  });

  it('preserves newer same-account data received while the recovery request is pending', async () => {
    const authoritative = serverState();
    const recoveryResult = { ok: true, accountKey: 'lic_fixture', revision: 8, accountLogin: authoritative.settings.accountLogin, state: authoritative };
    let finishRecovery: ((value: typeof recoveryResult) => void) | undefined;
    harness.completeRecovery.mockImplementation(() => new Promise<typeof recoveryResult>((resolve) => { finishRecovery = resolve; }));
    await submitRecovery();
    expect(harness.completeRecovery).toHaveBeenCalledOnce();
    expect(harness.persistSignIn).not.toHaveBeenCalled();
    const newerState = serverState();
    newerState.revenueTransactions.push({ id: 'newer-server-payment', type: 'membership', amountCents: 4500, occurredAt: '2026-09-16', paymentStatus: 'paid', source: 'manual' });
    await act(async () => { replaceCurrentState(newerState); });
    harness.saveState.mockClear();
    harness.saveBrowserState.mockClear();

    await act(async () => { finishRecovery?.(recoveryResult); });

    expect(harness.latestState?.revenueTransactions).toEqual(newerState.revenueTransactions);
    expect(harness.persistSignIn).not.toHaveBeenCalled();
    expect(harness.saveBrowserState).not.toHaveBeenCalled();
    expect(harness.saveState).not.toHaveBeenCalled();
    expect(harness.setPilotKeyError).toHaveBeenCalledWith(expect.stringContaining('Reload the account'));
  });
});
