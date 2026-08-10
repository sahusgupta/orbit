/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({ root: undefined as { unmount: () => void } | undefined }));

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
    expect(document.querySelector('.membership-plan-heading button')?.textContent?.trim()).toBe('Add plan');
  });
});
