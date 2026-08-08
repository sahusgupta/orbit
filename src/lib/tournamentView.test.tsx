/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  root: undefined as { unmount: () => void } | undefined
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

describe('tournament route rendering', () => {
  beforeAll(async () => {
    const expiresAt = '2099-12-31T23:59:59.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
    window.location.hash = '#tournaments';
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        tournaments: [],
        settings: {
          pilotAccess: {
            activatedAt: '2026-08-07T12:00:00.000Z',
            authorizationCode: 'REF-006D-AUTH',
            authorized: true,
            expiresAt,
            issuedTo: 'REF-006D Fixture Club',
            licenseId: 'REF-006D-LICENSE'
          },
          accountLogin: { username: 'ref-006d@example.test' }
        }
      })
    );
    localStorage.setItem(
      'table-manager-state-v1:auth:ref-006d-license',
      JSON.stringify({ expiresAt })
    );
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => {
      await import('../main');
    });
  });

  afterAll(() => {
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders the empty library and the unchanged create-tournament form contract', async () => {
    expect(document.querySelector('h1')?.textContent).toBe('Tournaments');
    expect(document.querySelector('.header-actions button')?.textContent?.trim()).toBe('New tournament');
    expect(document.querySelector('.tournament-new-card strong')?.textContent).toBe('Create a new tournament');
    expect(document.querySelector('.tournament-new-card small')?.textContent).toBe(
      'Build a fresh structure from scratch'
    );
    expect(document.querySelector('.tournament-library-card strong')?.textContent).toBe(
      'Orbit Launch Championship'
    );
    expect(document.querySelector('.tournament-library-card small')?.textContent).toBe(
      'Draft · 0 entries · $0 buy-in'
    );
    expect(document.querySelector('.tournament-library-card [title="Tournament actions"]')).toBeTruthy();

    const newTournamentButton = document.querySelector<HTMLButtonElement>('.header-actions .primary-button');
    if (!newTournamentButton) throw new Error('Expected the new tournament button');
    await act(async () => {
      newTournamentButton.click();
    });

    expect(document.querySelector('h1')?.textContent).toBe('Create tournament');
    expect(document.querySelector('.tournament-form-panel h2')?.textContent).toBe('Tournament setup');
    expect(
      Array.from(document.querySelectorAll('.tournament-form label > span'), (label) =>
        label.childNodes[0]?.textContent?.trim()
      )
    ).toEqual([
      'Tournament name',
      'Buy-in',
      'Starting stack',
      'Level length',
      'Rebuy to prize pool',
      'Players per table'
    ]);
    expect(Array.from(document.querySelectorAll('.tournament-form-actions button'), (button) => button.textContent)).toEqual([
      'Cancel',
      'Create tournament'
    ]);
  });
});
