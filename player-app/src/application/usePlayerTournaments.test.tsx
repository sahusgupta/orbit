/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tournamentScopeKey, type PlayerAccount, type PlayerTournament, type PlayerTournamentInterest } from '../domain/playerSync';

const tournamentHarness = vi.hoisted(() => ({
  express: vi.fn(),
  withdraw: vi.fn(),
  currentPlayer: { uid: 'player-1' },
  mutationCounter: 0
}));

vi.mock('../data/orbitSyncApi', () => ({
  expressTournamentInterest: tournamentHarness.express,
  getCurrentFirebasePlayer: () => tournamentHarness.currentPlayer,
  withdrawTournamentInterest: tournamentHarness.withdraw
}));

vi.mock('../security/secureIdentifier', () => ({
  createSecureUuid: () => `mutation-${++tournamentHarness.mutationCounter}`
}));

import { usePlayerTournaments } from './usePlayerTournaments';

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Player One',
  email: 'player@example.test',
  preferredGameIds: [],
  favoriteClubIds: [],
  searchRadiusMiles: 25
};

const tournament = (clubId: string): PlayerTournament => ({
  id: 'shared-event',
  clubId,
  name: `${clubId} Event`,
  startsAt: '2030-06-16T18:00:00.000Z',
  interestOpensAt: '2026-01-01T00:00:00.000Z',
  interestClosesAt: '2030-06-16T17:00:00.000Z',
  interestStatus: 'open',
  buyIn: 0,
  rebuysAllowed: false,
  addOnsAllowed: false,
  rules: [],
  withdrawalAllowed: true
});

const interest = (clubId: string, overrides: Partial<PlayerTournamentInterest> = {}): PlayerTournamentInterest => ({
  id: 'venue-local-interest',
  tournamentId: 'shared-event',
  clubId,
  playerId: player.id,
  status: 'interested',
  createdAt: '2026-09-05T12:00:00.000Z',
  updatedAt: '2026-09-05T12:00:00.000Z',
  ...overrides
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('club-scoped native tournament actions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestActions: ReturnType<typeof usePlayerTournaments>;
  let latestInterests: PlayerTournamentInterest[];

  function Harness({ initialInterests = [] }: { initialInterests?: PlayerTournamentInterest[] }) {
    const [interests, setInterests] = useState(initialInterests);
    const actions = usePlayerTournaments({
      firebaseIdentity: {
        uid: player.id,
        email: player.email,
        name: player.name,
        provider: 'email',
        verified: true
      },
      getClubMinimumAge: () => 21,
      player,
      requireVerifiedAge: () => true,
      setTournamentInterests: setInterests
    });
    latestActions = actions;
    latestInterests = interests;
    return <span>{actions.pendingTournamentKeys.join('|')}</span>;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    tournamentHarness.express.mockReset();
    tournamentHarness.withdraw.mockReset();
    tournamentHarness.mutationCounter = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('tracks colliding IDs independently and preserves the other venue cache entry', async () => {
    const first = tournament('club-a');
    const second = tournament('club-b');
    const firstRequest = deferred<PlayerTournamentInterest>();
    const secondRequest = deferred<PlayerTournamentInterest>();
    tournamentHarness.express.mockImplementation((selected: PlayerTournament) =>
      selected.clubId === first.clubId ? firstRequest.promise : secondRequest.promise);
    act(() => root.render(<Harness initialInterests={[interest(second.clubId)]} />));

    act(() => {
      void latestActions.expressInterest(first);
      void latestActions.expressInterest(second);
    });

    expect(tournamentHarness.express).toHaveBeenCalledTimes(2);
    expect(latestActions.pendingTournamentKeys).toEqual(expect.arrayContaining([
      tournamentScopeKey(first),
      tournamentScopeKey(second)
    ]));
    expect(tournamentHarness.express.mock.calls[0][2]).not.toBe(tournamentHarness.express.mock.calls[1][2]);

    await act(async () => firstRequest.resolve(interest(first.clubId)));
    expect(latestInterests.map((item) => item.clubId).sort()).toEqual(['club-a', 'club-b']);
    expect(latestActions.pendingTournamentKeys).toEqual([tournamentScopeKey(second)]);

    await act(async () => secondRequest.resolve(interest(second.clubId, { updatedAt: '2026-09-05T13:00:00.000Z' })));
    expect(latestInterests.map((item) => item.clubId).sort()).toEqual(['club-a', 'club-b']);
    expect(latestActions.pendingTournamentKeys).toEqual([]);
  });

  it('removes only the withdrawn venue cache entry when local IDs collide', async () => {
    const first = tournament('club-a');
    const second = tournament('club-b');
    tournamentHarness.withdraw.mockResolvedValue({ ok: true });
    act(() => root.render(<Harness initialInterests={[interest(first.clubId), interest(second.clubId)]} />));

    await act(async () => latestActions.withdrawInterest(first, interest(first.clubId)));

    expect(latestInterests).toEqual([interest(second.clubId)]);
  });

  it('does not reuse a failed venue mutation ID for another venue with the same tournament ID', async () => {
    const first = tournament('club-a');
    const second = tournament('club-b');
    tournamentHarness.express
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce(interest(second.clubId));
    act(() => root.render(<Harness />));

    await act(async () => latestActions.expressInterest(first));
    await act(async () => latestActions.expressInterest(second));

    expect(tournamentHarness.express).toHaveBeenCalledTimes(2);
    expect(tournamentHarness.express.mock.calls[0][2]).not.toBe(tournamentHarness.express.mock.calls[1][2]);
  });
});
