/** @vitest-environment jsdom */
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerClubs } from './usePlayerClubs';
import type { PlayerClubSnapshot, PlayerMembership, PlayerWaitlistEntry, PlayerWaitlistRequest } from '../domain/playerSync';
import type { SyncResult } from '../data/playerDataContracts';
import { createDemoPlayerData } from '../demo/demoPlayerData';
import { applyWaitlistRequest } from '../data/playerRequests';

const remote = vi.hoisted(() => ({ uid: '', submit: vi.fn(), membership: vi.fn() }));
vi.mock('../data/orbitSyncApi', () => ({
  getCurrentFirebasePlayer: () => ({ uid: remote.uid }),
  submitWaitlistRequest: remote.submit, submitMembershipRequest: remote.membership
}));
vi.mock('../security/secureIdentifier', () => ({ createSecureUuid: () => '78d5925b-1dcd-4381-8eee-206a06090d54' }));

function deferredResult() {
  let settle: (result: SyncResult) => void = () => { throw new Error('Deferred result is not initialized.'); };
  const promise = new Promise<SyncResult>((resolve) => { settle = resolve; });
  return { promise, resolve: (result: SyncResult) => settle(result) };
}

describe('confirmed player waitlist integration', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let actions: ReturnType<typeof usePlayerClubs>;
  let renderedClubs: PlayerClubSnapshot[];
  let publishClubs: React.Dispatch<React.SetStateAction<PlayerClubSnapshot[]>>;
  let currentUid: string;
  const success = vi.fn();
  const verified = vi.fn(() => true);
  const membershipMessage = vi.fn();
  const selectClub = vi.fn();
  const screen = vi.fn();
  const syncStatus = vi.fn();
  const now = Date.parse('2026-10-12T12:00:00Z');
  const inventory = createDemoPlayerData(now);
  const club: PlayerClubSnapshot = { ...inventory.clubs[0], waitlists: [] };
  const game = club.games.find((candidate) => candidate.openTables.some((table) => table.status === 'Running'))!;
  function Harness() {
    const [clubs, setClubs] = useState([club]);
    renderedClubs = clubs;
    publishClubs = setClubs;
    actions = usePlayerClubs({ clubs, actionsReady: true, clockNow: now,
      player: { ...inventory.player, id: currentUid }, requireVerifiedAge: verified,
      platform: { os: 'ios', getCurrentAppState: () => 'active', openAppSettings: vi.fn(),
        openDirections: vi.fn(async () => ({ ok: true as const })), subscribeToAppState: () => () => undefined,
        confirmAccountDeletion: vi.fn(), confirmLocalProfileDeletion: vi.fn(),
        showLocalProfileDeletionResult: vi.fn(), showAccountDeletionResult: vi.fn() },
      setClubMembershipMessage: membershipMessage, setClubs, setScreen: screen, setSelectedClubId: selectClub, setSyncStatus: syncStatus,
      onSeatRequestSuccess: success });
    return null;
  }
  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    currentUid = inventory.player.id;
    remote.uid = currentUid;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const request = async () => {
    act(() => { actions.joinWaitlist(club, game); });
    expect(actions.seatRequestDraft?.game.id).toBe(game.id);
    expect(remote.submit).not.toHaveBeenCalled();
    await act(async () => { await actions.submitSeatRequest(); });
  };
  it('requires confirmation and reports conversion only after the backend accepts the explicit request', async () => {
    remote.submit.mockResolvedValue({ ok: true, snapshot: club });
    await request();
    expect(remote.submit).toHaveBeenCalledOnce();
    expect(remote.submit.mock.calls[0][0]).toMatchObject({ clubId: club.club.id, gameId: game.id, attendance: 'arrived' });
    expect(success).toHaveBeenCalledWith({ clubId: club.club.id, gameId: game.id, requestId: remote.submit.mock.calls[0][0].id });
    expect(actions.seatRequestDraft).toBeNull();
  });
  it('rolls back a rejected request and emits no successful conversion', async () => {
    remote.submit.mockResolvedValue({ ok: false, error: 'Room stopped accepting requests' });
    await request();
    expect(success).not.toHaveBeenCalled();
    expect(renderedClubs[0]).toEqual(club);
    expect(actions.seatRequestMessage).toContain('Seat request was not sent.');
  });
  it('does not turn a telemetry exception into a failed venue request', async () => {
    remote.submit.mockResolvedValue({ ok: true, snapshot: club });
    success.mockImplementationOnce(() => { throw new Error('Telemetry unavailable'); });
    await request();
    expect(actions.seatRequestDraft).toBeNull();
    expect(actions.seatRequestMessage).toBe('');
    expect(actions.clubActionPending).toBe(false);
  });
  it('retires a late response when the signed-in identity changes', async () => {
    let resolve: ((value: { ok: true; snapshot: PlayerClubSnapshot }) => void) | undefined;
    remote.submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    act(() => { actions.joinWaitlist(club, game); });
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.submitSeatRequest(); });
    currentUid = 'another-player';
    remote.uid = currentUid;
    await act(async () => { root.render(<Harness />); });
    await act(async () => { resolve?.({ ok: true, snapshot: club }); await submitted; });
    expect(success).not.toHaveBeenCalled();
    expect(actions.seatRequestDraft).toBeNull();
  });
  it('binds attribution to the confirmed draft and does not credit a later request after cancellation', async () => {
    const attribution = { uid: currentUid, saveMutationId: 'saved-match-mutation-00001', initiatedAt: now };
    remote.submit.mockResolvedValue({ ok: true, snapshot: club });
    act(() => { actions.joinWaitlist(club, game, attribution); });
    expect(actions.seatRequestDraft?.matchAttribution).toEqual(attribution);
    act(() => { actions.setSeatRequestDraft(null); });
    await request();
    expect(success.mock.calls[0][0]).not.toHaveProperty('matchAttribution');
    success.mockClear();
    act(() => { actions.joinWaitlist(club, game, attribution); });
    await act(async () => { await actions.submitSeatRequest(); });
    expect(success.mock.calls[0][0]).toMatchObject({ matchAttribution: attribution });
    expect(remote.submit.mock.calls[1][0]).not.toHaveProperty('matchAttribution');
    expect(remote.submit.mock.calls[1][0].player).not.toHaveProperty('matchAttribution');
  });

  const cancellableClub = (): PlayerClubSnapshot => {
    const own: PlayerWaitlistEntry = {
      id: 'published-own-request', clubId: club.club.id, gameId: game.id, playerId: inventory.player.id,
      playerName: inventory.player.name, status: 'Arrived', position: 1, requestedAt: new Date(now).toISOString(),
      tableId: game.openTables[0].id
    };
    const other: PlayerWaitlistEntry = { ...own, id: 'published-other-request', playerId: 'other-player', playerName: 'Other fixture player', position: 2 };
    return { ...club, games: club.games.map((candidate) => candidate.id === game.id ? { ...candidate, waitlistCount: 2 } : candidate), waitlists: [own, other] };
  };

  it.each(['join', 'cancel'] as const)('accepts the ordinary successful %s snapshot after its own pending projection', async (action) => {
    const published = action === 'cancel' ? cancellableClub() : club;
    act(() => publishClubs([published]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    if (action === 'join') act(() => actions.joinWaitlist(published, game));
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, game, published.waitlists[0]); });
    const sent: PlayerWaitlistRequest = remote.submit.mock.calls[0][0];
    const accepted = applyWaitlistRequest(published, sent);
    expect(actions.clubActionPending).toBe(true);
    expect(renderedClubs[0]).not.toBe(published);
    await act(async () => { result.resolve({ ok: true, accountKey: published.club.id, snapshot: accepted }); await submitted; });
    expect(renderedClubs).toEqual([accepted]);
    expect(renderedClubs[0]).toBe(accepted);
    expect(actions.clubActionPending).toBe(false);
    expect(actions.seatRequestDraft).toBeNull();
    expect(selectClub).toHaveBeenLastCalledWith(published.club.id);
    expect(syncStatus).toHaveBeenLastCalledWith(action === 'join'
      ? `Seat request synced with ${published.club.name}` : `Seat request cancelled with ${published.club.name}`);
    if (action === 'join') expect(success).toHaveBeenCalledExactlyOnceWith({ clubId: published.club.id, gameId: game.id, requestId: sent.id });
    else expect(success).not.toHaveBeenCalled();
  });

  const membershipOption = { id: 'published-option', name: 'Venue access', durationDays: 30, priceLabel: 'Free' };
  it.each(['Requested', 'Active'] as const)('accepts an ordinary %s membership response and preserves explicit seat continuation', async (status) => {
    const published: PlayerClubSnapshot = { ...club, memberships: [] };
    act(() => publishClubs([published]));
    act(() => actions.joinWaitlist(published, game));
    expect(actions.seatRequestDraft).toBeNull();
    expect(screen).toHaveBeenLastCalledWith('clubSignup');
    const result = deferredResult();
    remote.membership.mockReturnValue(result.promise);
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.submitMembershipApplication(published, membershipOption); });
    expect(remote.membership).toHaveBeenCalledOnce();
    expect(remote.submit).not.toHaveBeenCalled();
    expect(actions.clubActionPending).toBe(true);
    expect(renderedClubs[0]).toBe(published);
    const accepted: PlayerClubSnapshot = { ...published, memberships: club.memberships.map((membership) => ({ ...membership, status })) };
    await act(async () => { result.resolve({ ok: true, accountKey: published.club.id, snapshot: accepted }); await submitted; });
    expect(renderedClubs[0]).toBe(accepted);
    expect(actions.clubActionPending).toBe(false);
    expect(selectClub).toHaveBeenLastCalledWith(published.club.id);
    expect(syncStatus).toHaveBeenLastCalledWith(`Membership request synced with ${published.club.name}`);
    expect(actions.seatRequestDraft).toEqual(status === 'Active' ? expect.objectContaining({ club: accepted, game }) : null);
    if (status === 'Requested') expect(membershipMessage).toHaveBeenLastCalledWith(expect.stringContaining('Wait for the venue to activate'));
    expect(remote.submit).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  it('characterizes a confirmed pending join and ordinary rejection without projecting a conversion', async () => {
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    const attribution = { uid: currentUid, saveMutationId: 'pending-save-mutation-00001', initiatedAt: now };
    act(() => actions.joinWaitlist(club, game, attribution));
    expect(renderedClubs).toEqual([club]);
    expect(remote.submit).not.toHaveBeenCalled();
    expect(actions.seatRequestDraft?.matchAttribution).toEqual(attribution);
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.submitSeatRequest(); });
    expect(remote.submit).toHaveBeenCalledOnce();
    const sent: PlayerWaitlistRequest = remote.submit.mock.calls[0][0];
    expect(sent).toMatchObject({ action: 'join', clubId: club.club.id, gameId: game.id, tableId: game.openTables[0].id, attendance: 'arrived', player: { id: currentUid } });
    expect(sent).not.toHaveProperty('matchAttribution');
    expect(actions.clubActionPending).toBe(true);
    expect(actions.seatRequestMessage).toBe('');
    expect(renderedClubs[0].waitlists).toEqual([expect.objectContaining({ id: sent.id, playerId: currentUid, gameId: game.id, tableId: sent.tableId, status: 'Arrived', position: 1, requestedAt: sent.requestedAt })]);
    expect(renderedClubs[0].games.find((candidate) => candidate.id === game.id)?.waitlistCount).toBe(game.waitlistCount + 1);
    expect(renderedClubs[0].social?.waitlistCount).toBe((club.social?.waitlistCount ?? 0) + 1);
    expect(success).not.toHaveBeenCalled();
    await act(async () => { await actions.submitSeatRequest(); });
    expect(remote.submit).toHaveBeenCalledOnce();
    await act(async () => { result.resolve({ ok: false, error: 'Fixture request rejected' }); await submitted; });
    expect(renderedClubs).toEqual([club]);
    expect(actions.clubActionPending).toBe(false);
    expect(actions.seatRequestMessage).toBe('Seat request was not sent. Fixture request rejected');
    expect(actions.seatRequestDraft?.matchAttribution).toEqual(attribution);
    expect(success).not.toHaveBeenCalled();
  });

  it('characterizes pending cancellation of only the owned request and ordinary rejection rollback', async () => {
    const published = cancellableClub();
    act(() => publishClubs([published]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.cancelWaitlist(published, published.games[0], published.waitlists[0]); });
    expect(remote.submit).toHaveBeenCalledOnce();
    expect(remote.submit.mock.calls[0][0]).toMatchObject({ action: 'cancel', clubId: club.club.id, gameId: game.id, tableId: published.waitlists[0].tableId, player: { id: currentUid } });
    expect(actions.clubActionPending).toBe(true);
    expect(actions.gameRequestMessage).toBe('');
    expect(renderedClubs[0].waitlists).toEqual([{ ...published.waitlists[1], position: 1 }]);
    expect(renderedClubs[0].games.find((candidate) => candidate.id === game.id)?.waitlistCount).toBe(1);
    expect(renderedClubs[0].social?.waitlistCount).toBe((published.social?.waitlistCount ?? 0) - 1);
    expect(published.waitlists).toHaveLength(2);
    expect(success).not.toHaveBeenCalled();
    await act(async () => { result.resolve({ ok: false, error: 'Fixture cancellation rejected' }); await submitted; });
    expect(renderedClubs).toEqual([published]);
    expect(actions.clubActionPending).toBe(false);
    expect(actions.gameRequestMessage).toBe('Cancellation was not sent. Fixture cancellation rejected');
    expect(success).not.toHaveBeenCalled();
  });

  it.each(['join', 'cancel'] as const)('retires a late rejected %s after an account switch without replacing the new owner snapshot', async (action) => {
    const published = action === 'cancel' ? cancellableClub() : club;
    act(() => publishClubs([published]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    let submitted: Promise<void> = Promise.resolve();
    if (action === 'join') act(() => actions.joinWaitlist(published, published.games[0]));
    await act(async () => { submitted = action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, published.games[0], published.waitlists[0]); });
    expect(actions.clubActionPending).toBe(true);
    expect(remote.submit).toHaveBeenCalledOnce();
    currentUid = 'new-owner'; remote.uid = currentUid;
    const newOwnerSnapshot: PlayerClubSnapshot = { ...club, memberships: club.memberships.map((membership) => ({ ...membership, playerId: currentUid })), generatedAt: new Date(now + 60_000).toISOString() };
    await act(async () => { publishClubs([newOwnerSnapshot]); root.render(<Harness />); });
    expect(actions.clubActionPending).toBe(false);
    expect(actions.seatRequestDraft).toBeNull();
    await act(async () => { result.resolve({ ok: false, error: 'Old owner failure' }); await submitted; });
    expect(renderedClubs).toEqual([newOwnerSnapshot]);
    expect(actions.seatRequestMessage).toBe('');
    expect(actions.gameRequestMessage).toBe('');
    expect(success).not.toHaveBeenCalled();
  });

  const endedPublishedClub = (snapshot: PlayerClubSnapshot): PlayerClubSnapshot => ({
    ...snapshot,
    games: snapshot.games.map((candidate) => candidate.id === game.id
      ? { ...candidate, openTables: [], availableSeats: 0, formingCount: 0, waitlistCount: 7, updatedAt: new Date(now + 60_000).toISOString() }
      : candidate),
    memberships: snapshot.memberships.map((membership): PlayerMembership => ({ ...membership, status: 'Expired', expiresAt: new Date(now - 1).toISOString() })),
    notifications: [{ id: 'new-published-notification', clubId: snapshot.club.id, gameId: game.id, title: 'Earlier fixture availability',
      body: 'Published fixture notice retained after the table ended.', reason: 'seat-opened', createdAt: new Date(now - 60_000).toISOString() }],
    ...(snapshot.social ? { social: { ...snapshot.social, waitlistCount: snapshot.social.waitlistCount + 7 - game.waitlistCount } } : {}),
    generatedAt: new Date(now + 60_000).toISOString(), syncProtocolVersion: 2, syncRevision: 'fixture-live-revision-2'
  });

  it.each((['join', 'cancel', 'membership'] as const).flatMap((action) =>
    (['updated', 'removed'] as const).map((publication) => ({ action, publication }))))(
    'retains an intervening $publication publication after a delayed successful $action under Strict Mode',
    async ({ action, publication }) => {
      await act(async () => { root.render(<React.StrictMode><Harness /></React.StrictMode>); });
      const published: PlayerClubSnapshot = action === 'membership' ? { ...club, memberships: [] }
        : action === 'cancel' ? cancellableClub() : club;
      const unrelated: PlayerClubSnapshot = { ...club, club: { ...club.club, id: 'unrelated-venue', name: 'Unaffected venue' }, memberships: [], waitlists: [] };
      act(() => publishClubs([published, unrelated]));
      const result = deferredResult();
      if (action === 'membership') remote.membership.mockReturnValue(result.promise);
      else remote.submit.mockReturnValue(result.promise);
      if (action !== 'cancel') act(() => actions.joinWaitlist(published, game));
      let submitted: Promise<void> = Promise.resolve();
      await act(async () => {
        submitted = action === 'membership' ? actions.submitMembershipApplication(published, membershipOption)
          : action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, game, published.waitlists[0]);
      });
      const sent: PlayerWaitlistRequest | undefined = remote.submit.mock.calls[0]?.[0];
      const accepted: PlayerClubSnapshot = action === 'membership' ? { ...published, memberships: club.memberships }
        : sent ? applyWaitlistRequest(published, sent) : published;
      const newest = endedPublishedClub(accepted);
      const live = publication === 'updated' ? [newest, unrelated] : [unrelated];
      act(() => publishClubs(live));
      const selectionCalls = selectClub.mock.calls.length;
      await act(async () => { result.resolve({ ok: true, accountKey: published.club.id, snapshot: accepted }); await submitted; });
      expect(renderedClubs).toEqual(live);
      expect(renderedClubs.at(-1)).toBe(unrelated);
      if (publication === 'updated') expect(renderedClubs[0]).toBe(newest);
      else expect(selectClub).toHaveBeenCalledTimes(selectionCalls);
      expect(actions.clubActionPending).toBe(false);
      expect(actions.seatRequestDraft).toBeNull();
      expect(actions.seatRequestMessage).toBe('');
      expect(actions.gameRequestMessage).toBe('');
      expect(syncStatus).toHaveBeenLastCalledWith(action === 'membership' ? `Membership request synced with ${published.club.name}`
        : action === 'join' ? `Seat request synced with ${published.club.name}` : `Seat request cancelled with ${published.club.name}`);
      if (action === 'join' && sent) expect(success).toHaveBeenCalledExactlyOnceWith({ clubId: published.club.id, gameId: game.id, requestId: sent.id });
      else expect(success).not.toHaveBeenCalled();
      if (action === 'membership') expect(remote.submit).not.toHaveBeenCalled();
    }
  );

  it('resumes accepted membership using the current published game rather than the response or original draft game', async () => {
    const published: PlayerClubSnapshot = { ...club, memberships: [] };
    act(() => publishClubs([published]));
    act(() => actions.joinWaitlist(published, game));
    const result = deferredResult();
    remote.membership.mockReturnValue(result.promise);
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.submitMembershipApplication(published, membershipOption); });
    const accepted: PlayerClubSnapshot = { ...published, memberships: club.memberships };
    const currentGame = { ...game, name: 'Updated published game', openTables: game.openTables.map((table) => ({ ...table, id: 'current-published-table' })) };
    const newest = { ...accepted, games: accepted.games.map((candidate) => candidate.id === game.id ? currentGame : candidate),
      generatedAt: new Date(now + 60_000).toISOString(), syncRevision: 'new-current-membership-publication' };
    act(() => publishClubs([newest]));
    await act(async () => { result.resolve({ ok: true, accountKey: published.club.id, snapshot: accepted }); await submitted; });
    expect(renderedClubs[0]).toBe(newest);
    expect(actions.seatRequestDraft?.club).toBe(newest);
    expect(actions.seatRequestDraft?.game).toBe(currentGame);
    expect(actions.clubActionPending).toBe(false);
    expect(remote.submit).not.toHaveBeenCalled();
  });

  it.each(['join', 'cancel'] as const)('preserves a newer ended-game and revoked-membership publication after a pending %s rejects', async (action) => {
    const published = action === 'cancel' ? cancellableClub() : club;
    const unrelated: PlayerClubSnapshot = { ...club, club: { ...club.club, id: 'unrelated-venue', name: 'Unaffected fixture venue' }, memberships: [], waitlists: [] };
    act(() => publishClubs([published, unrelated]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    if (action === 'join') act(() => actions.joinWaitlist(published, published.games[0]));
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, published.games[0], published.waitlists[0]); });
    expect(actions.clubActionPending).toBe(true);
    const newest = endedPublishedClub(published);
    act(() => publishClubs([newest, unrelated]));
    expect(renderedClubs).toEqual([newest, unrelated]);
    await act(async () => { result.resolve({ ok: false, error: 'Published state no longer permits this action' }); await submitted; });
    expect(renderedClubs).toEqual([newest, unrelated]);
    expect(renderedClubs[0]).toBe(newest);
    expect(renderedClubs[1]).toBe(unrelated);
    expect(renderedClubs[0].games.find((candidate) => candidate.id === game.id)?.openTables).toEqual([]);
    expect(renderedClubs[0].memberships.every((membership) => membership.status === 'Expired')).toBe(true);
    expect(actions.clubActionPending).toBe(false);
    expect(action === 'join' ? actions.seatRequestMessage : actions.gameRequestMessage).toContain('Published state no longer permits this action');
    expect(success).not.toHaveBeenCalled();
  });

  it('rolls back a rejected join to the latest publication present before confirmation rather than the old draft snapshot', async () => {
    act(() => actions.joinWaitlist(club, game));
    const newest = endedPublishedClub(club);
    act(() => publishClubs([newest]));
    expect(remote.submit).not.toHaveBeenCalled();
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = actions.submitSeatRequest(); });
    expect(remote.submit).toHaveBeenCalledOnce();
    expect(renderedClubs[0].memberships).toEqual(newest.memberships);
    expect(renderedClubs[0].games.find((candidate) => candidate.id === game.id)).toMatchObject({ openTables: [], availableSeats: 0, waitlistCount: 8 });
    expect(renderedClubs[0].waitlists).toHaveLength(1);
    await act(async () => { result.resolve({ ok: false, error: 'Table ended before confirmation' }); await submitted; });
    expect(renderedClubs).toEqual([newest]);
    expect(renderedClubs[0]).toBe(newest);
    expect(actions.seatRequestMessage).toBe('Seat request was not sent. Table ended before confirmation');
    expect(actions.clubActionPending).toBe(false);
    expect(success).not.toHaveBeenCalled();
  });

  it.each(['join', 'cancel'] as const)('does not resurrect a venue removed while a %s is pending and then rejected', async (action) => {
    const published = action === 'cancel' ? cancellableClub() : club;
    act(() => publishClubs([published]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    if (action === 'join') act(() => actions.joinWaitlist(published, published.games[0]));
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, published.games[0], published.waitlists[0]); });
    expect(actions.clubActionPending).toBe(true);
    act(() => publishClubs([]));
    expect(renderedClubs).toEqual([]);
    await act(async () => { result.resolve({ ok: false, error: 'Venue is no longer published' }); await submitted; });
    expect(renderedClubs).toEqual([]);
    expect(actions.clubActionPending).toBe(false);
    expect(success).not.toHaveBeenCalled();
  });

  it.each(['join', 'cancel'] as const)('preserves ordinary pending %s optimism and rejection rollback under Strict Mode updater replay', async (action) => {
    await act(async () => { root.render(<React.StrictMode><Harness /></React.StrictMode>); });
    const published = action === 'cancel' ? cancellableClub() : club;
    act(() => publishClubs([published]));
    const result = deferredResult();
    remote.submit.mockReturnValue(result.promise);
    if (action === 'join') act(() => actions.joinWaitlist(published, published.games[0]));
    let submitted: Promise<void> = Promise.resolve();
    await act(async () => { submitted = action === 'join' ? actions.submitSeatRequest() : actions.cancelWaitlist(published, published.games[0], published.waitlists[0]); });
    expect(remote.submit).toHaveBeenCalledOnce();
    expect(actions.clubActionPending).toBe(true);
    expect(renderedClubs[0].waitlists).toHaveLength(1);
    expect(renderedClubs[0].waitlists[0]).toMatchObject(action === 'join'
      ? { gameId: game.id, playerId: currentUid, status: 'Arrived' }
      : { id: published.waitlists[1].id, playerId: 'other-player', position: 1 });
    expect(renderedClubs[0].games.find((candidate) => candidate.id === game.id)?.waitlistCount).toBe(action === 'join' ? game.waitlistCount + 1 : 1);
    await act(async () => { result.resolve({ ok: false, error: 'Ordinary rejection under Strict Mode' }); await submitted; });
    expect(renderedClubs).toEqual([published]);
    expect(actions.clubActionPending).toBe(false);
    expect(success).not.toHaveBeenCalled();
  });
});
