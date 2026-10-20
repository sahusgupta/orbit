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
  register: vi.fn(),
  currentPlayer: { uid: 'player-1' },
  mutationCounter: 0
}));

vi.mock('../data/orbitSyncApi', () => ({
  expressTournamentInterest: tournamentHarness.express,
  getCurrentFirebasePlayer: () => tournamentHarness.currentPlayer,
  withdrawTournamentInterest: tournamentHarness.withdraw,
  registerForTournament: tournamentHarness.register
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

  function Harness({ initialInterests = [], uid = player.id, tournaments }: { initialInterests?: PlayerTournamentInterest[]; uid?: string; tournaments?: PlayerTournament[] }) {
    const [interests, setInterests] = useState(initialInterests);
    const actions = usePlayerTournaments({
      firebaseIdentity: {
        uid,
        email: player.email,
        name: player.name,
        provider: 'email',
        verified: true
      },
      getClubMinimumAge: () => 21,
      player,
      requireVerifiedAge: () => true,
      setTournamentInterests: setInterests,
      tournaments
    });
    latestActions = actions;
    latestInterests = interests;
    return <span>{actions.pendingTournamentKeys.join('|')}</span>;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    tournamentHarness.express.mockReset();
    tournamentHarness.withdraw.mockReset();
    tournamentHarness.register.mockReset();
    tournamentHarness.mutationCounter = 0;
    tournamentHarness.currentPlayer.uid = player.id;
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

  it('confirms registration only from an authoritative result and keeps retries idempotent', async () => {
    const event = { ...tournament('club-a'), registrationAvailable: true };
    const registration = { id: 'registration-a', clubId: event.clubId, tournamentId: event.id, playerId: player.id, status: 'registered' as const, registeredAt: '2026-10-20T12:00:00Z' };
    tournamentHarness.register.mockRejectedValueOnce(new Error('Temporary connection failure')).mockResolvedValueOnce(registration);
    act(() => root.render(<Harness />));
    await act(async () => latestActions.registerTournament(event));
    expect(latestActions.tournamentRegistrations).toEqual({});
    expect(latestActions.tournamentMessage).toContain('Temporary connection failure');
    await act(async () => latestActions.registerTournament(event));
    expect(tournamentHarness.register.mock.calls[0][2]).toBe(tournamentHarness.register.mock.calls[1][2]);
    expect(latestActions.tournamentRegistrations[tournamentScopeKey(event)]).toEqual(registration);
    expect(latestActions.tournamentMessage).toContain('No payment was collected');
    expect(latestInterests).toEqual([]);
  });

  it('suppresses duplicate registration taps while a venue request is pending', async () => {
    const pending = deferred<{ id: string; clubId: string; tournamentId: string; playerId: string; status: 'registered'; registeredAt: string }>();
    const event = { ...tournament('club-a'), registrationAvailable: true };
    tournamentHarness.register.mockReturnValue(pending.promise);
    act(() => root.render(<Harness />));
    act(() => { void latestActions.registerTournament(event); void latestActions.registerTournament(event); });
    expect(tournamentHarness.register).toHaveBeenCalledOnce();
    expect(latestActions.pendingTournamentKeys).toEqual([tournamentScopeKey(event)]);
    await act(async () => pending.resolve({ id: 'registration-a', clubId: event.clubId, tournamentId: event.id, playerId: player.id, status: 'registered', registeredAt: '2026-10-20T12:00:00Z' }));
    expect(latestActions.pendingTournamentKeys).toEqual([]);
  });

  it('lets a new authoritative catalog remove the local registration acknowledgement', async () => {
    const event = { ...tournament('club-a'), registrationAvailable: true };
    const catalog = [event];
    tournamentHarness.register.mockResolvedValue({ id: 'registration-a', clubId: event.clubId, tournamentId: event.id, playerId: player.id, status: 'registered', registeredAt: '2026-10-20T12:00:00Z' });
    act(() => root.render(<Harness tournaments={catalog} />));
    await act(async () => latestActions.registerTournament(event));
    expect(latestActions.tournamentRegistrations[tournamentScopeKey(event)]).toBeDefined();
    act(() => root.render(<Harness tournaments={[{ ...event }]} />));
    expect(latestActions.tournamentRegistrations).toEqual({});
  });

  it('ignores an old registration completion after the account changes away and back', async () => {
    const event = { ...tournament('club-a'), registrationAvailable: true };
    const pending = deferred<{ id: string; clubId: string; tournamentId: string; playerId: string; status: 'registered'; registeredAt: string }>();
    tournamentHarness.register.mockReturnValue(pending.promise);
    act(() => root.render(<Harness />));
    act(() => { void latestActions.registerTournament(event); });
    tournamentHarness.currentPlayer.uid = 'other-player';
    act(() => root.render(<Harness uid="other-player" />));
    tournamentHarness.currentPlayer.uid = player.id;
    act(() => root.render(<Harness />));
    await act(async () => pending.resolve({ id: 'stale-registration', clubId: event.clubId, tournamentId: event.id, playerId: player.id, status: 'registered', registeredAt: '2026-10-20T12:00:00Z' }));
    expect(latestActions.tournamentRegistrations).toEqual({});
    expect(latestActions.tournamentMessage).toBe('');
  });
});
