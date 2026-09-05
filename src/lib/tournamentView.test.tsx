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

const changeInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

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
      await import('../components/TournamentsView');
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

  it('renders one validated setup form and a two-section managed client', async () => {
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
    expect(document.querySelector('.page-header > .header-actions button')).toBeNull();
    expect(
      Array.from(document.querySelectorAll('.tournament-field > span'), (label) =>
        label.childNodes[0]?.textContent?.trim()
      )
    ).toEqual([
      'Tournament name',
      'Buy-in',
      'Starting stack',
      'Level length',
      'Rebuy to prize pool',
      'Players per table',
      'Scheduled start',
      'Interest opens',
      'Interest closes',
      'Player interest',
      'Player withdrawal'
    ]);
    const scheduleInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]')
    );
    expect(scheduleInputs).toHaveLength(3);
    expect(Array.from(document.querySelectorAll<HTMLSelectElement>('.tournament-form select'), (select) => (
      Array.from(select.options, (option) => option.text)
    ))).toEqual([
      ['Closed by venue', 'Open during window'],
      ['Not allowed', 'Allowed']
    ]);
    expect(document.querySelector('#tournament-publication-error')?.textContent).toContain(
      'leave all three blank to keep this tournament private'
    );
    await act(async () => {
      changeInput(scheduleInputs[0], '2026-08-10T18:00');
    });
    expect(document.querySelector('#tournament-publication-error')?.textContent).toContain(
      'Set the interest open, interest close, and scheduled start dates.'
    );
    expect(document.querySelector<HTMLButtonElement>('.tournament-form-actions .primary-button')?.disabled).toBe(true);
    await act(async () => {
      changeInput(scheduleInputs[0], '');
    });
    expect(document.querySelector('.tournament-payout-editor legend')?.textContent).toBe('Prize pool allocation');
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.tournament-payout-draft-row input'), (input) => [
      input.getAttribute('aria-label'),
      input.value
    ])).toEqual([
      ['1st place percent', '50'],
      ['2nd place percent', '30'],
      ['3rd place percent', '20']
    ]);
    expect(document.querySelector('.tournament-payout-editor-head strong')?.textContent).toBe('100% allocated');
    expect(Array.from(document.querySelectorAll('.tournament-form-actions button'), (button) => button.textContent)).toEqual([
      'Cancel',
      'Create tournament'
    ]);

    const firstPayout = document.querySelector<HTMLInputElement>('input[aria-label="1st place percent"]');
    await act(async () => {
      if (!firstPayout) throw new Error('Expected first-place payout input');
      changeInput(firstPayout, '40');
    });
    expect(document.querySelector('.tournament-payout-editor-head strong')?.textContent).toBe('90% allocated');
    expect(document.querySelector('.tournament-payout-editor-footer .invalid')?.textContent).toContain('must total 100%');
    expect(document.querySelector<HTMLButtonElement>('.tournament-form-actions .primary-button')?.disabled).toBe(true);

    await act(async () => {
      if (!firstPayout) throw new Error('Expected first-place payout input');
      changeInput(firstPayout, '50');
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-payout-editor-footer button')?.click();
    });
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.tournament-payout-draft-row input'), (input) => input.getAttribute('aria-label'))).toEqual([
      '1st place percent',
      '2nd place percent',
      '3rd place percent',
      '4th place percent'
    ]);
    expect(document.querySelector<HTMLButtonElement>('.tournament-form-actions .primary-button')?.disabled).toBe(false);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-form-actions .ghost-button')?.click();
    });
    expect(document.querySelector('h1')?.textContent).toBe('Tournaments');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-library-main')?.click();
    });

    expect(document.querySelector('h1')?.textContent).toBe('Orbit Launch Championship');
    expect(document.querySelector('.tournament-section-nav')).toBeNull();
    expect(document.querySelector('.tournament-control-panel')).toBeNull();
    expect(document.querySelector('.tournament-tables-panel')).toBeNull();
    expect(Array.from(document.querySelectorAll('.tournament-client-grid > .tournament-panel .panel-title h2'), (heading) => heading.textContent)).toEqual([
      'Players',
      'Prize Pool'
    ]);
    expect(document.querySelectorAll('.tournament-client-grid > .tournament-panel')).toHaveLength(2);
    expect(document.querySelector<HTMLButtonElement>('.tournament-library-back')?.textContent?.trim()).toBe('All tournaments');
    expect(Array.from(document.querySelectorAll('.tournament-lifecycle-actions button'), (button) => button.textContent?.trim())).toEqual([
      'Start',
      'Prev Level',
      'Next Level',
      'TV View'
    ]);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-prize-panel .ghost-button')?.click();
    });
    expect(document.querySelector('h1')?.textContent).toBe('Edit tournament');
    expect(document.querySelector('.page-header > .header-actions button')).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-form-actions .ghost-button')?.click();
    });
    expect(document.querySelector('h1')?.textContent).toBe('Orbit Launch Championship');
    expect(document.querySelectorAll('.tournament-client-grid > .tournament-panel')).toHaveLength(2);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('.tournament-library-back')?.click();
    });
    expect(document.querySelector('h1')?.textContent).toBe('Tournaments');
  });
});
