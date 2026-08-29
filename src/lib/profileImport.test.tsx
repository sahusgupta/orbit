/**
 * @vitest-environment jsdom
 */
import type { Dispatch, SetStateAction } from 'react';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type IdentifiedRecord = Record<string, unknown> & { id: string };

type CapturedState = Record<string, unknown> & {
  games: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  settings: Record<string, unknown>;
};

const harness = vi.hoisted(() => ({
  excelRows: [] as unknown[][],
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

vi.mock('exceljs', () => ({
  Workbook: class Workbook {
    worksheets = [{
      getRow: (rowNumber: number) => ({ values: harness.excelRows[rowNumber - 1] ?? [] }),
      eachRow: (callback: (row: { values: unknown[] }, rowNumber: number) => void) => {
        harness.excelRows.forEach((values, index) => callback({ values }, index + 1));
      }
    }];

    xlsx = { load: vi.fn(async () => undefined) };
  }
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'id') === 'string';

const isCapturedState = (value: unknown): value is CapturedState => {
  if (typeof value !== 'object' || value === null) return false;
  const games: unknown = Reflect.get(value, 'games');
  const profiles: unknown = Reflect.get(value, 'profiles');
  const settings: unknown = Reflect.get(value, 'settings');
  return (
    Array.isArray(games) &&
    games.every(isIdentifiedRecord) &&
    Array.isArray(profiles) &&
    profiles.every(isIdentifiedRecord) &&
    typeof settings === 'object' &&
    settings !== null
  );
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isCapturedState(result[0])) {
        harness.latestState = result[0];
        harness.stateSetter = result[1];
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

const now = '2026-08-07T22:00:00.000Z';
const games = [
  {
    id: 'nlh-1-2',
    name: '1/2 NLH',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  },
  {
    id: 'plo',
    name: 'Pot Limit Omaha',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  }
];
const pilotAccess = {
  activatedAt: '2026-08-07T12:00:00.000Z',
  authorizationCode: 'TYPE-008-AUTH',
  authorized: true,
  expiresAt: '2099-12-31T23:59:59.000Z',
  issuedTo: 'TYPE-008 Fixture Club',
  licenseId: 'TYPE-008-LICENSE'
};

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const getReactHandler = (element: Element, name: 'onChange' | 'onClick' | 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop') => {
  const reactPropsKey = Reflect.ownKeys(element).find(
    (key) => typeof key === 'string' && key.startsWith('__reactProps$')
  );
  if (!reactPropsKey) throw new Error(`Expected React props for ${element.tagName}`);
  const props: unknown = Reflect.get(element, reactPropsKey);
  if (typeof props !== 'object' || props === null) throw new Error('Expected rendered React props');
  const handler: unknown = Reflect.get(props, name);
  if (typeof handler !== 'function') throw new Error(`Expected ${name}`);
  return (...args: unknown[]) => Reflect.apply(handler, undefined, args);
};

const invoke = async (handler: (...args: unknown[]) => unknown, ...args: unknown[]) => {
  await act(async () => {
    await handler(...args);
  });
};

const importPastedProfiles = async (text: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea.import-box');
  if (!textarea) throw new Error('Expected the profile import textarea');
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === 'Import pasted players'
  );
  if (!button) throw new Error('Expected the profile import button');
  await invoke(getReactHandler(textarea, 'onChange'), { target: { value: text } });
  await invoke(getReactHandler(button, 'onClick'));
};

const importProfileFile = async (file: File) => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Expected the profile import file input');
  await act(async () => {
    await getReactHandler(input, 'onChange')({ target: { files: [file] } });
    await Promise.resolve();
  });
};

const dropProfileFile = async (file: File) => {
  const dropZone = document.querySelector<HTMLElement>('.club-data-import .license-file-button');
  if (!dropZone) throw new Error('Expected the profile import drop zone');
  await invoke(getReactHandler(dropZone, 'onDragEnter'), {
    preventDefault: () => undefined,
    currentTarget: dropZone,
    target: dropZone
  });
  await invoke(getReactHandler(dropZone, 'onDrop'), {
    preventDefault: () => undefined,
    dataTransfer: { files: [file] }
  });
};

const resetProfiles = async (profiles: IdentifiedRecord[] = []) => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return { ...current, games, profiles };
    });
  });
};

describe('pasted profile import boundary', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#profiles';
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        games,
        settings: {
          pilotAccess,
          accountLogin: { username: 'type-008@example.test' }
        }
      })
    );
    localStorage.setItem(
      'table-manager-state-v1:auth:type-008-license',
      JSON.stringify({ expiresAt: pilotAccess.expiresAt })
    );
    document.body.innerHTML = '<div id="root"></div>';
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => null),
      loadStateForAccount: vi.fn(async () => null),
      onPrepareForUpdate: vi.fn(() => () => undefined),
      openWindow: vi.fn(async () => undefined),
      preserveStateForUpdate: vi.fn(async () => ({ ok: true })),
      recordClientError: vi.fn(async () => ({ ok: true })),
      recordClientEvent: vi.fn(async () => ({ ok: true })),
      saveState: vi.fn(async () => ({ ok: true, path: 'fixture' })),
      sendTextMessages: vi.fn(async () => ({ ok: true })),
      submitAnalyticalReport: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: false, active: true }))
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await act(async () => {
      await import('../components/ProfilesView');
      await import('../main');
    });
  });

  beforeEach(async () => {
    harness.excelRows = [];
    await resetProfiles();
  });

  afterAll(() => {
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('renders the memberships route navigation, directory panels, and profile import controls', () => {
    expect(document.querySelector('h1')?.textContent).toBe('Players');
    expect(document.querySelector('.page-subtitle')?.textContent).toBe(
      "Active memberships and today's player activity"
    );
    expect(
      Array.from(document.querySelectorAll('.players-header-actions button'), (button) =>
        button.getAttribute('aria-label')
      )
    ).toEqual(['Scan member QR', 'Scan or swipe government ID', 'Open player ledger', 'Add player']);

    const tabs = document.querySelector('.players-section-tabs');
    expect(tabs?.getAttribute('aria-label')).toBe('Player sections');
    expect(Array.from(tabs?.querySelectorAll('button') ?? [], (button) => button.textContent?.trim())).toEqual([
      'Memberships 0',
      'Requests 0',
      'Today 0',
      'Past players 0'
    ]);
    expect(tabs?.querySelector('button.active')?.textContent?.trim()).toBe('Memberships 0');

    expect(Array.from(document.querySelectorAll('.profile-command-strip .eyebrow'), (label) => label.textContent)).toEqual([
      'Directory health',
      'Memberships'
    ]);
    expect(Array.from(document.querySelectorAll('.panel h2'), (heading) => heading.textContent)).toEqual([
      'Player Directory',
      'In Club',
      'Add Players',
      'Player Ledger'
    ]);
    expect(document.querySelector('.profile-search-row input')?.getAttribute('placeholder')).toBe(
      'Search players, stakes, companions, notes'
    );
    expect(document.querySelector('#club-data-import-title')?.textContent).toBe('Import club player data');
    expect(document.querySelector('.club-data-import p')?.textContent).toContain('CSV or XLSX');
    expect(document.querySelector('textarea.import-box')?.getAttribute('placeholder')).toContain('Paste CSV');
    expect(document.querySelector('.club-data-import .license-file-button')?.textContent).toContain('Choose or drop CSV/XLSX');
  });

  it('keeps the club data importer available in the OCR-enhanced Add member dialog', async () => {
    const addPlayerButton = document.querySelector<HTMLButtonElement>('[aria-label="Add player"]');
    if (!addPlayerButton) throw new Error('Expected the Add player button');
    await invoke(getReactHandler(addPlayerButton, 'onClick'));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain('Address');
    expect(dialog?.textContent).toContain('Birthday');
    expect(dialog?.querySelector('.player-popup-import .license-file-button')?.textContent).toContain(
      'Choose or drop CSV/XLSX'
    );

    const closeButton = dialog?.querySelector<HTMLButtonElement>('[aria-label="Close player form"]');
    if (!closeButton) throw new Error('Expected the player dialog close button');
    act(() => closeButton.click());
  });

  it('keeps the Add member dialog open and surfaces file validation feedback beside its importer', async () => {
    const addPlayerButton = document.querySelector<HTMLButtonElement>('[aria-label="Add player"]');
    if (!addPlayerButton) throw new Error('Expected the Add player button');
    await invoke(getReactHandler(addPlayerButton, 'onClick'));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const fileInput = dialog?.querySelector<HTMLInputElement>('.player-popup-import input[type="file"]');
    if (!dialog || !fileInput) throw new Error('Expected the Add member import control');
    await invoke(getReactHandler(fileInput, 'onChange'), {
      target: {
        files: [new File(['name\nAlice'], 'invalid.csv', { type: 'text/csv' })],
        value: 'C:\\fakepath\\invalid.csv'
      }
    });

    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector('.player-popup-import .profile-import-message')?.textContent).toBe(
      'The CSV must contain a comma-separated header row.'
    );

    const closeButton = dialog.querySelector<HTMLButtonElement>('[aria-label="Close player form"]');
    if (!closeButton) throw new Error('Expected the player dialog close button');
    act(() => closeButton.click());
  });

  it('normalizes valid JSON arrays, aliases, arrays, and numeric strings without losing fields', async () => {
    await importPastedProfiles(
      JSON.stringify([
        {
          id: 'json-alice',
          name: ' Alice ',
          phoneNumber: 5551234,
          birthday: '1990-02-03',
          memberSince: '2025-01-02',
          expiresAt: '2027-03-04',
          totalTimePlayed: '12.5',
          lastSessionTimePlayed: '2',
          preferredGame: 'PLO',
          preferredGameIds: ['PLO', '1/2 NLH', 'PLO'],
          gamePlayCounts: { PLO: '3', 'nlh-1-2': 2, missing: 9 },
          mostPlayedGameId: 'PLO',
          stakes: 'PLO',
          buyInMin: '100',
          buyInMax: 500,
          moveTables: 1,
          availability: 'Friday evenings',
          preferredTags: ['Action', 'Social'],
          usualCompanions: 'Bob|Carol',
          notes: 'JSON fixture'
        }
      ])
    );

    expect(getLatestState().profiles).toEqual([
      {
        id: 'json-alice',
        name: 'Alice',
        phone: '5551234',
        birthday: '1990-02-03',
        membershipStartDate: '2025-01-02',
        membershipExpirationDate: '2027-03-04',
        totalTimePlayedHours: 12.5,
        lastSessionTimePlayedHours: 2,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: 'plo',
        preferredGameIds: ['plo', 'nlh-1-2'],
        gamePlayCounts: { plo: 3, 'nlh-1-2': 2 },
        mostPlayedGameId: 'plo',
        preferredStakes: 'PLO',
        typicalBuyInMin: 100,
        typicalBuyInMax: 500,
        willingnessToMove: true,
        typicalAvailability: 'Friday evenings',
        preferredTags: ['Action', 'Social'],
        usualCompanions: ['Bob', 'Carol'],
        notes: 'JSON fixture'
      }
    ]);
  });

  it('preserves delimited rows, missing-value defaults, and invalid game fallback', async () => {
    await importPastedProfiles('Dana,unknown game,,,2028-05-06,Bob|Carol,Weekends,no');

    expect(getLatestState().profiles).toHaveLength(1);
    expect(getLatestState().profiles[0]).toMatchObject({
      name: 'Dana',
      phone: '',
      birthday: '',
      membershipStartDate: '2026-08-07',
      membershipExpirationDate: '2028-05-06',
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      gamePlayCounts: {},
      mostPlayedGameId: 'nlh-1-2',
      preferredStakes: 'unknown game',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      willingnessToMove: false,
      typicalAvailability: 'Weekends',
      preferredTags: [],
      usualCompanions: ['Bob', 'Carol'],
      notes: ''
    });
  });

  it('imports quoted CSV aliases, skips existing names, and resolves companion profile IDs', async () => {
    await importPastedProfiles(JSON.stringify([{ id: 'existing-bob', name: 'Bob' }]));
    const csv = [
      'Name,Phone,DOB,Member Since,Expires At,Game,Companions,Notes',
        '" Alice, Jr. ",555-010-0000,1990-02-03,2025-01-02,2027-03-04,PLO,Bob|Carol,"Says ""hello"""',
      'Bob,555-0199,,,,1/2 NLH,,Duplicate should be skipped'
    ].join('\n');
    const file = new File([csv], 'profiles.csv', { type: 'text/csv' });

    await importProfileFile(file);

    expect(getLatestState().profiles).toHaveLength(2);
    expect(getLatestState().profiles[0]).toMatchObject({ id: 'existing-bob', name: 'Bob' });
    expect(getLatestState().profiles[1]).toMatchObject({
      name: 'Alice, Jr.',
        phone: '(555) 010-0000',
      birthday: '1990-02-03',
      membershipStartDate: '2025-01-02',
      membershipExpirationDate: '2027-03-04',
      preferredGameId: 'plo',
      preferredGameIds: ['plo'],
      commonlyPlaysWithProfileIds: ['existing-bob'],
      usualCompanions: ['Bob', 'Carol'],
      notes: 'Says "hello"'
    });
  });

  it('imports XLSX date cells, Excel serial dates, numeric values, and name aliases', async () => {
    harness.excelRows = [
      [undefined, 'First Name', 'Last Name', 'DOB', 'Join Date', 'Expiration Date', 'Lifetime Hours', 'Game', 'Move Tables'],
      [undefined, 'Dora', 'Lane', new Date('1991-02-03T00:00:00.000Z'), 1, 2, 7.5, '1/2 NLH', 'yes']
    ];
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'profiles.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });

    await importProfileFile(file);

    expect(getLatestState().profiles).toHaveLength(1);
    expect(getLatestState().profiles[0]).toMatchObject({
      name: 'Dora Lane',
      birthday: '1991-02-03',
      membershipStartDate: '1899-12-31',
      membershipExpirationDate: '1900-01-01',
      totalTimePlayedHours: 7.5,
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      willingnessToMove: true
    });
  });

  it('imports the club CSV export when it is dropped onto the file control', async () => {
    await resetProfiles();
    const csv = [
      'createdDate,playerNumber,firstName,lastName,address.street,address.city,address.state,address.zipCode,email,phone,hasSSN,birthday,optInEmail,optInMail,optInSMS,joinHours,joinMinutes,totalHours,totalMinutes',
      '2024-11-20,ABC123456,John,Smith,123 Main Street,College Station,TX,77840,john@example.test,555-010-0000,,1990-02-03,T,F,T,0,30,1,33'
    ].join('\n');

    await dropProfileFile(new File([csv], 'Aggieland Poker Data.xlsx - Sheet1.csv', { type: 'text/csv' }));

    expect(getLatestState().profiles[0]).toMatchObject({
      id: 'ABC123456',
      name: 'John Smith',
      membershipStartDate: '2024-11-20',
      address: '123 Main Street, College Station, TX 77840',
      email: 'john@example.test',
      phone: '(555) 010-0000',
      totalTimePlayedHours: 1.55,
      lastSessionTimePlayedHours: 0.5,
      communicationPreferences: { email: true, mail: false, sms: true }
    });
  });

  it('rejects malformed array members and normalizes invalid JSON field values to safe fallbacks', async () => {
    await importPastedProfiles(
      JSON.stringify([
        null,
        'not a profile',
        { name: '' },
        { name: { invalid: true } },
        {
          id: 'json-malformed',
          name: 'Malformed Fields',
          totalTimePlayedHours: 'not-a-number',
          lastSessionTimePlayedHours: {},
          commonlyPlaysWithProfileIds: [null, 7, 'profile-valid'],
          preferredGameId: { invalid: true },
          preferredGameIds: [null, 42, {}, 'missing-game'],
          gamePlayCounts: ['not', 'a', 'record'],
          typicalBuyInMin: 'invalid',
          typicalBuyInMax: [],
          preferredTags: ['Action', 'Not A Tag', 42],
          usualCompanions: [null, 'Bob', 7]
        }
      ])
    );

    expect(getLatestState().profiles).toHaveLength(1);
    expect(getLatestState().profiles[0]).toMatchObject({
      id: 'json-malformed',
      name: 'Malformed Fields',
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: ['profile-valid'],
      preferredGameId: 'nlh-1-2',
      preferredGameIds: ['nlh-1-2'],
      gamePlayCounts: {},
      mostPlayedGameId: 'nlh-1-2',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      preferredTags: ['Action'],
      usualCompanions: ['Bob']
    });
  });

  it('retains malformed-JSON fallback to the accepted single-line text format', async () => {
    await importPastedProfiles('{Alice,1/2 NLH');

    expect(getLatestState().profiles).toHaveLength(1);
    expect(getLatestState().profiles[0]).toMatchObject({
      name: '{Alice',
      preferredGameId: 'nlh-1-2',
      preferredStakes: '1/2 NLH'
    });
  });

  it('rejects an import that would exceed the authoritative management-state save limit', async () => {
    const saveState = vi.mocked(window.tableManagerDesktop!.saveState);
    saveState.mockClear();

    await importPastedProfiles(JSON.stringify([{
      id: 'oversized-player',
      name: 'Oversized Player',
      notes: 'x'.repeat(2_000_000)
    }]));

    expect(getLatestState().profiles).toHaveLength(0);
    expect(document.querySelector('.profile-import-message')?.textContent).toContain("above Orbit's 2,000,000-byte save limit");
    expect(saveState).not.toHaveBeenCalled();

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea.import-box');
    if (!textarea) throw new Error('Expected the profile import textarea');
    await invoke(getReactHandler(textarea, 'onChange'), { target: { value: '' } });
  });
});
