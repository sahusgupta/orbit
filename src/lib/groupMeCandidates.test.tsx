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
  interests: IdentifiedRecord[];
  profiles: IdentifiedRecord[];
  settings: Record<string, unknown>;
  usageEvents: IdentifiedRecord[];
};

type Candidate = Record<string, unknown> & {
  confidence: number;
  gameId: string;
  id: string;
  playerName: string;
  sourceText: string;
  status: string;
  timestamp: string;
};

const harness = vi.hoisted(() => ({
  candidateSetter: undefined as unknown,
  latestCandidates: [] as unknown[],
  latestState: undefined as unknown,
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isIdentifiedRecord = (value: unknown): value is IdentifiedRecord =>
  typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';

const isCapturedState = (value: unknown): value is CapturedState => {
  if (typeof value !== 'object' || value === null) return false;
  const settings: unknown = Reflect.get(value, 'settings');
  return (
    typeof settings === 'object' &&
    settings !== null &&
    ['games', 'interests', 'profiles', 'usageEvents'].every((key) => {
      const records: unknown = Reflect.get(value, key);
      return Array.isArray(records) && records.every(isIdentifiedRecord);
    })
  );
};

const isCandidate = (value: unknown): value is Candidate =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'id') === 'string' &&
  typeof Reflect.get(value, 'playerName') === 'string' &&
  typeof Reflect.get(value, 'gameId') === 'string' &&
  typeof Reflect.get(value, 'status') === 'string' &&
  typeof Reflect.get(value, 'timestamp') === 'string' &&
  typeof Reflect.get(value, 'confidence') === 'number' &&
  typeof Reflect.get(value, 'sourceText') === 'string';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      const value: unknown = result[0];
      if (isCapturedState(value)) {
        harness.latestState = value;
        harness.stateSetter = result[1];
      }
      if (Array.isArray(value) && value.length > 0 && value.every(isCandidate)) {
        harness.latestCandidates = value;
        harness.candidateSetter = result[1];
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
    name: 'PLO',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  }
];
const pilotAccess = {
  activatedAt: '2026-08-07T12:00:00.000Z',
  authorizationCode: 'TYPE-010-AUTH',
  authorized: true,
  expiresAt: '2099-12-31T23:59:59.000Z',
  issuedTo: 'TYPE-010 Fixture Club',
  licenseId: 'TYPE-010-LICENSE'
};

const getLatestState = () => {
  if (!isCapturedState(harness.latestState)) throw new Error('Expected to capture the application state');
  return harness.latestState;
};

const getLatestCandidates = () => {
  if (!harness.latestCandidates.every(isCandidate)) throw new Error('Expected complete GroupMe candidates');
  return harness.latestCandidates;
};

const getReactHandler = (element: Element, name: 'onChange' | 'onClick') => {
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

const findButton = (label: string, root: ParentNode = document) => {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!button) throw new Error(`Expected ${label} button`);
  return button;
};

const invoke = async (handler: (...args: unknown[]) => unknown, ...args: unknown[]) => {
  await act(async () => {
    handler(...args);
    await Promise.resolve();
  });
};

const resetState = async () => {
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isCapturedState(current)) throw new Error('Expected the current application state');
      return { ...current, games, interests: [], profiles: [], usageEvents: [] };
    });
    const candidateSetter = harness.candidateSetter;
    if (typeof candidateSetter === 'function') candidateSetter([]);
  });
  harness.latestCandidates = [];
};

const scanText = async (text: string) => {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="Paste player interest"]');
  if (!textarea) throw new Error('Expected the Message Scan textarea');
  await invoke(getReactHandler(textarea, 'onChange'), { target: { value: text } });
  await invoke(getReactHandler(findButton('Scan Pasted Messages'), 'onClick'));
};

describe('GroupMe candidate review boundary', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#signals';
    localStorage.setItem(
      'table-manager-state-v1',
      JSON.stringify({
        games,
        settings: {
          pilotAccess,
          accountLogin: { username: 'type-010@example.test' }
        }
      })
    );
    localStorage.setItem(
      'table-manager-state-v1:auth:type-010-license',
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
      await import('../main');
    });
  });

  beforeEach(async () => {
    await resetState();
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

  it('creates only complete timestamped candidates and ignores unmatched text', async () => {
    await scanText('ignore this chess message\nAlice: coming for 1 / 2');

    expect(getLatestCandidates()).toHaveLength(1);
    expect(getLatestCandidates()[0]).toMatchObject({
      playerName: 'Alice',
      gameId: 'nlh-1-2',
      status: 'Confirmed Coming',
      timestamp: now,
      confidence: 82,
      sourceText: 'Alice: coming for 1 / 2'
    });
    expect(Object.hasOwn(getLatestCandidates()[0], 'timestamp')).toBe(true);
  });

  it('preserves the outreach route structure, navigation, templates, and generated scripts', () => {
    expect(document.querySelector('h1')?.textContent).toBe('Games');
    expect(document.querySelector('.page-subtitle')?.textContent).toBe('Outreach and player coordination');
    expect(Array.from(document.querySelectorAll('.route-tabs > *')).map((item) => item.textContent?.trim())).toEqual([
      'Tonight',
      'Outreach',
      'Configuration'
    ]);
    expect(document.querySelector('.route-tabs [aria-current="page"]')?.textContent).toBe('Outreach');
    expect(Array.from(document.querySelectorAll('.panel-title h2')).map((item) => item.textContent)).toEqual([
      'Likely Participants',
      'Message Scan',
      'Templates'
    ]);
    expect(document.querySelector('textarea')?.getAttribute('placeholder')).toBe('Paste player interest messages for staff review');
    expect(Array.from(document.querySelectorAll<HTMLInputElement>('.script-template-list input')).map((input) => input.value)).toEqual([
      'Current {game} has {inRoom} in the room, {coming} coming, and {waiting} waiting or interested.',
      'Current {game} is full, but overflow is building with {waiting} waiting or interested.',
      "We're building {game}, but need {needs} more player(s) before it is realistic.",
      '{game} is close to forming if arrivals hold. We can add you to the interest list.'
    ]);
    expect(Array.from(document.querySelectorAll('.script-grid .script-card strong')).map((item) => item.textContent)).toEqual([
      '1/2 NLH: current demand',
      '1/2 NLH: needs more',
      'PLO: current demand',
      'PLO: needs more'
    ]);
    expect(findButton('Close')).toBeTruthy();
    expect(findButton('Scan Pasted Messages')).toBeTruthy();
  });

  it('preserves complete candidates through each edit, accept, and reject action', async () => {
    await scanText('Alice: coming for 1 / 2\nBob- here for PLO');
    const originalCandidates = structuredClone(getLatestCandidates());
    expect(originalCandidates).toHaveLength(2);

    let cards = document.querySelectorAll<HTMLElement>('.script-card');
    let firstInputs = cards[0].querySelectorAll<HTMLInputElement | HTMLSelectElement>('.candidate-edit-grid input, .candidate-edit-grid select');
    await invoke(getReactHandler(firstInputs[0], 'onChange'), { target: { value: 'Alice Edited' } });

    cards = document.querySelectorAll<HTMLElement>('.script-card');
    firstInputs = cards[0].querySelectorAll<HTMLInputElement | HTMLSelectElement>('.candidate-edit-grid input, .candidate-edit-grid select');
    await invoke(getReactHandler(firstInputs[1], 'onChange'), { target: { value: 'plo' } });

    cards = document.querySelectorAll<HTMLElement>('.script-card');
    firstInputs = cards[0].querySelectorAll<HTMLInputElement | HTMLSelectElement>('.candidate-edit-grid input, .candidate-edit-grid select');
    await invoke(getReactHandler(firstInputs[2], 'onChange'), { target: { value: 'Arrived' } });

    const edited = getLatestCandidates();
    expect(edited[0]).toEqual({
      ...originalCandidates[0],
      playerName: 'Alice Edited',
      gameId: 'plo',
      status: 'Arrived'
    });
    expect(edited[1]).toEqual(originalCandidates[1]);
    expect(edited[0].timestamp).toBe(now);

    cards = document.querySelectorAll<HTMLElement>('.script-card');
    await invoke(getReactHandler(findButton('Add', cards[0]), 'onClick'));

    const acceptedState = getLatestState();
    expect(acceptedState.interests[0]).toMatchObject({
      playerName: 'Alice Edited',
      gameId: 'plo',
      status: 'Arrived',
      timestamp: now,
      interestedAt: now,
      arrivedAt: now,
      notes: `GroupMe/pasted: ${originalCandidates[0].sourceText}`
    });
    expect(getLatestCandidates()).toEqual([originalCandidates[1]]);

    cards = document.querySelectorAll<HTMLElement>('.script-card');
    await invoke(getReactHandler(findButton('Reject', cards[0]), 'onClick'));
    expect(document.querySelectorAll('.candidate-edit-grid')).toHaveLength(0);
    expect(getLatestState().interests).toHaveLength(1);
  });
});
