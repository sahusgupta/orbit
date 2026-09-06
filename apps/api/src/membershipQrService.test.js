import { describe, expect, it, vi } from 'vitest';
import service from './membershipQrService.js';
import playerStatePreconditions from './playerStatePrecondition.js';

const { PlayerStatePreconditionError } = playerStatePreconditions;

const {
  applyMembershipQrIssue,
  applyMembershipQrRedemption,
  createMembershipQrHandlers,
  createMembershipQrSecurity,
  findLinkedPlayerProfile,
  getMembershipQrIdentityEligibility,
  parseIssueRequest,
  requireMembershipQrRedeemer
} = service;

const secret = 'test-only-membership-qr-secret-that-is-at-least-32-characters';
const nowMs = Date.parse('2026-09-04T18:00:00.000Z');
const inspectPilotLicenses = vi.fn(async () => [{
  managed: true,
  active: true,
  license: { accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
}]);

function state(overrides = {}) {
  return {
    games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
    sessions: [],
    playerSessions: [],
    profiles: [{
      id: 'legacy-profile-one',
      orbitPlayerId: 'firebase-player-one',
      name: 'Same Name',
      preferredGameIds: ['holdem'],
      membershipStatus: 'Active',
      membershipExpiresAt: '2026-10-01T00:00:00.000Z'
    }, {
      id: 'other-profile',
      orbitPlayerId: 'other-player',
      name: 'Same Name',
      preferredGameIds: ['holdem'],
      membershipStatus: 'Active',
      membershipExpiresAt: '2026-10-01T00:00:00.000Z'
    }],
    interests: [],
    playerLedger: [],
    tournaments: [],
    settings: {
      clubAccount: { minimumPlayerAge: 21 },
      pilotAccess: {
        authorized: true,
        licenseId: 'club-one',
        authorizationCode: 'license-club-one',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    },
    ...overrides
  };
}

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function issuedFixture() {
  const security = createMembershipQrSecurity({ secret });
  const token = security.tokenFor({ clubId: 'club-one', playerId: 'firebase-player-one', mutationId: 'opaque-issue-one' });
  const tokenId = security.tokenId(token);
  const issued = applyMembershipQrIssue(state(), {
    clubId: 'club-one', playerId: 'firebase-player-one', tokenId
  }, { nowMs, ttlMs: 120_000 });
  return { security, token, tokenId, issued };
}

function verifiedIdentity(ageLevel = 21) {
  return { status: 'verified', ageVerified: true, ageLevel };
}

function redemptionOptions(atMs, ageLevel = 21) {
  return { nowMs: atMs, identityRecord: verifiedIdentity(ageLevel) };
}

describe('server-authoritative membership QR', () => {
  it('creates a deterministic opaque token without embedding player or venue identity', () => {
    const security = createMembershipQrSecurity({ secret });
    const input = { clubId: 'private-club', playerId: 'private-player@example.com', mutationId: 'opaque-request-one' };
    const first = security.tokenFor(input);
    expect(first).toBe(security.tokenFor(input));
    expect(first).toMatch(/^omq1_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain('private-club');
    expect(first).not.toContain('private-player');
    expect(security.isToken(`${first}x`)).toBe(false);
    expect(JSON.stringify({ id: security.tokenId(first) })).not.toContain(first);
    expect(() => createMembershipQrSecurity({ secret: 'short' })).toThrow('not configured');
  });

  it('requires exact request fields so callers cannot select another player', () => {
    expect(parseIssueRequest({ clubId: 'club-one', mutationId: 'opaque-request-one' })).toMatchObject({ ok: true });
    expect(parseIssueRequest({ clubId: 'club-one', mutationId: 'private-player@example.test' }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(parseIssueRequest({ clubId: 'club-one', mutationId: 'opaque-request-one', playerId: 'other' }))
      .toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });

  it('links only by immutable id or orbitPlayerId even when names collide', () => {
    expect(findLinkedPlayerProfile(state(), 'firebase-player-one')).toMatchObject({
      ok: true, profile: { id: 'legacy-profile-one' }
    });
    expect(findLinkedPlayerProfile(state(), 'Same Name')).toMatchObject({ ok: false, code: 'PLAYER_NOT_FOUND' });
  });

  it('fails issuance and redemption closed when exact-id and orbit links conflict', () => {
    const collision = state({
      profiles: [
        {
          id: 'firebase-player-one',
          name: 'Exact ID profile',
          preferredGameIds: ['holdem'],
          membershipStatus: 'Active',
          membershipExpiresAt: '2026-10-01T00:00:00.000Z'
        },
        ...state().profiles
      ]
    });
    expect(findLinkedPlayerProfile(collision, 'firebase-player-one'))
      .toMatchObject({ ok: false, code: 'PLAYER_LINK_AMBIGUOUS' });
    expect(applyMembershipQrIssue(collision, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: 'ambiguous-token'
    }, { nowMs, ttlMs: 120_000 })).toMatchObject({ ok: false, code: 'PLAYER_LINK_AMBIGUOUS' });

    const redeemableCollision = {
      ...collision,
      membershipQrTokens: [{
        id: 'ambiguous-token',
        purpose: 'membership-check-in',
        clubId: 'club-one',
        playerId: 'firebase-player-one',
        profileId: 'firebase-player-one',
        status: 'issued',
        issuedAt: '2026-09-04T18:00:00.000Z',
        expiresAt: '2026-09-04T18:02:00.000Z'
      }]
    };
    expect(applyMembershipQrRedemption(redeemableCollision, {
      clubId: 'club-one', tokenId: 'ambiguous-token', redemptionRef: 'ambiguous-redeem'
    }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'PLAYER_LINK_AMBIGUOUS' });
    expect(redeemableCollision.membershipQrTokens[0].status).toBe('issued');
    expect(redeemableCollision.interests).toEqual([]);
    expect(redeemableCollision.playerLedger).toEqual([]);
  });

  it('issues one short-lived token and supersedes an earlier unconsumed token', () => {
    const first = applyMembershipQrIssue(state(), {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: 'token-one'
    }, { nowMs, ttlMs: 120_000 });
    expect(first).toMatchObject({
      ok: true,
      changed: true,
      tokenRecord: {
        id: 'token-one', profileId: 'legacy-profile-one', status: 'issued',
        issuedAt: '2026-09-04T18:00:00.000Z', expiresAt: '2026-09-04T18:02:00.000Z'
      }
    });
    const replay = applyMembershipQrIssue(first.state, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: 'token-one'
    }, { nowMs, ttlMs: 120_000 });
    expect(replay).toMatchObject({ ok: true, changed: false });
    const refreshed = applyMembershipQrIssue(first.state, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: 'token-two'
    }, { nowMs: nowMs + 1_000, ttlMs: 120_000 });
    expect(refreshed.state.membershipQrTokens).toEqual([
      expect.objectContaining({ id: 'token-one', status: 'superseded' }),
      expect.objectContaining({ id: 'token-two', status: 'issued' })
    ]);
  });

  it('atomically consumes the token and creates only the linked player arrival', () => {
    const { issued, tokenId } = issuedFixture();
    const result = applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 30_000));
    expect(result).toMatchObject({ ok: true, changed: true, status: 'checked-in', playerName: 'Same Name' });
    expect(result.state.membershipQrTokens[0]).toMatchObject({
      id: tokenId, status: 'used', redemptionRef: 'redeem-one', resultStatus: 'checked-in'
    });
    expect(result.state.interests).toEqual([expect.objectContaining({
      profileId: 'legacy-profile-one', gameId: 'holdem', status: 'Arrived'
    })]);
    expect(result.state.playerLedger).toEqual([expect.objectContaining({
      type: 'Check-In', profileId: 'legacy-profile-one', gameId: 'holdem'
    })]);
    expect(JSON.stringify(result.state)).not.toContain('omq1_');

    const exactReplay = applyMembershipQrRedemption(result.state, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 60_000));
    expect(exactReplay).toMatchObject({ ok: true, changed: false, status: 'checked-in' });
    const otherScan = applyMembershipQrRedemption(result.state, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-two'
    }, redemptionOptions(nowMs + 60_000));
    expect(otherScan).toMatchObject({ ok: false, code: 'MEMBERSHIP_QR_ALREADY_USED' });
  });

  it('fails closed for expiry, venue mismatch, inactive membership, and tampering', () => {
    const { security, token, tokenId, issued } = issuedFixture();
    expect(applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 120_000))).toMatchObject({ ok: false, code: 'MEMBERSHIP_QR_EXPIRED' });
    expect(applyMembershipQrRedemption(issued.state, {
      clubId: 'club-two', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'WRONG_VENUE' });
    const inactive = {
      ...issued.state,
      profiles: issued.state.profiles.map((profile) => profile.id === 'legacy-profile-one'
        ? { ...profile, membershipStatus: 'Expired' }
        : profile)
    };
    expect(applyMembershipQrRedemption(inactive, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' });
    expect(security.tokenId(`${token.slice(0, -1)}x`)).not.toBe(tokenId);
    expect(applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId: security.tokenId(`${token.slice(0, -1)}x`), redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'INVALID_MEMBERSHIP_QR' });

    for (const membershipStatus of [undefined, 'Approved', 'Unexpected']) {
      const unknownStatus = {
        ...issued.state,
        profiles: issued.state.profiles.map((profile) => profile.id === 'legacy-profile-one'
          ? { ...profile, membershipStatus }
          : profile)
      };
      expect(applyMembershipQrRedemption(unknownStatus, {
        clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
      }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' });
    }
    const invalidExpiry = {
      ...issued.state,
      membershipQrTokens: issued.state.membershipQrTokens.map((record) => ({ ...record, expiresAt: 'not-a-date' }))
    };
    expect(applyMembershipQrRedemption(invalidExpiry, {
      clubId: 'club-one', tokenId, redemptionRef: 'redeem-one'
    }, redemptionOptions(nowMs + 1_000))).toMatchObject({ ok: false, code: 'MEMBERSHIP_QR_EXPIRED' });
  });

  it('requires a current identity that satisfies the venue minimum age before consuming a token', () => {
    const { issued, tokenId } = issuedFixture();
    for (const identityRecord of [undefined, {}, { status: 'redacted', ageVerified: false, ageLevel: 21 }]) {
      const result = applyMembershipQrRedemption(issued.state, {
        clubId: 'club-one', tokenId, redemptionRef: 'identity-required'
      }, { nowMs: nowMs + 1_000, identityRecord });
      expect(result).toMatchObject({ ok: false, code: 'AGE_VERIFICATION_REQUIRED', minimumAge: 21 });
      expect(issued.state.membershipQrTokens[0].status).toBe('issued');
    }

    expect(getMembershipQrIdentityEligibility(issued.state, verifiedIdentity(18), nowMs))
      .toEqual({ ok: false, ageLevel: 18, minimumAge: 21 });
    expect(applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId, redemptionRef: 'underage-for-venue'
    }, redemptionOptions(nowMs + 1_000, 18))).toMatchObject({
      ok: false,
      code: 'AGE_VERIFICATION_REQUIRED',
      minimumAge: 21
    });
  });

  it.each([
    { minimumAge: 18, identityAge: 18 },
    { minimumAge: 21, identityAge: 21 }
  ])('accepts a current $identityAge+ identity at a $minimumAge+ venue', ({ minimumAge, identityAge }) => {
    const source = state({
      settings: {
        ...state().settings,
        clubAccount: { minimumPlayerAge: minimumAge }
      }
    });
    const issued = applyMembershipQrIssue(source, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: `token-age-${identityAge}`
    }, { nowMs, ttlMs: 120_000 });
    const result = applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId: `token-age-${identityAge}`, redemptionRef: `redeem-age-${identityAge}`
    }, redemptionOptions(nowMs + 1_000, identityAge));
    expect(result).toMatchObject({ ok: true, changed: true, status: 'checked-in' });
    expect(result.state.membershipQrTokens[0]).toMatchObject({ status: 'used' });
  });

  it('rejects redemption when the venue raises its minimum age after issuance', async () => {
    const source = state({
      settings: {
        ...state().settings,
        clubAccount: { minimumPlayerAge: 18 }
      }
    });
    const security = createMembershipQrSecurity({ secret });
    const token = security.tokenFor({
      clubId: 'club-one', playerId: 'firebase-player-one', mutationId: 'opaque-age-policy-issue'
    });
    const issued = applyMembershipQrIssue(source, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: security.tokenId(token)
    }, { nowMs, ttlMs: 120_000 });
    const raisedMinimum = {
      ...issued.state,
      settings: {
        ...issued.state.settings,
        clubAccount: { minimumPlayerAge: 21 }
      }
    };
    const saveState = vi.fn();
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs + 1_000,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: raisedMinimum, revision: 2 })),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      readIdentityRecord: vi.fn(async () => verifiedIdentity(18))
    });
    const response = responseHarness();

    await handlers.redeem({
      orbitAuth: { accountKey: 'club-one', credentialId: 'scanner-one' },
      body: { token, mutationId: 'opaque-age-policy-redeem' }
    }, response);

    expect(response).toMatchObject({ statusCode: 403, body: { code: 'AGE_VERIFICATION_REQUIRED' } });
    expect(saveState).not.toHaveBeenCalled();
    expect(raisedMinimum.membershipQrTokens[0].status).toBe('issued');
  });

  it('rechecks current identity after a state conflict before consuming the token', async () => {
    const { token, issued } = issuedFixture();
    const loadState = vi.fn(async () => ({ accountKey: 'club-one', state: issued.state, revision: 1 }));
    const saveState = vi.fn(async () => {
      throw Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' });
    });
    const readIdentityRecord = vi.fn()
      .mockResolvedValueOnce(verifiedIdentity(21))
      .mockResolvedValueOnce({ status: 'redacted', ageVerified: false, ageLevel: 0 });
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs + 1_000,
      loadState,
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      readIdentityRecord
    });
    const response = responseHarness();

    await handlers.redeem({
      orbitAuth: { accountKey: 'club-one', credentialId: 'scanner-one' },
      body: { token, mutationId: 'opaque-identity-recheck' }
    }, response);

    expect(response).toMatchObject({ statusCode: 403, body: { code: 'AGE_VERIFICATION_REQUIRED' } });
    expect(readIdentityRecord).toHaveBeenCalledTimes(2);
    expect(saveState).toHaveBeenCalledOnce();
    expect(issued.state.membershipQrTokens[0].status).toBe('issued');
  });

  it('checks identity again inside the token-consumption transaction', async () => {
    const { token, issued } = issuedFixture();
    const transactionalRead = vi.fn(async (path) => {
      if (path.startsWith('orbitPlayerDeletionMarkers/')) return null;
      if (path === 'players/firebase-player-one/private/identity') {
        return { status: 'redacted', ageVerified: false, ageLevel: 0 };
      }
      if (path.startsWith('pilotLicenses/')) {
        return { accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' };
      }
      throw new Error(`Unexpected transaction read: ${path}`);
    });
    const saveState = vi.fn(async (nextState, options) => {
      await options.transactionPrecondition({
        transaction: { getDocument: transactionalRead },
        accountKey: 'club-one',
        currentState: issued.state,
        nextState
      });
      throw new Error('an ineligible identity must not reach persistence');
    });
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs + 1_000,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: issued.state, revision: 1 })),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      readIdentityRecord: vi.fn(async () => verifiedIdentity(21))
    });
    const response = responseHarness();

    await handlers.redeem({
      orbitAuth: { accountKey: 'club-one', credentialId: 'scanner-one' },
      body: { token, mutationId: 'opaque-transaction-age-check' }
    }, response);

    expect(response).toMatchObject({ statusCode: 403, body: { code: 'AGE_VERIFICATION_REQUIRED' } });
    expect(saveState).toHaveBeenCalledOnce();
    expect(transactionalRead).toHaveBeenCalledTimes(3);
    expect(issued.state.membershipQrTokens[0].status).toBe('issued');
  });

  it('atomically blocks QR issuance if account deletion begins after route authorization', async () => {
    const source = state();
    const saveState = vi.fn(async (nextState, options) => {
      await options.transactionPrecondition({ currentState: source, nextState });
      throw new Error('a deleted player must not persist a QR token');
    });
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => {
        throw new PlayerStatePreconditionError('PLAYER_ACCOUNT_DELETION_IN_PROGRESS');
      })
    });
    const response = responseHarness();

    await handlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-deletion-race' }
    }, response);

    expect(response).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });
    expect(saveState).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toContain('omq1_');
  });

  it('issues and redeems a club-level check-in without guessing a game', () => {
    const source = state({
      profiles: state().profiles.map((profile) => ({ ...profile, preferredGameIds: [], preferredGameId: '' }))
    });
    const issued = applyMembershipQrIssue(source, {
      clubId: 'club-one', playerId: 'firebase-player-one', tokenId: 'token-no-game'
    }, { nowMs, ttlMs: 120_000 });
    const result = applyMembershipQrRedemption(issued.state, {
      clubId: 'club-one', tokenId: 'token-no-game', redemptionRef: 'redeem-no-game'
    }, redemptionOptions(nowMs + 1_000));
    expect(result).toMatchObject({ ok: true, changed: true, status: 'checked-in' });
    expect(result.state.interests).toEqual([]);
    expect(result.state.playerLedger).toEqual([expect.objectContaining({
      type: 'Check-In',
      profileId: 'legacy-profile-one'
    })]);
    expect(result.state.playerLedger[0]).not.toHaveProperty('gameId');
    expect(result.state.playerLedger[0]).not.toHaveProperty('tableId');
    expect(result.state.membershipQrTokens[0]).toMatchObject({ status: 'used', resultStatus: 'checked-in' });
  });

  it('retries revision conflicts while keeping token and check-in identifiers stable', async () => {
    const source = state();
    let latest = { state: source, revision: 1 };
    const inspectLicenses = vi.fn(async () => [{
      managed: true,
      active: true,
      license: { accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
    }]);
    const saveState = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' }))
      .mockImplementationOnce(async (nextState) => {
        latest = { state: nextState, revision: 3 };
        return { accountKey: 'club-one', revision: 3, savedAt: 'now', duplicate: false };
      });
    const handlers = createMembershipQrHandlers({
      secret,
      ttlMs: 120_000,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => latest),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses: inspectLicenses
    });
    const response = responseHarness();
    await handlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-issue-one' }
    }, response);
    expect(response.statusCode).toBe(201);
    expect(response.body.token).toMatch(/^omq1_/);
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[0][0].membershipQrTokens[0].id)
      .toBe(saveState.mock.calls[1][0].membershipQrTokens[0].id);
    expect(saveState.mock.calls[0][1].mutationId).toBe(saveState.mock.calls[1][1].mutationId);
    expect(inspectLicenses).toHaveBeenCalledTimes(2);
  });

  it('rechecks venue eligibility after a revision conflict and stops on revocation', async () => {
    const source = state();
    const inspectLicenses = vi.fn()
      .mockResolvedValueOnce([{
        managed: true,
        active: true,
        license: { accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
      }])
      .mockResolvedValueOnce([{
        managed: true,
        active: false,
        license: { accountKey: 'club-one', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' }
      }]);
    const saveState = vi.fn(async () => {
      throw Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' });
    });
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses: inspectLicenses
    });
    const response = responseHarness();

    await handlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-license-retry' }
    }, response);

    expect(response).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });
    expect(saveState).toHaveBeenCalledOnce();
    expect(inspectLicenses).toHaveBeenCalledTimes(2);
  });

  it('requires tenant-bound client:write redemption authority', () => {
    const next = vi.fn();
    const missing = responseHarness();
    requireMembershipQrRedeemer({ orbitAuth: { scopes: ['client:write'] } }, missing, next);
    expect(missing).toMatchObject({ statusCode: 403, body: { code: 'MEMBERSHIP_QR_REDEEM_FORBIDDEN' } });
    const wrongScope = responseHarness();
    requireMembershipQrRedeemer({ orbitAuth: { accountKey: 'club-one', scopes: ['client:read'] } }, wrongScope, next);
    expect(wrongScope.statusCode).toBe(403);
    requireMembershipQrRedeemer({ orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] } }, responseHarness(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses issuance for a different authenticated user and a stale duplicate receipt', async () => {
    const source = state();
    const wrongUserHandlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => ({ state: source, revision: 1 })),
      saveState: vi.fn(),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses
    });
    const wrongUser = responseHarness();
    await wrongUserHandlers.issue({
      orbitPlayer: { uid: 'not-linked-user' },
      body: { clubId: 'club-one', mutationId: 'opaque-issue-other' }
    }, wrongUser);
    expect(wrongUser).toMatchObject({ statusCode: 404, body: { code: 'PLAYER_NOT_FOUND' } });

    const staleHandlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => ({ state: source, revision: 1 })),
      saveState: vi.fn(async () => ({ accountKey: 'club-one', revision: 2, savedAt: 'now', duplicate: true })),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses
    });
    const stale = responseHarness();
    await staleHandlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-issue-stale' }
    }, stale);
    expect(stale).toMatchObject({ statusCode: 409, body: { code: 'IDEMPOTENCY_RECEIPT_STALE' } });
    expect(JSON.stringify(stale.body)).not.toContain('omq1_');
  });

  it('rejects issuance before token persistence when the venue license is inactive', async () => {
    const saveState = vi.fn();
    const handlers = createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: state(), revision: 1 })),
      saveState,
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses: vi.fn(async () => [{
        managed: true,
        active: false,
        license: { accountKey: 'club-one', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' }
      }])
    });
    const response = responseHarness();

    await handlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-issue-inactive' }
    }, response);

    expect(response).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });
    expect(saveState).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('omq1_');
  });

  it('uses the transaction clock for QR issuance and rejects membership expiry during the request', async () => {
    const commitAtMs = nowMs + 500;
    const source = state();
    /** @type {any} */
    let committedState;
    const handlers = createMembershipQrHandlers({
      secret,
      ttlMs: 120_000,
      nowMs: () => nowMs,
      preconditionNowMs: () => commitAtMs,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      saveState: vi.fn(async (nextState, options) => {
        const evaluated = await options.transactionPrecondition({
          accountKey: 'club-one', currentState: source, nextState, transaction: {}
        });
        committedState = evaluated.nextState;
        return {
          accountKey: 'club-one', revision: 2, savedAt: 'now', duplicate: false,
          transactionResult: evaluated.result
        };
      }),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => ({ identityRecord: verifiedIdentity(21) }))
    });
    const response = responseHarness();
    await handlers.issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-commit-clock-issue' }
    }, response);

    expect(response).toMatchObject({
      statusCode: 201,
      body: {
        issuedAt: '2026-09-04T18:00:00.500Z',
        expiresAt: '2026-09-04T18:02:00.500Z'
      }
    });
    if (!committedState) throw new Error('Expected the QR transaction to commit state.');
    expect(committedState.membershipQrTokens[0].issuedAt).toBe('2026-09-04T18:00:00.500Z');

    const expiring = state({
      profiles: state().profiles.map((profile) => profile.orbitPlayerId === 'firebase-player-one'
        ? { ...profile, membershipExpiresAt: '2026-09-04T18:00:00.250Z' }
        : profile)
    });
    const rejected = responseHarness();
    await createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs,
      preconditionNowMs: () => commitAtMs,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: expiring, revision: 1 })),
      saveState: vi.fn(async (nextState, options) => {
        await options.transactionPrecondition({
          accountKey: 'club-one', currentState: expiring, nextState, transaction: {}
        });
        throw new Error('expired membership must not reach persistence');
      }),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => ({ identityRecord: verifiedIdentity(21) }))
    }).issue({
      orbitPlayer: { uid: 'firebase-player-one' },
      body: { clubId: 'club-one', mutationId: 'opaque-expiring-membership' }
    }, rejected);
    expect(rejected).toMatchObject({ statusCode: 403, body: { code: 'MEMBERSHIP_NOT_ACTIVE' } });
  });

  it('rechecks token and membership expiry at the redemption transaction clock', async () => {
    const { token, issued } = issuedFixture();
    const executePrecondition = (currentState) => vi.fn(async (nextState, options) => {
      const evaluated = await options.transactionPrecondition({
        accountKey: 'club-one', currentState, nextState, transaction: {}
      });
      return {
        accountKey: 'club-one', revision: 2, savedAt: 'now', duplicate: false,
        transactionResult: evaluated.result
      };
    });
    const tokenExpired = responseHarness();
    await createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs + 1_000,
      preconditionNowMs: () => nowMs + 120_000,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: issued.state, revision: 1 })),
      saveState: executePrecondition(issued.state),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      readIdentityRecord: vi.fn(async () => verifiedIdentity(21)),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => ({ identityRecord: verifiedIdentity(21) }))
    }).redeem({
      orbitAuth: { accountKey: 'club-one', credentialId: 'scanner-one' },
      body: { token, mutationId: 'opaque-token-expiry-race' }
    }, tokenExpired);
    expect(tokenExpired).toMatchObject({ statusCode: 410, body: { code: 'MEMBERSHIP_QR_EXPIRED' } });
    expect(issued.state.membershipQrTokens[0].status).toBe('issued');

    const membershipExpiresAt = new Date(nowMs + 1_500).toISOString();
    const expiringState = {
      ...issued.state,
      profiles: issued.state.profiles.map((profile) => profile.orbitPlayerId === 'firebase-player-one'
        ? { ...profile, membershipExpiresAt }
        : profile)
    };
    const membershipExpired = responseHarness();
    await createMembershipQrHandlers({
      secret,
      nowMs: () => nowMs + 1_000,
      preconditionNowMs: () => nowMs + 2_000,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: expiringState, revision: 1 })),
      saveState: executePrecondition(expiringState),
      schedulePublicationDrain: vi.fn(),
      inspectPilotLicenses,
      readIdentityRecord: vi.fn(async () => verifiedIdentity(21)),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => ({ identityRecord: verifiedIdentity(21) }))
    }).redeem({
      orbitAuth: { accountKey: 'club-one', credentialId: 'scanner-one' },
      body: { token, mutationId: 'opaque-membership-expiry-race' }
    }, membershipExpired);
    expect(membershipExpired).toMatchObject({ statusCode: 403, body: { code: 'MEMBERSHIP_NOT_ACTIVE' } });
    expect(expiringState.membershipQrTokens[0].status).toBe('issued');
  });
});
