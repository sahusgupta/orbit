/**
 * @vitest-environment jsdom
 */
import { createHash } from 'node:crypto';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  root: undefined as { unmount: () => void } | undefined,
  blobs: [] as Array<{ parts: BlobPart[]; type: string }>,
  downloads: [] as Array<{ fileName: string; href: string }>,
  fetchState: vi.fn(async () => new Response(null, { status: 404 }))
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

const submitForm = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

describe('expired-license room data export', () => {
  beforeAll(async () => {
    const password = 'correct horse battery staple';
    const passwordSalt = 'expired-export-salt';
    const passwordHash = createHash('sha256').update(`${passwordSalt}:${password}`).digest('hex');
    window.location.hash = '#/settings';
    localStorage.setItem('table-manager-state-v1', JSON.stringify({
      games: [{ id: 'expired-game', name: 'Expired License Game', maxSeats: 8, minInRoomForLikely: 6, minFlexibleForLikely: 2, minTotalForViable: 8 }],
      profiles: [{
        id: 'expired-profile',
        name: 'Local Export Player',
        phone: '555-0199',
        birthday: '',
        membershipStartDate: '',
        membershipExpirationDate: '',
        totalTimePlayedHours: 1,
        lastSessionTimePlayedHours: 1,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: 'expired-game',
        preferredGameIds: ['expired-game'],
        gamePlayCounts: { 'expired-game': 1 },
        mostPlayedGameId: 'expired-game',
        preferredStakes: '1/2',
        typicalBuyInMin: 100,
        typicalBuyInMax: 300,
        willingnessToMove: true,
        typicalAvailability: '',
        usualCompanions: [],
        preferredTags: [],
        notes: ''
      }],
      settings: {
        clubAccount: {
          clubName: 'Expired Export Club',
          accountName: 'Expired Account',
          contactName: 'Local Owner',
          email: 'expired@example.test',
          phone: '',
          address: ''
        },
        pilotAccess: {
          authorized: true,
          authorizationCode: 'EXPIRED-PRIVATE-AUTHORIZATION',
          activatedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
          keyFileName: 'expired-private.key',
          licenseId: 'expired-license'
        },
        staffAccounts: [{
          id: 'expired-owner',
          name: 'Local Owner',
          role: 'Owner',
          pinSalt: 'EXPIRED-PRIVATE-PIN-SALT',
          pinHash: 'EXPIRED-PRIVATE-PIN-HASH',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z'
        }],
        accountLogin: {
          username: 'expired@example.test',
          passwordSalt,
          passwordHash,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }));
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal('fetch', harness.fetchState);
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
      static createObjectURL = vi.fn(() => 'blob:expired-room-export');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('Blob', TestBlob);
    vi.stubGlobal('URL', TestUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      harness.downloads.push({ fileName: this.download, href: this.href });
    });

    await act(async () => {
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

  it('fails closed on a wrong local password without downloading or unlocking operations', async () => {
    expect(document.querySelector('.access-brand .eyebrow')?.textContent).toBe('Pilot access');
    const exportHeading = Array.from(document.querySelectorAll('.access-step-title h2')).find(
      (heading) => heading.textContent === 'Export room data'
    );
    const form = exportHeading?.closest('form');
    expect(form).toBeInstanceOf(HTMLFormElement);
    const [emailInput, passwordInput] = Array.from(form!.querySelectorAll('input')) as HTMLInputElement[];

    act(() => {
      setInputValue(emailInput, 'expired@example.test');
      setInputValue(passwordInput, 'wrong password');
    });
    await submitForm(form!);

    expect(document.querySelector('#expired-data-export-message')?.textContent).toBe(
      'Email or password is incorrect. Room data was not exported.'
    );
    expect(harness.blobs).toHaveLength(0);
    expect(harness.downloads).toHaveLength(0);
    expect(document.querySelector('.orbit-shell')).toBeNull();
    expect(document.querySelector('.access-shell')).toBeTruthy();
    expect(harness.fetchState).not.toHaveBeenCalled();
  });

  it('downloads sanitized data with the correct local account while remaining locked and offline', async () => {
    const exportHeading = Array.from(document.querySelectorAll('.access-step-title h2')).find(
      (heading) => heading.textContent === 'Export room data'
    );
    const form = exportHeading!.closest('form')!;
    const [emailInput, passwordInput] = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
    act(() => {
      setInputValue(emailInput, 'expired@example.test');
      setInputValue(passwordInput, 'correct horse battery staple');
    });
    await submitForm(form);

    expect(document.querySelector('#expired-data-export-message')?.textContent).toBe('Room data exported.');
    expect(harness.downloads).toHaveLength(1);
    expect(harness.downloads[0]).toEqual({
      fileName: expect.stringMatching(/^orbit-room-data-\d{4}-\d{2}-\d{2}\.json$/),
      href: 'blob:expired-room-export'
    });
    const blob = harness.blobs[0];
    expect(blob.type).toBe('application/json;charset=utf-8');
    const payload = JSON.parse(String(blob.parts[0])) as { kind?: string; state?: { profiles?: Array<{ name?: string }> } };
    expect(payload.kind).toBe('room-data-export');
    expect(payload.state?.profiles?.[0]?.name).toBe('Local Export Player');
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('expired@example.test');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('pinHash');
    expect(serialized).not.toContain('authorizationCode');
    expect(serialized).not.toContain('PRIVATE');
    expect(document.querySelector('.orbit-shell')).toBeNull();
    expect(document.querySelector('.access-shell')).toBeTruthy();
    expect(document.querySelector('.access-brand .eyebrow')?.textContent).toBe('Pilot access');
    expect(harness.fetchState).not.toHaveBeenCalled();
  });

  it('keeps sanitized export available to legacy rooms without a configured local login', async () => {
    act(() => harness.root?.unmount());
    harness.root = undefined;
    harness.blobs.length = 0;
    harness.downloads.length = 0;
    const legacyState = JSON.parse(localStorage.getItem('table-manager-state-v1') ?? '{}') as {
      settings?: { accountLogin?: unknown };
    };
    if (legacyState.settings) delete legacyState.settings.accountLogin;
    localStorage.setItem('table-manager-state-v1', JSON.stringify(legacyState));
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();

    await act(async () => {
      await import('../main');
    });

    const exportHeading = Array.from(document.querySelectorAll('.access-step-title h2')).find(
      (heading) => heading.textContent === 'Export room data'
    );
    const exportSection = exportHeading?.closest('section');
    expect(exportSection?.textContent).toContain('no local sign-in to verify');
    expect(exportSection?.querySelector('input')).toBeNull();

    await act(async () => {
      Array.from(exportSection?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        .find((button) => button.textContent?.includes('Export Room Data'))
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(document.querySelector('#expired-data-export-message')?.textContent).toBe('Room data exported.');
    expect(harness.downloads).toHaveLength(1);
    expect(document.querySelector('.orbit-shell')).toBeNull();
    expect(document.querySelector('.access-shell')).toBeTruthy();
    expect(harness.fetchState).not.toHaveBeenCalled();
  });
});
