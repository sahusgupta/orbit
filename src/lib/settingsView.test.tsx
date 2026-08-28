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
  root: undefined as { unmount: () => void } | undefined,
  blobs: [] as Array<{ parts: BlobPart[]; type: string }>,
  downloads: [] as Array<{ fileName: string; href: string }>,
  startupLoadResolvers: [] as Array<(value: unknown) => void>
}));

const desktop = vi.hoisted(() => ({
  authorizeStaffAction: vi.fn(async () => ({ ok: true })),
  generateSelfCheckInKit: vi.fn(async () => ({
    ok: true,
    filePath: 'C:\\Prints\\Orbit-self-check-in.pdf',
    selfCheckIn: {
      capabilityGeneration: 'settings-test-generation',
      generatedAt: '2026-08-26T12:00:00.000Z'
    }
  })),
  getBackendStatus: vi.fn(async () => ({
    running: true,
    host: '127.0.0.1',
    port: 4629,
    reportCount: 0,
    mode: 'test'
  })),
  loadState: vi.fn(),
  recordClientEvent: vi.fn(async () => ({ ok: true })),
  saveState: vi.fn(async (_state: unknown) => ({ ok: true, path: 'test', publication: { status: 'pending' } })),
  verifyStaffPin: vi.fn(async () => ({
    ok: true,
    token: 'settings-staff-token',
    staffId: 'settings-manager',
    role: 'Manager' as const,
    accountKey: 'ref-006g-license',
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

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Input value setter is unavailable.');
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('settings route rendering', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    window.location.hash = '#settings';
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        games: [
          {
            id: 'nlh-1-2',
            name: '1/2 NLH',
            maxSeats: 10,
            minInRoomForLikely: 6,
            minFlexibleForLikely: 2,
            minTotalForViable: 8
          }
        ],
        settings: {
          clubAccount: { clubName: 'Settings Fixture Club' },
          pilotAccess: {
            activatedAt: '2026-08-07T12:00:00.000Z',
            authorizationCode: 'REF-006G-AUTH',
            authorized: true,
            expiresAt,
            issuedTo: 'REF-006G Fixture Club',
            licenseId: 'REF-006G-LICENSE'
          },
          accountLogin: { username: 'ref-006g@example.test' },
          staffAccounts: [{
            id: 'settings-manager',
            name: 'Settings Manager',
            role: 'Manager',
            pinSalt: 'settings-salt',
            pinHash: 'settings-hash',
            active: true,
            createdAt: '2026-08-26T11:00:00.000Z'
          }]
        }
      })
    );
    localStorage.setItem('table-manager-state-v1:auth:ref-006g-license', JSON.stringify({ expiresAt }));
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    class TestBlob {
      readonly parts: BlobPart[];
      readonly type: string;

      constructor(parts: BlobPart[], options?: BlobPropertyBag) {
        this.parts = parts;
        this.type = options?.type ?? '';
        harness.blobs.push(this);
      }
    }
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:settings-export');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('Blob', TestBlob);
    vi.stubGlobal('URL', TestUrl);
    vi.stubGlobal('alert', vi.fn());
    desktop.loadState.mockImplementation(() => new Promise((resolve) => {
      harness.startupLoadResolvers.push(resolve);
    }));
    Reflect.set(window, 'tableManagerDesktop', desktop);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      harness.downloads.push({ fileName: this.download, href: this.href });
    });
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

  it('renders the settings navigation, panel order, and account controls', () => {
    expect(document.querySelector('h1')?.textContent).toBe('Settings');
    expect(document.querySelector('.page-subtitle')?.textContent).toBe(
      'Club, staff, tables, data, display, and legal information'
    );
    expect(document.querySelector('.topbar > button')?.textContent?.trim()).toBe('Close');

    const settingsNav = document.querySelector('.settings-nav');
    expect(settingsNav?.getAttribute('aria-label')).toBe('Settings sections');
    expect(Array.from(settingsNav?.querySelectorAll('button') ?? [], (button) => button.textContent)).toEqual([
      'Club & license',
      'Staff',
      'Tables & fees',
      'Data',
      'Display',
      'Legal & support'
    ]);
    expect(settingsNav?.querySelector('button.active')?.textContent).toBe('Club & license');

    expect(Array.from(document.querySelectorAll('.settings-panel h2'), (heading) => heading.textContent)).toEqual([
      'Account & License',
      'Staff Accounts',
      'Data Safety',
      'Table Defaults',
      'Display',
      'Legal & Support'
    ]);
    expect(Array.from(document.querySelectorAll('#settings-club > .preference-list > .account-management-form > input'), (input) => input.getAttribute('placeholder'))).toEqual([
      'Club name',
      'Account name',
      'Primary contact',
      'Email',
      'Phone',
      'Address'
    ]);
    expect(document.querySelector('#settings-club > .preference-list > .account-management-form > button')?.textContent?.trim()).toBe('Save Account');
    expect(document.querySelector('#settings-club')?.textContent).toContain('Player self-check-in QR');
    expect(Array.from(document.querySelectorAll('#settings-club button')).some((button) => button.textContent?.includes('Generate QR PDF'))).toBe(true);
    expect(document.querySelector('.membership-plan-heading button')?.textContent?.trim()).toBe('Add plan');

    const staffPin = document.querySelector<HTMLInputElement>('.staff-account-form input[type="password"]');
    expect(staffPin).toMatchObject({ inputMode: 'numeric', minLength: 4, maxLength: 12 });
    expect(staffPin?.pattern).toBe('[0-9]{4,12}');
  });

  it('leaves the operator unchanged when the in-app PIN dialog is canceled', async () => {
    desktop.verifyStaffPin.mockClear();
    const staffTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button')).find(
      (button) => button.textContent === 'Staff'
    );
    expect(staffTab).toBeDefined();
    act(() => staffTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('.settings-nav button.active')?.textContent).toBe('Staff');

    const staffSelect = document.querySelector<HTMLSelectElement>('#settings-staff .preference-row select');
    expect(staffSelect).not.toBeNull();
    await act(async () => {
      staffSelect!.value = 'settings-manager';
      staffSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Verify Settings Manager');
    expect(document.querySelector('.command-overlay')).not.toBeNull();

    const verificationPin = dialog?.querySelector<HTMLInputElement>('input[name="staff-pin"]');
    expect(verificationPin).not.toBeNull();
    await act(async () => {
      setInputValue(verificationPin!, '4821');
      await Promise.resolve();
    });
    expect(verificationPin!.value).toBe('4821');

    const staffName = document.querySelector<HTMLInputElement>('.staff-account-form input[placeholder="Staff name"]');
    expect(staffName).not.toBeNull();

    const cancelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent === 'Cancel'
    );
    if (cancelButton) {
      await act(async () => {
        cancelButton.click();
        await Promise.resolve();
      });
    }

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe('none');
    expect(staffSelect!.value).toBe('');
    expect(desktop.verifyStaffPin).not.toHaveBeenCalled();

    await act(async () => {
      staffName!.focus();
      setInputValue(staffName!, 'Still editable');
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(staffName);
    expect(staffName!.value).toBe('Still editable');

    await act(async () => {
      setInputValue(staffName!, '');
      await Promise.resolve();
    });
  });

  it('selects staff through the in-app PIN dialog and carries the trusted token into QR generation', async () => {
    desktop.verifyStaffPin.mockClear();
    desktop.authorizeStaffAction.mockClear();
    desktop.generateSelfCheckInKit.mockClear();

    const staffTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button')).find(
      (button) => button.textContent === 'Staff'
    );
    expect(staffTab).toBeDefined();
    act(() => staffTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const staffSelect = document.querySelector<HTMLSelectElement>('#settings-staff .preference-row select');
    expect(staffSelect).not.toBeNull();
    await act(async () => {
      staffSelect!.value = 'settings-manager';
      staffSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Verify Settings Manager');
    expect(staffSelect!.value).toBe('settings-manager');
    const pinInput = dialog?.querySelector<HTMLInputElement>('input[name="staff-pin"]');
    expect(pinInput).not.toBeNull();
    await act(async () => {
      setInputValue(pinInput!, '4821');
      await Promise.resolve();
    });
    const pinForm = dialog?.querySelector<HTMLFormElement>('form');
    expect(pinForm).not.toBeNull();
    await act(async () => {
      pinForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(desktop.verifyStaffPin).toHaveBeenCalledWith({
          staffId: 'settings-manager',
          pin: '4821',
          access: expect.objectContaining({ licenseId: 'REF-006G-LICENSE' })
        });
        expect(staffSelect!.value).toBe('settings-manager');
        expect(document.querySelector('.orbit-account-summary strong')?.textContent).toBe('Settings Manager');
      });
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe('none');

    const selectedState = desktop.saveState.mock.calls.at(-1)?.[0] as AppState | undefined;
    expect(selectedState).toMatchObject({
      settings: { activeStaffId: 'settings-manager' }
    });
    const startupRecord = {
      authoritative: true,
      savedAt: '2026-08-26T14:00:00.000Z',
      schemaVersion: 4,
      state: selectedState
        ? {
            ...selectedState,
            settings: {
              ...selectedState.settings,
              activeStaffId: undefined,
              clubAccount: {
                ...selectedState.settings.clubAccount!,
                clubName: 'Stale Startup Club'
              }
            }
          }
        : selectedState
    };
    await act(async () => {
      harness.startupLoadResolvers.splice(0).forEach((resolve) => resolve(startupRecord));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(staffSelect!.value).toBe('settings-manager');
      expect(document.querySelector('.orbit-account-summary strong')?.textContent).toBe('Settings Manager');
    });
    expect(document.querySelector<HTMLInputElement>('#settings-club input[placeholder="Club name"]')?.value)
      .toBe('Settings Fixture Club');

    const staffForm = document.querySelector<HTMLFormElement>('.staff-account-form');
    const staffName = staffForm?.querySelector<HTMLInputElement>('input[placeholder="Staff name"]');
    const staffRole = staffForm?.querySelector<HTMLSelectElement>('select');
    const staffPin = staffForm?.querySelector<HTMLInputElement>('input[placeholder="PIN"]');
    expect(staffForm).not.toBeNull();
    expect(staffName).not.toBeNull();
    expect(staffRole).not.toBeNull();
    expect(staffPin).not.toBeNull();
    await act(async () => {
      setInputValue(staffName!, 'Second Owner');
      staffRole!.value = 'Owner';
      staffRole!.dispatchEvent(new Event('change', { bubbles: true }));
      setInputValue(staffPin!, '8642');
      await Promise.resolve();
    });
    expect(staffName!.value).toBe('Second Owner');
    expect(staffRole!.value).toBe('Owner');
    expect(staffPin!.value).toBe('8642');
    await act(async () => {
      staffForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => {
        expect(desktop.authorizeStaffAction).toHaveBeenCalledWith({
          token: 'settings-staff-token',
          action: 'staff-admin'
        });
      }, { timeout: 2_000 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('#settings-staff button[aria-label="Deactivate Second Owner"]')).not.toBeNull();
    expect(staffName!.value).toBe('');
    expect(staffRole!.value).toBe('Floor');
    expect(staffPin!.value).toBe('');

    const clubTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.settings-nav button')).find(
      (button) => button.textContent === 'Club & license'
    );
    expect(clubTab).toBeDefined();
    act(() => clubTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const qrButton = Array.from(document.querySelectorAll<HTMLButtonElement>('#settings-club button')).find(
      (button) => button.textContent?.includes('Generate QR PDF')
    );
    expect(qrButton).toBeDefined();
    await act(async () => {
      qrButton!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(desktop.authorizeStaffAction).toHaveBeenCalledWith({
          token: 'settings-staff-token',
          action: 'staff-admin'
        });
        expect(desktop.generateSelfCheckInKit).toHaveBeenCalledWith({
          access: expect.objectContaining({ licenseId: 'REF-006G-LICENSE' }),
          staffToken: 'settings-staff-token'
        });
      });
    });
  });

  it('keeps portable room data separate from the restorable backup and downloads the sanitized export', () => {
    const dataTab = Array.from(document.querySelectorAll('.settings-nav button')).find((button) => button.textContent === 'Data');
    expect(dataTab).toBeDefined();
    act(() => dataTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(document.querySelector('.settings-nav button.active')?.textContent).toBe('Data');
    const dataActions = Array.from(
      document.querySelectorAll('#settings-data .preference-row button'),
      (button) => button.textContent?.replace(/\s+/g, ' ').trim()
    );
    expect(dataActions.slice(0, 2)).toEqual(['Export Room Data', 'Export Restorable Backup']);
    expect(document.querySelector('#settings-data')?.textContent).toContain('Passwords, staff PINs, and license key material are excluded.');
    expect(document.querySelector('#settings-data')?.textContent).toContain('Store this backup securely.');

    const exportButton = Array.from(document.querySelectorAll('#settings-data button')).find(
      (button) => button.textContent?.includes('Export Room Data')
    );
    expect(exportButton).toBeDefined();
    act(() => exportButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(harness.downloads.at(-1)).toEqual({
      fileName: expect.stringMatching(/^orbit-room-data-\d{4}-\d{2}-\d{2}\.json$/),
      href: 'blob:settings-export'
    });
    const blob = harness.blobs.at(-1);
    expect(blob?.type).toBe('application/json;charset=utf-8');
    const payload = JSON.parse(String(blob?.parts[0])) as {
      kind?: string;
      version?: number;
      state?: { settings?: { accountLogin?: Record<string, unknown> } };
    };
    expect(payload).toMatchObject({ kind: 'room-data-export', version: 1 });
    expect(payload.state?.settings?.accountLogin).toEqual({ username: 'ref-006g@example.test' });
    expect(payload.state?.settings?.accountLogin).not.toHaveProperty('passwordSalt');
    expect(payload.state?.settings?.accountLogin).not.toHaveProperty('passwordHash');
    expect(document.querySelector('#settings-data .success-copy')?.textContent).toBe('Room data exported.');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('shows one flat room time fee and only a per-game drop setting', () => {
    const tablesTab = Array.from(document.querySelectorAll('.settings-nav button')).find(
      (button) => button.textContent === 'Tables & fees'
    );
    expect(tablesTab).toBeDefined();
    act(() => tablesTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const profile = document.querySelector('.collection-profile-row');
    expect(document.querySelectorAll('input[aria-label="Flat time fee per player-hour"]')).toHaveLength(1);
    expect(document.querySelector('#settings-tables')?.textContent).toContain('Set once for the room');
    expect(profile?.textContent).toContain('1/2 NLH collection profile');
    expect(
      Array.from(profile?.querySelectorAll('.collection-profile-field > strong') ?? [], (heading) => heading.textContent)
    ).toEqual(['Drop / seat-hour']);
    expect(
      Array.from(profile?.querySelectorAll('.collection-profile-field') ?? [], (field) =>
        field.querySelector('input')?.labels?.[0]?.textContent?.trim()
      )
    ).toEqual(['Drop / seat-hour']);
  });
});
