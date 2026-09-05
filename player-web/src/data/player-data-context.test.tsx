import type { User } from 'firebase/auth';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, player, runningGame } from '@/tests/fixtures';
import type { DiscoveryPayload, PlayerAccount } from '@/src/domain/types';

const dataHarness = vi.hoisted(() => ({
  auth: { user: null as User | null, player: null as PlayerAccount | null },
  fetchDiscovery: vi.fn(),
  submitMembership: vi.fn(),
  submitSeat: vi.fn(),
  expressInterest: vi.fn(),
  withdrawInterest: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn())
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
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
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
      <button type="button" onClick={() => void data.refresh()}>Refresh</button>
    </div>
  );
}

function provider(onData?: (data: ReturnType<typeof usePlayerData>) => void) {
  return <PlayerDataProvider><PlayerDataProbe onData={onData} /></PlayerDataProvider>;
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
});
