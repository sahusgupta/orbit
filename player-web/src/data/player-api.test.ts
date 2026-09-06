import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, discovery, formingGame, interest, openTournament, player, runningGame, scheduledGame } from '@/tests/fixtures';

const firebaseHarness = vi.hoisted(() => ({
  auth: { currentUser: null as User | null }
}));

vi.mock('./firebase-client', () => ({
  getFirebaseBrowserClient: vi.fn(async () => ({ auth: firebaseHarness.auth }))
}));

import {
  deleteWebPlayerAccount,
  fetchAuthenticatedDiscovery,
  expressTournamentInterest,
  submitMembershipApplication,
  submitSeatRequest,
  withdrawTournamentInterest
} from './player-api';

const user = {
  uid: 'player-1',
  getIdToken: vi.fn(async () => 'firebase-token')
} as unknown as User;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('authenticated Player Web transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '8dbd1b28-18b4-47f2-bb1e-a0947d5b88fd') });
    user.getIdToken = vi.fn(async () => 'firebase-token');
    firebaseHarness.auth.currentUser = user;
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads logged-in discovery with a Firebase bearer token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, ...discovery }));
    const result = await fetchAuthenticatedDiscovery(user);
    expect(result.clubs).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/discovery?limit=50'), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer firebase-token' }) }));
  });

  it('submits a pay-in-person membership request through the authoritative endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: clubAlpha.club.id, snapshot: clubAlpha }));
    const option = clubAlpha.club.membershipOptions?.[0];
    if (!option) throw new Error('Fixture membership option missing.');
    const snapshot = await submitMembershipApplication(user, player, clubAlpha, option);
    expect(snapshot.club.id).toBe('club-alpha');
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(request?.method).toBe('POST');
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'membership-request',
      paymentMethod: 'in-person',
      planId: 'day-pass',
      planName: 'Day Pass',
      membershipDurationDays: 1
    });
    expect(body).not.toHaveProperty('plan');
  });

  it('submits an arrival-aware waitlist request through existing semantics', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: clubAlpha.club.id, snapshot: clubAlpha }));
    await submitSeatRequest(user, player, clubAlpha, runningGame, { attendance: 'confirmed', expectedArrivalTime: '19:30' });
    const [, request] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.type).toBe('waitlist-request');
    expect(body.attendance).toBe('confirmed');
    expect(body.expectedArrivalTime).toBe('19:30');
    expect(body.tableId).toBe('table-1');
  });

  it('accepts a resumable account deletion and does not misreport it when auth changes after the response', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => {
      firebaseHarness.auth.currentUser = { uid: 'player-2' } as User;
      return jsonResponse({
        ok: true,
        status: 'pending',
        jobFinalization: 'scheduled',
        retainedCategories: ['legal transaction record', 42]
      }, 202);
    });

    await expect(deleteWebPlayerAccount(user)).resolves.toEqual({
      initiatingUid: 'player-1',
      status: 'pending',
      retainedCategories: ['legal transaction record']
    });
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/account'), expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ authorization: 'Bearer firebase-token' })
    }));
  });

  it('keeps the account active when deletion is not accepted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      ok: false,
      code: 'RECENT_LOGIN_REQUIRED',
      error: 'Sign in again before deleting this account.'
    }, 401));

    await expect(deleteWebPlayerAccount(user)).rejects.toThrow('Sign in again before deleting this account.');
  });

  it('does not send a request when the Firebase account changes while a token is loading', async () => {
    let resolveToken!: (token: string) => void;
    const token = new Promise<string>((resolve) => { resolveToken = resolve; });
    user.getIdToken = vi.fn(() => token);
    const request = submitSeatRequest(user, player, clubAlpha, runningGame, { attendance: 'arrived' });
    await vi.waitFor(() => expect(user.getIdToken).toHaveBeenCalled());

    firebaseHarness.auth.currentUser = { uid: 'player-2' } as User;
    resolveToken('stale-player-1-token');

    await expect(request).rejects.toThrow(/account changed/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('selects the first Running table when a non-Running table is published first', async () => {
    const mixedGame = {
      ...runningGame,
      openTables: [
        { ...formingGame.openTables[0], id: 'forming-first', gameId: runningGame.id },
        { ...runningGame.openTables[0], id: 'running-second' }
      ]
    };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: clubAlpha.club.id, snapshot: clubAlpha }));
    await submitSeatRequest(user, player, clubAlpha, mixedGame, { attendance: 'confirmed', expectedArrivalTime: '19:30' });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ attendance: 'confirmed', expectedArrivalTime: '19:30', tableId: 'running-second' });
  });

  it.each([
    ['forming', formingGame],
    ['paused', { ...runningGame, id: 'game-paused', openTables: runningGame.openTables.map((table) => ({ ...table, id: 'table-paused', status: 'Paused' as const })) }],
    ['no-table', scheduledGame]
  ])('forces a %s game to interest-only and omits table identity', async (_label, selectedGame) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: clubAlpha.club.id, snapshot: clubAlpha }));
    await submitSeatRequest(user, player, clubAlpha, selectedGame, {
      attendance: 'confirmed',
      expectedArrivalTime: '19:30',
      availabilityStartTime: '18:00',
      availabilityEndTime: '22:00'
    });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      attendance: 'interested',
      availabilityStartTime: '18:00',
      availabilityEndTime: '22:00'
    });
    expect(body).not.toHaveProperty('tableId');
    expect(body).not.toHaveProperty('expectedArrivalTime');
  });

  it('expresses nonbinding tournament interest and validates the authoritative response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, interest }));
    await expect(expressTournamentInterest(user, openTournament)).resolves.toEqual(interest);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/tournament-interests'), expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.mutationId).toBe('8dbd1b28-18b4-47f2-bb1e-a0947d5b88fd');
    expect(String(body.mutationId)).not.toMatch(/player-1|avery@example|event-open/i);
  });

  it('withdraws tournament interest only after an authoritative success response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await expect(withdrawTournamentInterest(user, openTournament)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/tournament-interests'), expect.objectContaining({ method: 'DELETE' }));
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body.mutationId).toBe('8dbd1b28-18b4-47f2-bb1e-a0947d5b88fd');
    expect(String(body.mutationId)).not.toMatch(/player-1|avery@example|event-open/i);
  });

  it('surfaces authoritative action failure and never fabricates success', async () => {
    await expect(Reflect.apply(submitMembershipApplication, undefined, [user, player, clubAlpha, undefined]))
      .rejects.toThrow('Select a venue-published membership option');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when a tournament-interest response is malformed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, interest: { id: 'partial' } }));
    await expect(expressTournamentInterest(user, openTournament)).rejects.toThrow('could not be saved');
  });
});
