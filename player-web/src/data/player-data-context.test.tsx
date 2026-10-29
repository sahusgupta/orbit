import type { User } from 'firebase/auth';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, interest, openTournament, player, runningGame } from '@/tests/fixtures';
import type { DiscoveryPayload, PlayerAccount } from '@/src/domain/types';

const dataHarness = vi.hoisted(() => ({
  auth: { user: null as User | null, player: null as PlayerAccount | null },
  fetchDiscovery: vi.fn(),
  submitMembership: vi.fn(),
  submitSeat: vi.fn(),
  expressInterest: vi.fn(),
  withdrawInterest: vi.fn(),
  onSnapshot: vi.fn<(reference: unknown, next: () => void, error: (error: Error) => void) => () => void>(() => vi.fn())
}));

vi.mock('@/src/auth/auth-context', () => ({
  useAuth: () => dataHarness.auth
}));

vi.mock('./player-api', () => ({
  fetchAuthenticatedDiscovery: dataHarness.fetchDiscovery,
  submitMembershipApplication: dataHarness.submitMembership,
  submitSeatRequest: dataHarness.submitSeat,
  expressTournamentInterest: dataHarness.expressInterest,
  withdrawTournamentInterest: dataHarness.withdrawInterest
}));

vi.mock('./firebase-client', () => ({
  getFirebaseBrowserClient: vi.fn(async () => ({ db: {} }))
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ path: 'clubs' })),
  onSnapshot: dataHarness.onSnapshot
}));

import { PlayerDataProvider, usePlayerData } from './player-data-context';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((next, fail) => { resolve = next; reject = fail; });
  return { promise, resolve, reject };
}

function makeUser(uid: string) {
  return { uid } as User;
}

function makePlayer(uid: string): PlayerAccount {
  return { ...player, id: uid, email: `${uid}@example.test` };
}

function discoveryFor(uid: string): DiscoveryPayload {
  return {
    clubs: [{
      ...clubAlpha,
      club: { ...clubAlpha.club, id: `club-${uid}`, name: `Club ${uid}` },
      games: clubAlpha.games.map((game) => ({ ...game, clubId: `club-${uid}` }))
    }],
    tournaments: [],
    interests: [],
    page: { count: 1, hasMore: false, nextCursor: null }
  };
}

function PlayerDataProbe({ onData }: { onData?(data: ReturnType<typeof usePlayerData>): void }) {
  const data = usePlayerData();
  useEffect(() => onData?.(data), [data, onData]);
  return (
    <div>
      <span data-testid="data-status">{data.status}</span>
      <span data-testid="club-ids">{data.clubs.map((club) => club.club.id).join(',') || 'none'}</span>
      <span data-testid="club-names">{data.clubs.map((club) => club.club.name).join(',') || 'none'}</span>
      <span data-testid="interest-scopes">{data.interests.map((item) => `${item.clubId}/${item.tournamentId}`).sort().join(',') || 'none'}</span>
      <button type="button" onClick={() => void data.refresh()}>Refresh</button>
    </div>
  );
}

function provider(onData?: (data: ReturnType<typeof usePlayerData>) => void) {
  return <PlayerDataProvider><PlayerDataProbe onData={onData} /></PlayerDataProvider>;
}

function clubDiscovery(name: string): DiscoveryPayload {
  return {
    clubs: [{ ...clubAlpha, club: { ...clubAlpha.club, name } }],
    tournaments: [],
    interests: [],
    page: { count: 1, hasMore: false, nextCursor: null }
  };
}

function renderPlayerData(signedIn = true) {
  dataHarness.auth.user = signedIn ? makeUser(player.id) : null;
  dataHarness.auth.player = signedIn ? makePlayer(player.id) : null;
  let current: ReturnType<typeof usePlayerData> | undefined;
  const view = render(provider((data) => { current = data; }));
  return {
    view,
    data() {
      if (!current) throw new Error('Player data context did not render.');
      return current;
    }
  };
}

function latestSnapshotListener() {
  const listener = dataHarness.onSnapshot.mock.calls.at(-1)?.[1];
  if (!listener) throw new Error('Firestore snapshot listener was not registered.');
  return listener;
}

function membershipOption() {
  const option = clubAlpha.club.membershipOptions?.[0];
  if (!option) throw new Error('Synthetic club has no membership option.');
  return option;
}

beforeEach(() => {
  dataHarness.auth.user = null;
  dataHarness.auth.player = null;
  dataHarness.fetchDiscovery.mockReset();
  dataHarness.submitMembership.mockReset();
  dataHarness.submitSeat.mockReset();
  dataHarness.expressInterest.mockReset();
  dataHarness.withdrawInterest.mockReset();
  dataHarness.onSnapshot.mockClear();
});

afterEach(cleanup);

describe('Player Web private discovery account isolation', () => {
  it('loads authenticated discovery immediately without waiting for a Firestore snapshot', async () => {
    dataHarness.auth.user = makeUser('account-a');
    dataHarness.auth.player = makePlayer('account-a');
    dataHarness.fetchDiscovery.mockResolvedValue(discoveryFor('account-a'));

    render(provider());

    await waitFor(() => expect(screen.getByTestId('club-ids')).toHaveTextContent('club-account-a'));
    expect(screen.getByTestId('data-status')).toHaveTextContent('ready');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'account-a' }),
      expect.any(AbortSignal)
    );
    expect(dataHarness.onSnapshot).toHaveBeenCalledOnce();
  });

  it('starts account B independently and never installs account A data after the UID changes', async () => {
    const accountA = deferred<DiscoveryPayload>();
    const accountB = deferred<DiscoveryPayload>();
    const requestSignals = new Map<string, AbortSignal>();
    dataHarness.fetchDiscovery.mockImplementation((user: User, signal: AbortSignal) => {
      requestSignals.set(user.uid, signal);
      return user.uid === 'account-a' ? accountA.promise : accountB.promise;
    });
    dataHarness.auth.user = makeUser('account-a');
    dataHarness.auth.player = makePlayer('account-a');
    const view = render(provider());

    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'account-a' }),
      expect.any(AbortSignal)
    ));

    await act(async () => {
      dataHarness.auth.user = makeUser('account-b');
      dataHarness.auth.player = makePlayer('account-b');
      view.rerender(provider());
    });
    expect(screen.getByTestId('club-ids')).toHaveTextContent('none');
    expect(screen.getByTestId('data-status')).toHaveTextContent('loading');
    expect(requestSignals.get('account-a')?.aborted).toBe(true);

    accountB.resolve(discoveryFor('account-b'));
    await waitFor(() => expect(screen.getByTestId('club-ids')).toHaveTextContent('club-account-b'));

    await act(async () => {
      accountA.resolve(discoveryFor('account-a'));
      await accountA.promise;
    });
    expect(screen.getByTestId('club-ids')).toHaveTextContent('club-account-b');
    expect(screen.getByTestId('club-ids')).not.toHaveTextContent('club-account-a');
  });

  it('clears private discovery on sign-out and rejects a retired account mutation before transport', async () => {
    const accountA = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockReturnValue(accountA.promise);
    dataHarness.auth.user = makeUser('account-a');
    dataHarness.auth.player = makePlayer('account-a');
    let accountAData: ReturnType<typeof usePlayerData> | undefined;
    const captureAccountA = (data: ReturnType<typeof usePlayerData>) => { accountAData = data; };
    const view = render(provider(captureAccountA));
    const retiredRequestSeat = accountAData?.requestSeat;
    if (!retiredRequestSeat) throw new Error('Player data context did not render.');

    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalled());

    await act(async () => {
      dataHarness.auth.user = null;
      dataHarness.auth.player = null;
      view.rerender(provider(captureAccountA));
    });
    expect(screen.getByTestId('club-ids')).toHaveTextContent('none');
    expect(screen.getByTestId('data-status')).toHaveTextContent('idle');

    await expect(retiredRequestSeat(clubAlpha, runningGame, { attendance: 'arrived' }))
      .rejects.toThrow(/account changed/i);
    expect(dataHarness.submitSeat).not.toHaveBeenCalled();

    await act(async () => {
      accountA.resolve(discoveryFor('account-a'));
      await accountA.promise;
    });
    expect(screen.getByTestId('club-ids')).toHaveTextContent('none');
  });

  it('upserts and withdraws only the matching venue when tournament and interest IDs collide', async () => {
    const firstTournament = { ...openTournament, id: 'shared-event', clubId: 'club-a', name: 'Alpha Event' };
    const secondTournament = { ...openTournament, id: 'shared-event', clubId: 'club-b', name: 'Beta Event' };
    const firstInterest = { ...interest, id: 'venue-local-interest', tournamentId: firstTournament.id, clubId: firstTournament.clubId };
    const secondInterest = { ...interest, id: 'venue-local-interest', tournamentId: secondTournament.id, clubId: secondTournament.clubId };
    const initial = {
      ...discoveryFor('account-a'),
      tournaments: [firstTournament, secondTournament],
      interests: [secondInterest]
    };
    dataHarness.auth.user = makeUser(player.id);
    dataHarness.auth.player = makePlayer(player.id);
    dataHarness.fetchDiscovery.mockResolvedValue(initial);
    dataHarness.expressInterest.mockResolvedValue(firstInterest);
    dataHarness.withdrawInterest.mockResolvedValue(undefined);
    let latestData: ReturnType<typeof usePlayerData> | undefined;
    render(provider((data) => { latestData = data; }));

    await waitFor(() => expect(screen.getByTestId('data-status')).toHaveTextContent('ready'));
    if (!latestData) throw new Error('Player data context did not render.');
    const activeData = latestData;
    await act(async () => activeData.expressInterest(firstTournament));
    expect(screen.getByTestId('interest-scopes')).toHaveTextContent('club-a/shared-event,club-b/shared-event');

    await act(async () => activeData.withdrawInterest(firstTournament));
    expect(screen.getByTestId('interest-scopes')).toHaveTextContent('club-b/shared-event');
    expect(dataHarness.withdrawInterest).toHaveBeenCalledWith(
      expect.objectContaining({ uid: player.id }),
      firstTournament,
      expect.any(AbortSignal)
    );
  });
});

describe('Player Web discovery refresh characterization', () => {
  it('retains loaded data on a failed refresh and recovers on the next refresh', async () => {
    dataHarness.fetchDiscovery.mockResolvedValueOnce(clubDiscovery('Initial'))
      .mockRejectedValueOnce(new Error('Synthetic read unavailable'))
      .mockResolvedValueOnce(clubDiscovery('Recovered'));
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));

    await act(async () => observer.data().refresh());
    expect(observer.data().status).toBe('error');
    expect(observer.data().error).toBe('Synthetic read unavailable');
    expect(screen.getByTestId('club-names')).toHaveTextContent('Initial');

    await act(async () => observer.data().refresh());
    expect(observer.data().status).toBe('ready');
    expect(observer.data().error).toBe('');
    expect(screen.getByTestId('club-names')).toHaveTextContent('Recovered');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(3);
  });

  it('does not overwrite or invalidate discovery for a rejected membership mutation', async () => {
    const read = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockResolvedValueOnce(clubDiscovery('Initial')).mockReturnValueOnce(read.promise);
    dataHarness.submitMembership.mockRejectedValue(new Error('Synthetic request rejected'));
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    let refresh: Promise<void> | undefined;
    act(() => { refresh = observer.data().refresh(); });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2));

    await act(async () => {
      await expect(observer.data().requestMembership(clubAlpha, membershipOption())).rejects.toThrow('Synthetic request rejected');
    });
    expect(screen.getByTestId('club-names')).toHaveTextContent('Initial');
    await act(async () => { read.resolve(clubDiscovery('Read completed')); await refresh; });
    expect(screen.getByTestId('club-names')).toHaveTextContent('Read completed');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it('applies a mutation acknowledged after a discovery read without another read', async () => {
    dataHarness.fetchDiscovery.mockResolvedValueOnce(clubDiscovery('Initial')).mockResolvedValueOnce(clubDiscovery('Refreshed'));
    dataHarness.submitMembership.mockResolvedValue({ ...clubAlpha, club: { ...clubAlpha.club, name: 'Approved' } });
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    await act(async () => observer.data().refresh());
    await act(async () => observer.data().requestMembership(clubAlpha, membershipOption()));
    expect(screen.getByTestId('club-names')).toHaveTextContent('Approved');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it('resolves a signed-in retired refresh without transport or synchronous throws', async () => {
    dataHarness.fetchDiscovery.mockResolvedValue(clubDiscovery('Initial'));
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    const retiredRefresh = observer.data().refresh;
    observer.view.unmount();
    let refresh: Promise<void> | undefined;
    expect(() => { refresh = retiredRefresh(); }).not.toThrow();
    await expect(refresh).resolves.toBeUndefined();
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledOnce();
  });

  it('rejects a signed-out retired refresh through its returned promise', async () => {
    const observer = renderPlayerData(false);
    const retiredRefresh = observer.data().refresh;
    observer.view.unmount();
    let refresh: Promise<void> | undefined;
    expect(() => { refresh = retiredRefresh(); }).not.toThrow();
    await expect(refresh).rejects.toThrow(/account changed/i);
    expect(dataHarness.fetchDiscovery).not.toHaveBeenCalled();
  });

  it('handles a synchronous transport failure and releases the owner for recovery', async () => {
    dataHarness.fetchDiscovery.mockImplementationOnce(() => { throw new Error('Synthetic transport throw'); })
      .mockResolvedValueOnce(clubDiscovery('Recovered'));
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('error'));
    expect(observer.data().error).toBe('Synthetic transport throw');
    await act(async () => observer.data().refresh());
    expect(observer.data().status).toBe('ready');
    expect(screen.getByTestId('club-names')).toHaveTextContent('Recovered');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
  });
});

describe('Player Web discovery invalidation ordering', () => {
  it('coalesces a thousand in-flight invalidations into one trailing read and waits for it', async () => {
    const initial = deferred<DiscoveryPayload>();
    const trailing = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockReturnValueOnce(initial.promise).mockReturnValueOnce(trailing.promise);
    const observer = renderPlayerData();
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledOnce());
    await waitFor(() => expect(dataHarness.onSnapshot).toHaveBeenCalledOnce());
    const notify = latestSnapshotListener();
    let refreshFinished = false;
    const concurrentRefreshes = Array.from({ length: 1_000 }, () => observer.data().refresh());
    expect(new Set(concurrentRefreshes).size).toBe(1);
    const refresh = Promise.all(concurrentRefreshes).then(() => { refreshFinished = true; });
    act(() => { for (let index = 0; index < 1_000; index += 1) notify(); });
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledOnce();

    await act(async () => { initial.resolve(clubDiscovery('Intermediate')); await initial.promise; });
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('club-names')).toHaveTextContent('Intermediate');
    expect(refreshFinished).toBe(false);
    await act(async () => { trailing.resolve(clubDiscovery('Fresh')); await refresh; });
    expect(screen.getByTestId('club-names')).toHaveTextContent('Fresh');
    expect(refreshFinished).toBe(true);
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it('never replaces an acknowledged membership result with an older discovery response', async () => {
    const stale = deferred<DiscoveryPayload>();
    const fresh = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockResolvedValueOnce(clubDiscovery('Initial'))
      .mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    dataHarness.submitMembership.mockResolvedValue({ ...clubAlpha, club: { ...clubAlpha.club, name: 'Approved' } });
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    let refresh: Promise<void> | undefined;
    act(() => { refresh = observer.data().refresh(); });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2));
    await act(async () => observer.data().requestMembership(clubAlpha, membershipOption()));
    expect(screen.getByTestId('club-names')).toHaveTextContent('Approved');

    await act(async () => { stale.resolve(clubDiscovery('Stale')); await stale.promise; });
    expect(screen.getByTestId('club-names')).toHaveTextContent('Approved');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(3);
    await act(async () => { fresh.resolve(clubDiscovery('Authoritative')); await refresh; });
    expect(screen.getByTestId('club-names')).toHaveTextContent('Authoritative');
  });

  it.each(['express', 'withdraw'] as const)('preserves an acknowledged %s interest until a later discovery', async (operation) => {
    const stale = deferred<DiscoveryPayload>();
    const fresh = deferred<DiscoveryPayload>();
    const initial = { ...clubDiscovery('Initial'), tournaments: [openTournament], interests: operation === 'withdraw' ? [interest] : [] };
    dataHarness.fetchDiscovery.mockResolvedValueOnce(initial).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    dataHarness.expressInterest.mockResolvedValue(interest);
    dataHarness.withdrawInterest.mockResolvedValue(undefined);
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    let refresh: Promise<void> | undefined;
    act(() => { refresh = observer.data().refresh(); });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2));
    await act(async () => {
      if (operation === 'express') await observer.data().expressInterest(openTournament);
      else await observer.data().withdrawInterest(openTournament);
    });
    const expectedInterests = operation === 'express' ? [interest] : [];
    expect(observer.data().interests).toEqual(expectedInterests);

    await act(async () => { stale.resolve(initial); await stale.promise; });
    expect(observer.data().interests).toEqual(expectedInterests);
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(3);
    await act(async () => { fresh.resolve({ ...initial, interests: expectedInterests }); await refresh; });
    expect(observer.data().interests).toEqual(expectedInterests);
  });

  it('renders intermediate reads while notifications keep arriving without overlapping requests', async () => {
    const reads = Array.from({ length: 4 }, () => deferred<DiscoveryPayload>());
    let currentRead = 0;
    let activeReads = 0;
    let maximumActiveReads = 0;
    dataHarness.fetchDiscovery.mockImplementation(() => {
      const read = reads[currentRead++];
      if (!read) throw new Error('Unexpected extra discovery read.');
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      return read.promise.finally(() => { activeReads -= 1; });
    });
    renderPlayerData();
    await waitFor(() => expect(dataHarness.onSnapshot).toHaveBeenCalledOnce());
    const notify = latestSnapshotListener();
    for (let index = 0; index < reads.length; index += 1) {
      await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(index + 1));
      if (index < reads.length - 1) act(() => { notify(); notify(); notify(); });
      const read = reads[index];
      if (!read) throw new Error('Synthetic discovery read is missing.');
      await act(async () => { read.resolve(clubDiscovery(`Revision ${index + 1}`)); await read.promise; });
      expect(screen.getByTestId('club-names')).toHaveTextContent(`Revision ${index + 1}`);
    }
    expect(maximumActiveReads).toBe(1);
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(4);
  });

  it('does not lose a notification between the final read and request cleanup', async () => {
    const read = deferred<DiscoveryPayload>();
    const trailing = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockResolvedValueOnce(clubDiscovery('Initial'))
      .mockReturnValueOnce(read.promise).mockReturnValueOnce(trailing.promise);
    const observer = renderPlayerData();
    await waitFor(() => expect(observer.data().status).toBe('ready'));
    const notify = latestSnapshotListener();
    let refresh: Promise<void> | undefined;
    act(() => { refresh = observer.data().refresh(); });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2));
    await act(async () => {
      read.resolve(clubDiscovery('Read completed'));
      queueMicrotask(() => queueMicrotask(notify));
      await refresh;
    });
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(3);
    await act(async () => { trailing.resolve(clubDiscovery('After handoff')); await trailing.promise; });
    await waitFor(() => expect(screen.getByTestId('club-names')).toHaveTextContent('After handoff'));
  });

  it('settles callers after a failed trailing read and releases the request owner for recovery', async () => {
    const initial = deferred<DiscoveryPayload>();
    const trailing = deferred<DiscoveryPayload>();
    dataHarness.fetchDiscovery.mockReturnValueOnce(initial.promise).mockReturnValueOnce(trailing.promise)
      .mockResolvedValueOnce(clubDiscovery('Recovered'));
    const observer = renderPlayerData();
    await waitFor(() => expect(dataHarness.onSnapshot).toHaveBeenCalledOnce());
    const notify = latestSnapshotListener();
    const refresh = observer.data().refresh();
    act(() => notify());
    await act(async () => { initial.resolve(clubDiscovery('Intermediate')); await initial.promise; });
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
    await act(async () => { trailing.reject(new Error('Synthetic trailing read failed')); await refresh; });
    expect(observer.data().status).toBe('error');
    expect(screen.getByTestId('club-names')).toHaveTextContent('Intermediate');
    await act(async () => observer.data().refresh());
    expect(observer.data().status).toBe('ready');
    expect(screen.getByTestId('club-names')).toHaveTextContent('Recovered');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(3);
  });

  it('aborts a queued refresh on unmount without starting its trailing read', async () => {
    const initial = deferred<DiscoveryPayload>();
    let requestSignal: AbortSignal | undefined;
    dataHarness.fetchDiscovery.mockImplementation((_user: User, signal: AbortSignal) => {
      requestSignal = signal;
      return initial.promise;
    });
    const observer = renderPlayerData();
    await waitFor(() => expect(dataHarness.onSnapshot).toHaveBeenCalledOnce());
    const notify = latestSnapshotListener();
    act(() => { notify(); notify(); });
    observer.view.unmount();
    expect(requestSignal?.aborted).toBe(true);
    await act(async () => { initial.resolve(clubDiscovery('Retired')); await initial.promise; });
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledOnce();
  });

  it('clears queued account A notifications when account B replaces the session', async () => {
    const accountA = deferred<DiscoveryPayload>();
    const accountB = deferred<DiscoveryPayload>();
    dataHarness.auth.user = makeUser('account-a');
    dataHarness.auth.player = makePlayer('account-a');
    dataHarness.fetchDiscovery.mockImplementation((user: User) => user.uid === 'account-a' ? accountA.promise : accountB.promise);
    const view = render(provider());
    await waitFor(() => expect(dataHarness.onSnapshot).toHaveBeenCalledOnce());
    const notifyA = latestSnapshotListener();
    act(() => { notifyA(); notifyA(); });
    await act(async () => {
      dataHarness.auth.user = makeUser('account-b');
      dataHarness.auth.player = makePlayer('account-b');
      view.rerender(provider());
    });
    await waitFor(() => expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2));
    await act(async () => {
      accountA.resolve(discoveryFor('account-a'));
      accountB.resolve(discoveryFor('account-b'));
      await Promise.all([accountA.promise, accountB.promise]);
    });
    expect(screen.getByTestId('club-ids')).toHaveTextContent('club-account-b');
    expect(dataHarness.fetchDiscovery).toHaveBeenCalledTimes(2);
  });
});
