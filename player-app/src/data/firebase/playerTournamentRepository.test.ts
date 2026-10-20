import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerTournament, PlayerTournamentInterest } from '../../domain/playerSync';
import type { fetchPublicPlayerDiscovery, fetchRemotePlayerDiscovery } from '../api/playerHttpApi';
import type { FirebasePlayerIdentity } from './playerAuth';
import { fetchPlayerTournaments, registerForTournament, subscribeToPlayerTournaments } from './playerTournamentRepository';

type DiscoveryResult = Awaited<ReturnType<typeof fetchRemotePlayerDiscovery>>;
const boundary = vi.hoisted(() => {
  let identity: FirebasePlayerIdentity | null = null;
  return {
    setIdentity(value: FirebasePlayerIdentity | null) { identity = value; },
    currentIdentity: vi.fn(() => identity),
    publicDiscovery: vi.fn<typeof fetchPublicPlayerDiscovery>(),
    remoteDiscovery: vi.fn<typeof fetchRemotePlayerDiscovery>(),
    ensureIdentity: vi.fn(),
    mutate: vi.fn(),
    register: vi.fn()
  };
});
vi.mock('../api/playerHttpApi', () => ({
  fetchPublicPlayerDiscovery: boundary.publicDiscovery,
  fetchRemotePlayerDiscovery: boundary.remoteDiscovery,
  submitRemoteTournamentMutation: boundary.mutate,
  submitRemoteTournamentRegistration: boundary.register
}));
vi.mock('./playerAuth', () => ({
  getCurrentFirebasePlayer: boundary.currentIdentity,
  ensureSignedInIdentity: boundary.ensureIdentity
}));

function signIn(uid = 'owner-a') {
  boundary.setIdentity({ uid, email: 'tournament-qa@example.invalid', name: 'Tournament QA', provider: 'email', verified: true });
}
function tournament(overrides: Partial<PlayerTournament> = {}): PlayerTournament {
  return { id: 'event-shared', clubId: 'club-a', name: 'Fixture Holdem Event', startsAt: '2099-06-10T18:00:00.000Z',
    interestOpensAt: '2026-01-01T00:00:00.000Z', interestClosesAt: '2099-06-10T17:00:00.000Z', interestStatus: 'open',
    buyIn: 100, rebuysAllowed: false, addOnsAllowed: false, withdrawalAllowed: true, rules: [], ...overrides };
}
function interest(overrides: Partial<PlayerTournamentInterest> = {}): PlayerTournamentInterest {
  return { id: 'interest-a', tournamentId: 'event-shared', clubId: 'club-a', playerId: 'owner-a', status: 'interested',
    createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z', ...overrides };
}
function page(tournaments: PlayerTournament[] = [], interests: PlayerTournamentInterest[] = [], overrides: Partial<DiscoveryResult['page']> = {}, clubIds: string[] = []): DiscoveryResult {
  const clubs: DiscoveryResult['clubs'] = clubIds.map((id) => ({ club: { id, name: 'Fixture ' + id }, games: [], memberships: [], waitlists: [], notifications: [],
    social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 }, generatedAt: '2026-06-01T10:00:00.000Z' }));
  return { ok: true, clubs, tournaments, interests,
    page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2, ...overrides } };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Fixture deferred promise was not initialized.'); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks(); boundary.setIdentity(null);
  boundary.publicDiscovery.mockRejectedValue(new Error('Unexpected public fixture discovery request.'));
  boundary.remoteDiscovery.mockRejectedValue(new Error('Unexpected authenticated fixture discovery request.'));
});
afterEach(() => vi.useRealTimers());

describe('tournament repository authentication and lifecycle characterization', () => {
  it('registers only zero-cost published events using an identity-bound opaque API request', async () => {
    signIn(); boundary.ensureIdentity.mockReturnValue('owner-a');
    const event = tournament({ buyIn: 0, registrationAvailable: true });
    const player = { id: 'owner-a', name: 'Fixture Player', email: 'fixture@example.invalid', preferredGameIds: [], favoriteClubIds: [], searchRadiusMiles: 25 };
    const registration = { id: 'entry-a', clubId: event.clubId, tournamentId: event.id, playerId: player.id, status: 'registered', registeredAt: '2026-10-20T12:00:00Z' };
    boundary.register.mockResolvedValue(registration);
    await expect(registerForTournament(event, player, 'opaque-registration-id')).resolves.toEqual(registration);
    expect(boundary.register).toHaveBeenCalledExactlyOnceWith({ clubId: event.clubId, tournamentId: event.id, mutationId: 'opaque-registration-id' }, player.id);
    expect(boundary.mutate).not.toHaveBeenCalled();
    await expect(registerForTournament({ ...event, buyIn: 100 }, player, 'other-opaque-id')).rejects.toThrow('Only events without');
    await expect(registerForTournament({ ...event, addOnsAllowed: true, addOnPrice: 20 }, player, 'other-opaque-id')).rejects.toThrow('Only events without');
    await expect(registerForTournament({ ...event, rebuysAllowed: true }, player, 'other-opaque-id')).rejects.toThrow('Only events without');
    expect(boundary.register).toHaveBeenCalledOnce();
  });

  it('strips registration projections from public catalog data and foreign account results', async () => {
    const registration = { id: 'entry-a', clubId: 'club-a', tournamentId: 'event-shared', playerId: 'owner-a', status: 'registered' as const, registeredAt: '2026-10-20T12:00:00Z' };
    const event = tournament({ registrationAvailable: true, registration });
    boundary.publicDiscovery.mockResolvedValue(page([event]));
    expect((await fetchPlayerTournaments()).tournaments[0]).not.toHaveProperty('registration');
    signIn();
    boundary.remoteDiscovery.mockResolvedValue(page([event]));
    expect((await fetchPlayerTournaments('owner-a')).tournaments[0].registration).toEqual(registration);
    boundary.remoteDiscovery.mockResolvedValue(page([{ ...event, registration: { ...registration, playerId: 'owner-b' } }]));
    expect((await fetchPlayerTournaments('owner-a')).tournaments[0]).not.toHaveProperty('registration');
  });
  it('loads public events without exposing supplied interests or switching to authenticated discovery', async () => {
    const event = tournament(), response = page([event], [interest()]);
    boundary.publicDiscovery.mockResolvedValueOnce(response);
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [event], interests: [], page: response.page });
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce();
    const [cursor = '', limit = 50] = boundary.publicDiscovery.mock.calls[0];
    expect({ cursor, limit }).toEqual({ cursor: '', limit: 50 });
    expect(boundary.remoteDiscovery).not.toHaveBeenCalled(); expect(boundary.mutate).not.toHaveBeenCalled();
  });

  it('returns the exact completed-page metadata and only the signed-in owner active interests', async () => {
    signIn(); const event = tournament(), active = interest();
    const response = page([event], [active, interest({ id: 'foreign', playerId: 'owner-b' }), interest({ id: 'withdrawn', tournamentId: 'another-event', status: 'withdrawn' })]);
    boundary.remoteDiscovery.mockResolvedValueOnce(response);
    await expect(fetchPlayerTournaments('owner-a')).resolves.toEqual({ tournaments: [event], interests: [active], page: response.page });
    expect(boundary.remoteDiscovery).toHaveBeenCalledExactlyOnceWith('', 50, 'owner-a');
    expect(boundary.publicDiscovery).not.toHaveBeenCalled(); expect(boundary.mutate).not.toHaveBeenCalled();
  });

  it.each([undefined, 'owner-b'])('rejects profile %s before requesting data for the signed-in owner', async (playerId) => {
    signIn(); await expect(fetchPlayerTournaments(playerId)).rejects.toThrow('does not match this profile');
    expect(boundary.publicDiscovery).not.toHaveBeenCalled(); expect(boundary.remoteDiscovery).not.toHaveBeenCalled();
  });

  it.each(['public', 'authenticated'])('propagates an initial %s failure without a different authority fallback', async (mode) => {
    if (mode === 'authenticated') signIn();
    const request = mode === 'authenticated' ? boundary.remoteDiscovery : boundary.publicDiscovery;
    request.mockRejectedValueOnce(new Error('Initial fixture discovery failed.'));
    await expect(fetchPlayerTournaments(mode === 'authenticated' ? 'owner-a' : undefined)).rejects.toThrow('Initial fixture discovery failed.');
    expect(request).toHaveBeenCalledOnce();
    expect(mode === 'authenticated' ? boundary.publicDiscovery : boundary.remoteDiscovery).not.toHaveBeenCalled();
  });

  it('coalesces overlapping refreshes and retires late results and timers after unsubscribe', async () => {
    vi.useFakeTimers(); const pending = deferred<DiscoveryResult>();
    boundary.publicDiscovery.mockReturnValueOnce(pending.promise);
    const callback = vi.fn(), onError = vi.fn(), subscription = subscribeToPlayerTournaments(undefined, callback, onError);
    const first = subscription.refresh(); expect(subscription.refresh()).toBe(first);
    subscription.startPolling(); await vi.advanceTimersByTimeAsync(60_000);
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    subscription.unsubscribe(); pending.resolve(page([tournament()])); await first;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps polling after an initial discovery error and then publishes an authoritative result', async () => {
    vi.useFakeTimers(); signIn(); const response = page([tournament()]);
    boundary.remoteDiscovery.mockRejectedValueOnce(new Error('Temporary fixture failure.')).mockResolvedValueOnce(response);
    const callback = vi.fn(), onError = vi.fn(), subscription = subscribeToPlayerTournaments('owner-a', callback, onError);
    await subscription.refresh(); expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Temporary fixture failure.' }));
    subscription.startPolling(); await vi.advanceTimersByTimeAsync(60_000);
    expect(callback).toHaveBeenCalledExactlyOnceWith({ tournaments: response.tournaments, interests: [], page: response.page });
    subscription.unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded tournament catalog paging', () => {
  it('applies the last encountered interest status within one page before filtering withdrawn records', async () => {
    signIn(); const event = tournament(), active = interest(), withdrawn = interest({ id: 'later-opaque-id', status: 'withdrawn' });
    boundary.remoteDiscovery.mockResolvedValueOnce(page([event], [active, withdrawn]));
    await expect(fetchPlayerTournaments('owner-a')).resolves.toEqual({ tournaments: [event], interests: [],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: 2 } });
    expect(boundary.remoteDiscovery).toHaveBeenCalledExactlyOnceWith('', 50, 'owner-a');
  });

  it('merges club-scoped public events across fifty-record pages with last-page replacement and stable first order', async () => {
    const first = tournament(), sameIdOtherClub = tournament({ clubId: 'club-b', name: 'Other venue event' });
    const replacement = tournament({ name: 'Later page event payload' });
    boundary.publicDiscovery.mockResolvedValueOnce(page([first, sameIdOtherClub], [interest()], { count: 2, hasMore: true, nextCursor: 'cursor-2', databaseQueries: 3 }, ['club-a', 'club-b']))
      .mockResolvedValueOnce(page([replacement], [interest()], { count: 2, databaseQueries: 4 }, ['club-a', 'club-c']));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [replacement, sameIdOtherClub], interests: [],
      page: { count: 3, hasMore: false, nextCursor: null, databaseQueries: 7 } });
    expect(boundary.publicDiscovery.mock.calls.map(([cursor = '', limit = 50]) => [cursor, limit])).toEqual([['', 50], ['cursor-2', 50]]);
    expect(boundary.remoteDiscovery).not.toHaveBeenCalled(); expect(boundary.mutate).not.toHaveBeenCalled();
  });

  it('merges each page owner interests by venue/event/owner and lets a later withdrawal remove an earlier active record', async () => {
    signIn(); const a = tournament(), b = tournament({ clubId: 'club-b' }), c = tournament({ id: 'event-c' });
    const activeA = interest(), activeB = interest({ id: 'same-opaque-id', clubId: 'club-b' });
    const withdrawnA = interest({ id: 'different-opaque-id', status: 'withdrawn' });
    const replacedB = interest({ id: 'same-opaque-id', clubId: 'club-b', updatedAt: '2026-06-02T10:00:00.000Z' });
    const activeC = interest({ id: 'same-opaque-id', tournamentId: 'event-c' });
    boundary.remoteDiscovery.mockResolvedValueOnce(page([a, b], [activeA, activeB, interest({ playerId: 'owner-b', id: 'foreign-first' })], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(page([c], [withdrawnA, replacedB, activeC, interest({ playerId: 'owner-b', id: 'foreign-later' })]));
    await expect(fetchPlayerTournaments('owner-a')).resolves.toMatchObject({ tournaments: [a, b, c], interests: [replacedB, activeC], page: { hasMore: false, nextCursor: null } });
    expect(boundary.remoteDiscovery.mock.calls).toEqual([['', 50, 'owner-a'], ['cursor-2', 50, 'owner-a']]);
    expect(boundary.publicDiscovery).not.toHaveBeenCalled();
  });

  it('continues past a successful empty page with a valid next cursor', async () => {
    const event = tournament();
    boundary.publicDiscovery.mockResolvedValueOnce(page([], [], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(page([event]));
    await expect(fetchPlayerTournaments()).resolves.toMatchObject({ tournaments: [event], page: { hasMore: false, nextCursor: null, databaseQueries: 4 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(2);
  });

  it('retains an authenticated prefix and resume cursor after a later request fails without public fallback', async () => {
    signIn(); const event = tournament(), own = interest();
    boundary.remoteDiscovery.mockResolvedValueOnce(page([event], [own], { count: 1, hasMore: true, nextCursor: 'cursor-2' }, ['club-a']))
      .mockRejectedValueOnce(new Error('Later fixture page unavailable.'));
    await expect(fetchPlayerTournaments('owner-a')).resolves.toEqual({ tournaments: [event], interests: [own],
      page: { count: 1, hasMore: true, nextCursor: 'cursor-2', databaseQueries: 2 } });
    expect(boundary.remoteDiscovery.mock.calls).toEqual([['', 50, 'owner-a'], ['cursor-2', 50, 'owner-a']]);
    expect(boundary.publicDiscovery).not.toHaveBeenCalled();
  });

  it('reports a later failure as partial even when the successful first page contained no records', async () => {
    boundary.publicDiscovery.mockResolvedValueOnce(page([], [], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockRejectedValueOnce(new Error('Later fixture page unavailable.'));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [], interests: [],
      page: { count: 0, hasMore: true, nextCursor: 'cursor-2', databaseQueries: 2 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(2);
  });

  it.each([null, '', '   '])('rejects an empty initial catalog with invalid continuation %s', async (nextCursor) => {
    boundary.publicDiscovery.mockResolvedValueOnce(page([], [], { hasMore: true, nextCursor }));
    await expect(fetchPlayerTournaments()).rejects.toThrow(/cursor/i);
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce();
  });

  it('retains loaded events but marks an invalid continuation partial with no resumable cursor', async () => {
    const event = tournament();
    boundary.publicDiscovery.mockResolvedValueOnce(page([event], [], { hasMore: true, nextCursor: '   ' }));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [event], interests: [],
      page: { count: 0, hasMore: true, nextCursor: null, databaseQueries: 2 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce();
  });

  it('treats a loaded venue without events as an incomplete catalog when its continuation is invalid', async () => {
    boundary.publicDiscovery.mockResolvedValueOnce(page([], [], { count: 1, hasMore: true, nextCursor: '' }, ['club-a']));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [], interests: [],
      page: { count: 1, hasMore: true, nextCursor: null, databaseQueries: 2 } });
  });

  it('stops a repeated continuation after retaining both completed pages', async () => {
    const first = tournament(), second = tournament({ id: 'second-event' });
    boundary.publicDiscovery.mockResolvedValueOnce(page([first], [], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(page([second], [], { hasMore: true, nextCursor: 'cursor-2' }));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [first, second], interests: [],
      page: { count: 0, hasMore: true, nextCursor: null, databaseQueries: 4 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(2);
  });

  it('stops a cursor cycle rather than refetching a previously visited page or claiming completion', async () => {
    const events = ['one', 'two', 'three'].map((id) => tournament({ id }));
    boundary.publicDiscovery.mockResolvedValueOnce(page([events[0]], [], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(page([events[1]], [], { hasMore: true, nextCursor: 'cursor-3' }))
      .mockResolvedValueOnce(page([events[2]], [], { hasMore: true, nextCursor: 'cursor-2' }));
    await expect(fetchPlayerTournaments()).resolves.toMatchObject({ tournaments: events, page: { hasMore: true, nextCursor: null, databaseQueries: 6 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(3);
  });

  it('bounds a nonempty catalog at twenty fifty-record pages and retains its actual next cursor', async () => {
    const events = Array.from({ length: 21 }, (_, index) => tournament({ id: 'event-' + index, clubId: 'club-' + index }));
    boundary.publicDiscovery.mockImplementation(async (_cursor, limit) => {
      expect(limit ?? 50).toBe(50); const index = boundary.publicDiscovery.mock.calls.length - 1;
      return page([events[index]], [], { count: 1, hasMore: true, nextCursor: 'cursor-' + (index + 1) }, ['club-' + index]);
    });
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: events.slice(0, 20), interests: [],
      page: { count: 20, hasMore: true, nextCursor: 'cursor-20', databaseQueries: 40 } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(20);
    expect(boundary.publicDiscovery.mock.calls.map(([cursor = '']) => cursor)).toEqual(['', ...Array.from({ length: 19 }, (_, index) => 'cursor-' + (index + 1))]);
  });

  it('also caps twenty successful empty pages while preserving incomplete rather than empty-complete state', async () => {
    boundary.publicDiscovery.mockImplementation(async () => page([], [], { hasMore: true, nextCursor: 'cursor-' + boundary.publicDiscovery.mock.calls.length, databaseQueries: undefined }));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [], interests: [],
      page: { count: 0, hasMore: true, nextCursor: 'cursor-20', databaseQueries: undefined } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(20);
  });

  it('clears an irrelevant continuation when the authoritative final page says no more records', async () => {
    const event = tournament(); boundary.publicDiscovery.mockResolvedValueOnce(page([event], [], { nextCursor: 'not-a-continuation' }));
    await expect(fetchPlayerTournaments()).resolves.toMatchObject({ tournaments: [event], page: { hasMore: false, nextCursor: null } });
    expect(boundary.publicDiscovery).toHaveBeenCalledOnce();
  });

  it('does not invent a query count when no completed page supplies one', async () => {
    const event = tournament(); boundary.publicDiscovery.mockResolvedValueOnce(page([], [], { hasMore: true, nextCursor: 'cursor-2', databaseQueries: undefined }))
      .mockResolvedValueOnce(page([event], [], { databaseQueries: undefined }));
    await expect(fetchPlayerTournaments()).resolves.toEqual({ tournaments: [event], interests: [],
      page: { count: 0, hasMore: false, nextCursor: null, databaseQueries: undefined } });
    expect(boundary.publicDiscovery).toHaveBeenCalledTimes(2);
  });

  it.each(['owner-b', null])('rejects the entire private result if owner changes to %s during the first completed request', async (nextOwner) => {
    signIn(); boundary.remoteDiscovery.mockImplementationOnce(async () => {
      if (nextOwner) signIn(nextOwner); else boundary.setIdentity(null);
      return page([tournament()], [interest()]);
    });
    await expect(fetchPlayerTournaments('owner-a')).rejects.toThrow();
    expect(boundary.remoteDiscovery).toHaveBeenCalledExactlyOnceWith('', 50, 'owner-a');
    expect(boundary.publicDiscovery).not.toHaveBeenCalled();
  });

  it('rejects an owner change during a later failed request instead of returning a private partial prefix', async () => {
    signIn(); boundary.remoteDiscovery.mockResolvedValueOnce(page([tournament()], [interest()], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockImplementationOnce(async () => { signIn('owner-b'); throw new Error('Fixture owner changed.'); });
    await expect(fetchPlayerTournaments('owner-a')).rejects.toThrow();
    expect(boundary.remoteDiscovery.mock.calls).toEqual([['', 50, 'owner-a'], ['cursor-2', 50, 'owner-a']]);
    expect(boundary.publicDiscovery).not.toHaveBeenCalled();
  });
});
