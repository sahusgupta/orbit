/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../domain/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  root: undefined as { unmount: () => void } | undefined
}));

const desktop = vi.hoisted(() => ({
  authorizeStaffAction: vi.fn(async (): Promise<{
    ok: boolean;
    error?: string;
    reauthenticate?: boolean;
  }> => ({ ok: true })),
  generateSelfCheckInKit: vi.fn(async () => ({ ok: false, error: 'Unexpected QR generation call.' })),
  getBackendStatus: vi.fn(async () => ({
    running: true,
    host: '127.0.0.1',
    port: 4629,
    reportCount: 0,
    mode: 'test'
  })),
  loadState: vi.fn(async () => null),
  recordClientEvent: vi.fn(async () => ({ ok: true })),
  saveState: vi.fn(async (_state: unknown) => ({
    ok: true,
    path: 'test',
    publication: { status: 'pending' }
  })),
  verifyStaffPin: vi.fn(async () => ({
    ok: true,
    token: 'floor-session-token',
    staffId: 'staff-floor',
    role: 'Floor' as const,
    accountKey: 'staff-bootstrap-license',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
  }))
}));

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

vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable.');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('staff administrator bootstrap', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.location.hash = '#settings';
    localStorage.setItem('table-manager-state-v1', JSON.stringify({
      settings: {
        clubAccount: { clubName: 'Bootstrap Fixture Club' },
        pilotAccess: {
          activatedAt: '2026-08-26T12:00:00.000Z',
          authorizationCode: 'STAFF-BOOTSTRAP-AUTH',
          authorized: true,
          expiresAt,
          issuedTo: 'Staff Bootstrap Fixture Club',
          licenseId: 'STAFF-BOOTSTRAP-LICENSE'
        },
        accountLogin: { username: 'bootstrap@example.test' },
        staffAccounts: [{
          id: 'staff-floor',
          name: 'Sahus',
          role: 'Floor',
          pinSalt: 'floor-salt',
          pinHash: 'floor-hash',
          active: true,
          createdAt: '2026-08-26T11:00:00.000Z'
        }]
      }
    }));
    localStorage.setItem(
      'table-manager-state-v1:auth:staff-bootstrap-license',
      JSON.stringify({ expiresAt })
    );
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    Reflect.set(window, 'tableManagerDesktop', desktop);
    await act(async () => {
      await import('../components/SettingsView');
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    document.body.innerHTML = '';
  });

  it('creates the first Owner from a Floor-only account without a native authorization dead end', async () => {
    let staffTab: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      staffTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button')).find(
        (button) => button.textContent === 'Staff'
      );
      expect(staffTab).toBeDefined();
    });
    expect(staffTab).toBeDefined();
    act(() => staffTab!.click());

    const form = document.querySelector<HTMLFormElement>('.staff-account-form');
    const name = form?.querySelector<HTMLInputElement>('input[placeholder="Staff name"]');
    const role = form?.querySelector<HTMLSelectElement>('select');
    const pin = form?.querySelector<HTMLInputElement>('input[placeholder="PIN"]');
    expect(form).not.toBeNull();
    expect(name).not.toBeNull();
    expect(role).not.toBeNull();
    expect(pin).not.toBeNull();

    await act(async () => {
      setInputValue(name!, 'SKG');
      role!.value = 'Owner';
      role!.dispatchEvent(new Event('change', { bubbles: true }));
      setInputValue(pin!, '4821');
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('#settings-staff button[aria-label="Deactivate SKG"]')).not.toBeNull();
    });
    expect(desktop.authorizeStaffAction).not.toHaveBeenCalled();
    expect(globalThis.alert).not.toHaveBeenCalled();
    expect(document.querySelector('#settings-staff [role="status"]')?.textContent).toBe('Staff account added.');
    const saved = desktop.saveState.mock.calls.at(-1)?.[0] as AppState | undefined;
    expect(saved?.settings.staffAccounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'SKG', role: 'Owner', active: true })
    ]));

    await act(async () => {
      setInputValue(name!, 'Another Floor');
      setInputValue(pin!, '8642');
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('#settings-staff [role="alert"]')?.textContent).toBe(
        'Select and verify an Owner or Manager before this action.'
      );
    });
    expect(document.querySelector('#settings-staff button[aria-label="Deactivate Another Floor"]')).toBeNull();
    expect(globalThis.alert).not.toHaveBeenCalled();

    const operatorSelect = document.querySelector<HTMLSelectElement>('#settings-staff .preference-row select');
    expect(operatorSelect).not.toBeNull();
    await act(async () => {
      operatorSelect!.value = 'staff-floor';
      operatorSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    const verificationDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const verificationPin = verificationDialog?.querySelector<HTMLInputElement>('input[name="staff-pin"]');
    const verificationForm = verificationDialog?.querySelector<HTMLFormElement>('form');
    expect(verificationPin).not.toBeNull();
    expect(verificationForm).not.toBeNull();
    await act(async () => {
      setInputValue(verificationPin!, '4821');
      verificationForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(operatorSelect!.value).toBe('staff-floor'));

    desktop.authorizeStaffAction.mockResolvedValueOnce({
      ok: false,
      error: 'Select and verify an Owner or Manager for this action.',
      reauthenticate: false
    });
    const clubTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button')).find(
      (button) => button.textContent === 'Club & license'
    );
    expect(clubTab).toBeDefined();
    act(() => clubTab!.click());
    const qrButton = Array.from(document.querySelectorAll<HTMLButtonElement>('#settings-club button')).find(
      (button) => button.textContent?.includes('Generate QR PDF')
    );
    expect(qrButton).toBeDefined();
    await act(async () => {
      qrButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('#settings-club')?.textContent).toContain(
        'Select and verify an Owner or Manager for this action.'
      );
    });
    expect(document.querySelector('#settings-club .access-error')?.textContent).toBe(
      'Select and verify an Owner or Manager for this action.'
    );
    expect(operatorSelect!.value).toBe('staff-floor');
    expect(document.querySelector('.orbit-account-summary strong')?.textContent).toBe('Sahus');
    expect(desktop.generateSelfCheckInKit).not.toHaveBeenCalled();
    expect(globalThis.alert).not.toHaveBeenCalled();
  });
});
