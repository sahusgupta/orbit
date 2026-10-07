/**
 * @vitest-environment jsdom
 */
import React, { act, type ComponentType, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedState } from '../domain/state';
import type { AppState, PersistedStateRecord, PlayerProfile } from '../domain/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  cloudError: false,
  cloudResult: null as unknown,
  desktopLoadCalls: 0,
  desktopLoadMarkers: [] as string[],
  desktopLoadResult: null as unknown,
  desktopPollError: false,
  desktopPollResult: null as unknown,
  desktopSaveError: false,
  desktopSaveResult: undefined as { ok: boolean; conflict?: boolean; error?: string } | undefined,
  desktopSaveStates: [] as AppState[],
  fetchCalls: [] as string[],
  floorProps: undefined as unknown,
  latestState: undefined as unknown,
  loadCloudCalls: [] as string[],
  loadForAccountCalls: [] as unknown[],
  prepareCallback: undefined as ((requestId: string) => void) | undefined,
  prepareCleanup: vi.fn(),
  preserveCalls: [] as Array<{ requestId: string; state: AppState }>,
  root: undefined as { unmount: () => void } | undefined,
  saveCloudStates: [] as AppState[],
  shellProps: undefined as unknown,
  stateSetter: undefined as unknown,
  subscriptionCallback: undefined as (() => void) | undefined,
  syncCalls: [] as AppState[],
  syncQueue: [] as Array<{ error?: boolean; state?: AppState }>,
  unsubscribe: vi.fn()
}));

const isAppState = (value: unknown): value is AppState =>
  typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'profiles')) && Array.isArray(Reflect.get(value, 'tournaments'));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isAppState(result[0])) {
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
      const render = root.render.bind(root);
      root.render = (children: ReactNode) => {
        const pending: unknown[] = [children];
        while (pending.length) {
          const child = pending.pop();
          if (typeof child !== 'object' || child === null) continue;
          if ('type' in child && typeof child.type === 'function' && child.type.name === 'App') {
            harness.appComponent = child.type;
            break;
          }
          if ('props' in child && typeof child.props === 'object' && child.props !== null && 'children' in child.props) {
            const nested: unknown = child.props.children;
            pending.push(...(Array.isArray(nested) ? nested : [nested]));
          }
        }
        render(children);
      };
      harness.root = root;
      return root;
    }
  };
});

vi.mock('../components/AppShell', () => ({
  default: (props: { children?: ReactNode }) => {
    harness.shellProps = props;
    return props.children ?? null;
  }
}));
vi.mock('../components/FloorView', () => ({
  default: (props: { seatPickerModal?: ReactNode }) => {
    harness.floorProps = props;
    return props.seatPickerModal ?? null;
  }
}));
vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: true }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async (accountKey: string) => {
    harness.loadCloudCalls.push(accountKey);
    if (harness.cloudError) throw new Error('isolated cloud offline');
    return harness.cloudResult;
  }),
  saveClubStateToFirebase: vi.fn(async (state: AppState) => {
    harness.saveCloudStates.push(state);
  }),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn((_accountKey: string, callback: () => void) => {
    harness.subscriptionCallback = callback;
    return harness.unsubscribe;
  }),
  syncPlayerUpdatesToClubState: vi.fn(async (state: AppState) => {
    harness.syncCalls.push(state);
    const result = harness.syncQueue.shift();
    if (result?.error) throw new Error('isolated reconciliation failure');
    return result?.state ?? state;
  })
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const now = '2026-08-08T22:00:00.000Z';
const access = {
  authorized: true,
  authorizationCode: 'REF-018-DESKTOP-AUTH',
  expiresAt: '2099-12-31T23:59:59.000Z',
  activatedAt: '2026-08-08T12:00:00.000Z',
  licenseId: 'REF-018-DESKTOP'
};
const accountKey = 'ref-018-desktop';
const accountStorageKey = `table-manager-state-v1:${accountKey}`;

const profile = (id: string, name: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id, name, phone: '', birthday: '', membershipStartDate: '', membershipExpirationDate: '', totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'game-desktop', preferredGameIds: ['game-desktop'],
  gamePlayCounts: {}, mostPlayedGameId: 'game-desktop', preferredStakes: '', typicalBuyInMin: 100, typicalBuyInMax: 300,
  willingnessToMove: true, typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: '', ...overrides
});

const buildState = (marker: string): AppState => ({
  ...structuredClone(seedState),
  games: [{ id: 'game-desktop', name: marker, maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }],
  profiles: [profile('profile-shared', `${marker} Player`)],
  interests: [{ id: 'interest-delete', profileId: 'profile-shared', playerName: `${marker} Player`, gameId: 'game-desktop', status: 'Arrived', timestamp: now, interestedAt: now, arrivedAt: now, notes: marker }],
  tournaments: [],
  revenueTransactions: [],
  usageEvents: [],
  settings: { ...structuredClone(seedState.settings), pilotAccess: access, accountLogin: { username: 'desktop@example.test', passwordSalt: 'salt', passwordHash: 'hash', createdAt: now } }
});

const record = (marker: string, savedAt: string): PersistedStateRecord => ({ schemaVersion: 4, savedAt, state: buildState(marker) });

const getState = () => {
  if (!isAppState(harness.latestState)) throw new Error('Expected application state');
  return harness.latestState;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const advance = async (milliseconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await flush();
};

const setLocalState = (state: AppState, authenticated = true) => {
  localStorage.clear();
  localStorage.setItem(accountStorageKey, JSON.stringify(state));
  localStorage.setItem('table-manager-state-v1:last-account', accountStorageKey);
  if (authenticated) {
    localStorage.setItem(`table-manager-state-v1:auth:${accountKey}`, JSON.stringify({ expiresAt: access.expiresAt }));
  }
};

const remount = async (localState: AppState, authenticated = true) => {
  if (harness.root) act(() => harness.root?.unmount());
  setLocalState(localState, authenticated);
  document.body.innerHTML = '<div id="root"></div>';
  const component = harness.appComponent;
  if (typeof component !== 'function') throw new Error('Expected captured App component');
  await act(async () => {
    createRoot(document.querySelector('#root')!).render(
      <React.StrictMode>{React.createElement(component as ComponentType)}</React.StrictMode>
    );
  });
  for (let attempt = 0; attempt < 4; attempt += 1) await flush();
  await advance(1);
  await flush();
};

const invokeFloor = async (name: string, ...args: unknown[]) => {
  if (typeof harness.floorProps !== 'object' || harness.floorProps === null) throw new Error('Expected Floor props');
  const callback: unknown = Reflect.get(harness.floorProps, name);
  if (typeof callback !== 'function') throw new Error(`Expected ${name}`);
  let result: unknown;
  await act(async () => { result = await Reflect.apply(callback, undefined, args); });
  return result;
};

describe('management desktop authoritative API persistence orchestration', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    window.location.hash = '#floor';
    setLocalState(buildState('initial-local'));
    harness.desktopLoadResult = record('desktop-older', '2026-08-08T20:00:00.000Z');
    harness.desktopPollResult = harness.desktopLoadResult;
    harness.cloudResult = record('cloud-newer', '2026-08-08T21:00:00.000Z');
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => {
        harness.desktopLoadCalls += 1;
        const state = typeof harness.desktopLoadResult === 'object' && harness.desktopLoadResult !== null
          ? Reflect.get(harness.desktopLoadResult, 'state')
          : undefined;
        const games = typeof state === 'object' && state !== null ? Reflect.get(state, 'games') : undefined;
        harness.desktopLoadMarkers.push(Array.isArray(games) ? String(Reflect.get(games[0], 'name')) : 'missing');
        return harness.desktopLoadResult;
      }),
      loadStateForAccount: vi.fn(async (pilotAccess: unknown) => {
        harness.loadForAccountCalls.push(pilotAccess);
        if (harness.desktopPollError) throw new Error('isolated desktop API offline');
        return harness.desktopPollResult;
      }),
      onPrepareForUpdate: vi.fn((callback: (requestId: string) => void) => {
        harness.prepareCallback = callback;
        return harness.prepareCleanup;
      }),
      openWindow: vi.fn(async () => undefined),
      preserveStateForUpdate: vi.fn(async (requestId: string, state: AppState) => {
        harness.preserveCalls.push({ requestId, state });
        return { ok: true };
      }),
      recordClientError: vi.fn(async () => ({ ok: true })),
      recordClientEvent: vi.fn(async () => ({ ok: true })),
      saveState: vi.fn(async (state: AppState) => {
        harness.desktopSaveStates.push(state);
        if (harness.desktopSaveError) throw new Error('isolated desktop save failure');
        return { ...(harness.desktopSaveResult ?? { ok: true }), path: 'fixture' };
      }),
      sendTextMessages: vi.fn(async () => ({ ok: true })),
      submitAnalyticalReport: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: true, active: true, license: { expiresAt: access.expiresAt, licenseId: access.licenseId } }))
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      harness.fetchCalls.push(String(input));
      return new Response(null, { status: 404 });
    }));
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import('../main');
    });
    await flush();
  });

  afterAll(() => {
    if (harness.root) act(() => harness.root?.unmount());
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  it('pins API/cache startup, server save, authoritative polling, preservation, notifications, and cleanup', async () => {
    expect(getState().games[0].name).toBe('initial-local');
    expect(harness.loadCloudCalls).toEqual([]);

    harness.desktopLoadResult = record('desktop-newer', '2026-08-08T21:30:00.000Z');
    harness.desktopPollResult = harness.desktopLoadResult;
    harness.cloudResult = record('cloud-stale', '2026-08-08T21:00:00.000Z');
    const loadsBeforeStaleMount = harness.desktopLoadCalls;
    await remount(buildState('stale-local'), false);
    expect(harness.desktopLoadCalls).toBeGreaterThan(loadsBeforeStaleMount);
    expect(harness.desktopLoadMarkers.at(-1)).toBe('desktop-newer');
    expect(JSON.parse(localStorage.getItem(accountStorageKey) ?? '{}')).toMatchObject({ games: [{ name: 'desktop-newer' }] });
    expect(getState().games[0].name).toBe('desktop-newer');

    harness.desktopLoadResult = record('desktop-offline-cloud', '2026-08-08T21:45:00.000Z');
    harness.desktopPollResult = harness.desktopLoadResult;
    harness.cloudError = true;
    await remount(buildState('offline-cloud-local'), false);
    expect(getState().games[0].name).toBe('desktop-offline-cloud');
    harness.cloudError = false;
    harness.cloudResult = null;

    harness.desktopLoadResult = record('runtime-desktop', '2026-08-08T21:50:00.000Z');
    harness.desktopPollResult = harness.desktopLoadResult;
    await remount(buildState('runtime-local'));

    harness.desktopSaveStates.length = 0;
    harness.saveCloudStates.length = 0;
    harness.fetchCalls.length = 0;
    await invokeFloor('deleteInterest', 'interest-delete');
    const checkedOutInterests = getState().interests;
    expect(checkedOutInterests).toEqual([
      expect.objectContaining({ id: 'interest-delete', status: 'Removed', closedAt: expect.any(String) })
    ]);
    expect(JSON.parse(localStorage.getItem(accountStorageKey) ?? '{}')).toMatchObject({
      interests: [expect.objectContaining({
        id: 'interest-delete',
        status: 'Removed',
        closedAt: checkedOutInterests[0]?.closedAt,
        timestamp: checkedOutInterests[0]?.timestamp
      })]
    });
    expect(harness.desktopSaveStates.at(-1)?.interests).toEqual(checkedOutInterests);
    expect(harness.saveCloudStates).toEqual([]);
    expect(harness.fetchCalls).toEqual([]);

    const stateAtPrepare = getState();
    harness.prepareCallback?.('update-request');
    await flush();
    expect(harness.preserveCalls.at(-1)).toEqual({ requestId: 'update-request', state: stateAtPrepare });

    harness.desktopPollResult = {
      schemaVersion: 4,
      savedAt: '2026-08-08T22:00:03.000Z',
      state: {
        ...getState(),
        profiles: [
          { ...getState().profiles[0], name: 'Desktop Replacement' },
          profile('profile-desktop-new', 'Desktop New')
        ],
        interests: [{ id: 'interest-desktop-new', profileId: 'profile-desktop-new', playerName: 'Desktop New', gameId: 'game-desktop', status: 'Interested', timestamp: '2026-08-08T21:59:00.000Z', interestedAt: '2026-08-08T21:59:00.000Z', notes: '' }]
      }
    } satisfies PersistedStateRecord;
    await advance(3000);
    expect(getState().profiles.map((candidate) => candidate.name)).toEqual(['Desktop Replacement', 'Desktop New']);
    expect(getState().interests.map((interest) => interest.id)).toEqual(['interest-desktop-new']);
    const persistedNotifications = JSON.parse(
      localStorage.getItem('table-manager-state-v1:staff-notifications') ?? '[]'
    ) as Array<Record<string, unknown>>;
    expect(persistedNotifications).toEqual([
      {
        id: 'seat-interest-desktop-new',
        kind: 'seat',
        createdAt: '2026-08-08T22:00:03.002Z',
        read: false
      }
    ]);
    expect(JSON.stringify(persistedNotifications)).not.toContain('Desktop New');

    const afterDesktopMerge = getState();
    harness.desktopPollError = true;
    await advance(3000);
    expect(getState()).toBe(afterDesktopMerge);
    harness.desktopPollError = false;
    harness.desktopPollResult = { schemaVersion: 4, savedAt: now, state: afterDesktopMerge };

    await advance(30_000);
    expect(getState()).toBe(afterDesktopMerge);
    expect(harness.syncCalls).toEqual([]);
    expect(harness.subscriptionCallback).toBeUndefined();

    const pollsBeforeCleanup = harness.loadForAccountCalls.length;
    const syncsBeforeCleanup = harness.syncCalls.length;
    const unsubscribeBeforeCleanup = harness.unsubscribe.mock.calls.length;
    const prepareCleanupBefore = harness.prepareCleanup.mock.calls.length;
    act(() => harness.root?.unmount());
    await advance(30_000);
    expect(harness.loadForAccountCalls).toHaveLength(pollsBeforeCleanup);
    expect(harness.syncCalls).toHaveLength(syncsBeforeCleanup);
    expect(harness.unsubscribe).toHaveBeenCalledTimes(unsubscribeBeforeCleanup);
    expect(harness.prepareCleanup).toHaveBeenCalledTimes(prepareCleanupBefore + 1);
  });
  it('propagates payload preflight rejection before the desktop bridge', async () => {
    const state = buildState('payload-characterization');
    state.sessions = [{ id: 'table-test', gameId: 'game-desktop', label: 'Table test', status: 'Running', seatsFilled: 1, maxSeats: 8, timeFeeBased: true, collectionMode: 'Time', tags: [], startedAt: now }];
    state.playerSessions = [{ id: 'player-test', playerName: state.profiles[0].name, profileId: state.profiles[0].id, gameId: 'game-desktop', tableId: 'table-test', seatNumber: 1, seatedAt: now, timePurchasedMinutes: 60, timeRemainingMinutes: 60, lastTimeTickAt: now, timeFeeEnabled: true }];
    state.profiles[0].notes = 'x'.repeat(1_999_900 - new TextEncoder().encode(JSON.stringify(state)).byteLength);
    harness.desktopLoadResult = null;
    harness.desktopPollResult = null;
    await remount(state);
    harness.desktopSaveStates.length = 0;
    const result = await invokeFloor('addPlayerTime', getState().playerSessions[0], 30);
    expect(result).toMatchObject({ ok: false, status: 'preflight-rejected' });
    expect(harness.desktopSaveStates).toHaveLength(0);
    expect(getState().playerSessions[0].timePurchasedMinutes).toBe(60);
    expect(Reflect.get(harness.shellProps as object, 'saveState')).toBe('error');
  });

  const tableState = (): AppState => ({
    ...buildState('mutation'),
    sessions: [{ id: 'table-test', gameId: 'game-desktop', label: 'Table test', status: 'Running', seatsFilled: 0, maxSeats: 8, timeFeeBased: true, collectionMode: 'Time', tags: [], startedAt: now }],
    playerSessions: []
  });
  const replaceState = async (state: AppState) => {
    const setter = harness.stateSetter;
    if (typeof setter !== 'function') throw new Error('Missing state setter');
    await act(async () => { Reflect.apply(setter, undefined, [state]); });
  };
  const pad = (state: AppState, bytes: number) => {
    const next = structuredClone(state);
    next.profiles[0].notes = '';
    next.profiles[0].notes = 'x'.repeat(bytes - new TextEncoder().encode(JSON.stringify(next)).byteLength);
    return next;
  };
  const mountTable = async () => {
    harness.desktopSaveResult = undefined;
    harness.desktopLoadResult = null;
    harness.desktopPollResult = null;
    await remount(tableState());
    harness.desktopSaveStates.length = 0;
    vi.spyOn(window, 'prompt').mockReturnValue('Synthetic correction');
  };

  it('seats below the limit through the real seat picker and saves the operational records', async () => {
    await mountTable();
    await replaceState(pad(getState(), 1_998_500));
    await invokeFloor('openSeatPicker', getState().sessions[0], 1);
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.seat-picker-card')).find(item => item.textContent?.includes('mutation Player'));
    expect(button).toBeTruthy();
    await act(async () => { button?.click(); });
    await flush();
    expect(document.querySelector('.seat-picker-modal')).toBeNull();
    const saved = harness.desktopSaveStates.at(-1)!;
    expect(saved.sessions[0].seatsFilled).toBe(1);
    expect(saved.playerSessions[0]).toMatchObject({ profileId: 'profile-shared', seatNumber: 1 });
    expect(saved.interests[0].status).toBe('Seated');
    expect(saved.playerLedger.some(item => item.type === 'Check-In')).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(saved)).byteLength).toBeLessThanOrEqual(2_000_000);
  });

  it.each(['profile', 'typed'])('keeps the %s seat picker open when seating crosses the limit', async (kind) => {
    await mountTable();
    await replaceState(pad(getState(), 1_999_900));
    await invokeFloor('openSeatPicker', getState().sessions[0], 1);
    if (kind === 'typed') {
      const input = document.querySelector<HTMLInputElement>('.seat-picker-modal input[placeholder]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => { setter.call(input, 'Typed Synthetic'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    const button = kind === 'profile'
      ? Array.from(document.querySelectorAll<HTMLButtonElement>('.seat-picker-card')).find(item => item.textContent?.includes('mutation Player'))
      : document.querySelector<HTMLButtonElement>('.seat-picker-modal button[type="submit"]');
    await act(async () => { button?.click(); });
    await flush();
    expect(harness.desktopSaveStates).toHaveLength(0);
    expect(getState().playerSessions).toHaveLength(0);
    expect(document.querySelector('.seat-picker-modal')).not.toBeNull();
    expect(document.querySelector('.seat-picker-error')?.textContent).toContain('2,000,000-byte');
  });

  it.each(['addPlayerTime', 'deductPlayerTime'])('rejects %s across the limit without saving or changing balances', async (action) => {
    await mountTable();
    await invokeFloor('seatInterestAtTable', getState().interests[0], 'table-test', 1);
    await invokeFloor('addPlayerTime', getState().playerSessions[0], 60);
    await replaceState(pad(getState(), 1_999_900));
    harness.desktopSaveStates.length = 0;
    const before = getState();
    const result = await invokeFloor(action, before.playerSessions[0], 30);
    expect(result).toMatchObject({ ok: false, status: 'preflight-rejected', error: expect.stringContaining('2,000,000-byte') });
    if (!result || typeof result !== 'object') throw new Error('Missing failure outcome');
    expect(Reflect.get(result, 'error')).toMatch(/2,00[0-9],[0-9]{3} bytes/);
    expect(getState()).toBe(before);
    expect(harness.desktopSaveStates).toHaveLength(0);
  });

  it('preserves receipts, table events, and negative correction records on accepted time changes', async () => {
    await mountTable();
    await invokeFloor('seatInterestAtTable', getState().interests[0], 'table-test', 1);
    const selected = getState().playerSessions[0];
    expect(await invokeFloor('addPlayerTime', selected, 60)).toMatchObject({ ok: true, status: 'authoritative-saved' });
    expect(await invokeFloor('deductPlayerTime', selected, 30)).toMatchObject({ ok: true });
    const saved = harness.desktopSaveStates.at(-1)!;
    expect(saved.playerSessions[0].timePurchasedMinutes).toBe(30);
    expect(saved.timeFeeLogs.map(log => log.minutes)).toEqual([60, -30]);
    expect(saved.tableEvents.some(event => event.reason === 'time added')).toBe(true);
    expect(saved.correctionLog.length).toBeGreaterThan(0);
  });

  it('uses a newer sync snapshot through a previously captured seating callback', async () => {
    await mountTable();
    const captured = Reflect.get(harness.floorProps as object, 'seatInterestAtTable');
    if (typeof captured !== 'function') throw new Error('Missing seating callback');
    const stateA = getState();
    const stateB = { ...stateA, profiles: [{ ...stateA.profiles[0], notes: 'server-B' }], tableEvents: [{ id: 'event-B', type: 'Started' as const, gameId: 'game-desktop', tableId: 'table-test', timestamp: now, playerCount: 0 }] };
    harness.desktopPollResult = { schemaVersion: 4, savedAt: now, authoritative: true, revision: 2, state: stateB };
    await advance(3000);
    await act(async () => { await Reflect.apply(captured, undefined, [stateA.interests[0], 'table-test', 1]); });
    expect(harness.desktopSaveStates.at(-1)?.profiles[0].notes).toBe('server-B');
    expect(harness.desktopSaveStates.at(-1)?.tableEvents.some(item => item.id === 'event-B')).toBe(true);
  });

  it.each(['seatInterestAtTable', 'addPlayerTime', 'deductPlayerTime'])('rejects %s conflicts and reloads newer authoritative state without replay', async (action) => {
    await mountTable();
    if (action !== 'seatInterestAtTable') {
      await invokeFloor('seatInterestAtTable', getState().interests[0], 'table-test', 1);
      await invokeFloor('addPlayerTime', getState().playerSessions[0], 60);
    }
    const authoritative = { ...getState(), profiles: [{ ...getState().profiles[0], notes: 'server-N+1' }] };
    harness.desktopPollResult = { schemaVersion: 4, savedAt: now, state: authoritative, authoritative: true, revision: 2 };
    harness.desktopSaveResult = { ok: false, conflict: true, error: 'STATE_REVISION_CONFLICT' };
    harness.desktopSaveStates.length = 0;
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const result = action === 'seatInterestAtTable'
      ? await invokeFloor(action, getState().interests[0], 'table-test', 1)
      : await invokeFloor(action, getState().playerSessions[0], 30);
    expect(result).toMatchObject({ ok: false, status: 'revision-conflict' });
    expect(harness.desktopSaveStates).toHaveLength(1);
    expect(getState().profiles[0].notes).toBe('server-N+1');
    expect(getState().playerSessions).toMatchObject(authoritative.playerSessions);
    expect(JSON.parse(localStorage.getItem(accountStorageKey)!)).toMatchObject({ profiles: [{ notes: 'server-N+1' }] });
    harness.desktopSaveResult = undefined;
  });

  it.each(['profile', 'typed'])('constructs %s seating from B through a picker callback captured in A', async (kind) => {
    await mountTable();
    await invokeFloor('openSeatPicker', getState().sessions[0], 1);
    if (kind === 'typed') {
      const input = document.querySelector<HTMLInputElement>('.seat-picker-modal input[placeholder]')!;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => { setter.call(input, 'Typed Synthetic'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    const pending: unknown[] = [Reflect.get(harness.floorProps as object, 'seatPickerModal')];
    let callback: unknown;
    while (pending.length) {
      const item = pending.pop();
      if (Array.isArray(item)) { pending.push(...item); continue; }
      if (!item || typeof item !== 'object') continue;
      const props: unknown = Reflect.get(item, 'props');
      if (props && typeof props === 'object') {
        if (Reflect.get(props, 'className') === 'seat-picker-card') { callback = Reflect.get(props, 'onClick'); break; }
        const children: unknown = Reflect.get(props, 'children');
        pending.push(...(Array.isArray(children) ? children : [children]));
      }
      const children: unknown = Reflect.get(item, 'children');
      pending.push(...(Array.isArray(children) ? children : [children]));
    }
    if (typeof callback !== 'function') throw new Error('Missing captured picker action');
    const stateA = getState();
    const stateB = { ...stateA, profiles: [{ ...stateA.profiles[0], notes: 'server-B-picker' }], tableEvents: [{ id: 'picker-event-B', type: 'Started' as const, gameId: 'game-desktop', tableId: 'table-test', timestamp: now, playerCount: 0 }] };
    harness.desktopPollResult = { schemaVersion: 4, savedAt: now, authoritative: true, revision: 2, state: stateB };
    await advance(3000);
    await act(async () => { await Reflect.apply(callback, undefined, []); });
    expect(harness.desktopSaveStates.at(-1)?.profiles[0].notes).toBe('server-B-picker');
    expect(harness.desktopSaveStates.at(-1)?.tableEvents.some(event => event.id === 'picker-event-B')).toBe(true);
  });

});
