import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clubAlpha, discovery, openTournament, player, registration, runningGame } from '@/tests/fixtures';
import {
  fetchAuthenticatedDiscovery,
  registerTournament,
  submitMembershipApplication,
  submitSeatRequest,
  unregisterTournament
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
    user.getIdToken = vi.fn(async () => 'firebase-token');
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
    const snapshot = await submitMembershipApplication(user, player, clubAlpha, clubAlpha.club.membershipOptions?.[0]);
    expect(snapshot.club.id).toBe('club-alpha');
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(request?.method).toBe('POST');
    expect(String(request?.body)).toContain('membership-request');
    expect(String(request?.body)).toContain('in-person');
  });

  it('submits an arrival-aware waitlist request through existing semantics', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, accountKey: clubAlpha.club.id, snapshot: clubAlpha }));
    await submitSeatRequest(user, player, clubAlpha, runningGame, { attendance: 'confirmed', expectedArrivalTime: '19:30' });
    const [, request] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body.type).toBe('waitlist-request');
    expect(body.attendance).toBe('confirmed');
    expect(body.expectedArrivalTime).toBe('19:30');
  });

  it('registers for a tournament and validates the authoritative response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, registration }));
    await expect(registerTournament(user, openTournament)).resolves.toEqual(registration);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/tournament-registrations'), expect.objectContaining({ method: 'POST' }));
  });

  it('unregisters from a tournament only after an authoritative success response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, registrationId: registration.id }));
    await expect(unregisterTournament(user, openTournament)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/player/tournament-registrations'), expect.objectContaining({ method: 'DELETE' }));
  });

  it('surfaces authoritative action failure and never fabricates success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: false, error: 'Membership requires verified age.' }, 403));
    await expect(submitMembershipApplication(user, player, clubAlpha)).rejects.toThrow('Membership requires verified age.');
  });

  it('fails closed when a tournament registration response is malformed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true, registration: { id: 'partial' } }));
    await expect(registerTournament(user, openTournament)).rejects.toThrow('invalid response');
  });
});
