/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  root: undefined as { unmount: () => void } | undefined,
  blobs: [] as Array<{ parts: BlobPart[]; type: string }>,
  downloads: [] as Array<{ fileName: string; href: string }>
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
          accountLogin: { username: 'ref-006g@example.test' }
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
