import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import playerRoutes from './player';
import playerStatePreconditions from '../playerStatePrecondition.js';

const { PlayerStatePreconditionError } = playerStatePreconditions;

afterEach(() => vi.unstubAllEnvs());

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function activePilotAccess(accountKey, overrides = {}) {
  return {
    authorized: true,
    licenseId: accountKey,
    authorizationCode: `license-${accountKey}`,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides
  };
}

const inspectActivePilotLicenses = vi.fn(async (codes) => codes.map((code) => {
  const accountKey = String(code).replace(/^license-/, '');
  return {
    managed: true,
    active: true,
    license: { accountKey, status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
  };
}));

function tournamentState(overrides = {}) {
  return {
    games: [], sessions: [], playerSessions: [], profiles: [], interests: [],
    buyIns: [{ id: 'buy-one', amount: 100 }],
    playerLedger: [{ id: 'ledger-one', amount: 100 }],
    revenueTransactions: [{ id: 'revenue-one', amount: 100 }],
    tournaments: [{
      id: 'event-one', status: 'Draft', registrationStatus: 'open', buyIn: 100, players: [{ id: 'entrant-one', buyIn: 100 }],
      registrationOpensAt: '2026-09-01T00:00:00.000Z',
      registrationClosesAt: '2026-09-06T00:00:00.000Z', scheduledAt: '2026-09-07T00:00:00.000Z'
    }],
    settings: { pilotAccess: activePilotAccess('club-one') },
    ...overrides
  };
}

describe('Player response DTOs', () => {
  it('places the deletion barrier on every protected Player route except deletion retry', () => {
    const registered = [];
    const app = {
      get(path, ...handlers) { registered.push({ method: 'GET', path, handlers }); },
      post(path, ...handlers) { registered.push({ method: 'POST', path, handlers }); },
      delete(path, ...handlers) { registered.push({ method: 'DELETE', path, handlers }); }
    };
    playerRoutes.registerPlayerRoutes(app);
    const protectedRoutes = registered.filter((route) =>
      route.path.startsWith('/player/')
      && !route.path.startsWith('/player/public/')
      && !route.path.startsWith('/player/auth/')
      && route.path !== '/player/account'
    );
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const route of protectedRoutes) {
      expect(route.handlers.some((handler) => handler.name === 'requireActivePlayerAccount')).toBe(true);
    }
    expect(registered.find((route) => route.path === '/player/account')?.handlers
      .some((handler) => handler.name === 'requireActivePlayerAccount')).toBe(false);
  });

  it('derives membership price and duration only from the authoritative club plan', () => {
    const state = { settings: { membershipPlans: [
      { id: 'monthly-standard', name: 'Standard', priceLabel: '$35', durationDays: 30, active: true },
      { id: 'weekly-custom', name: 'Seven Night Access', priceLabel: '$20', durationDays: 7, active: true },
      { id: 'free-day', name: 'Free Day', priceLabel: '$0', durationDays: 1, active: true }
    ] } };
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, {
      planId: 'monthly-standard',
      plan: 'day',
      priceLabel: '$0',
      membershipDurationDays: 9999
    })).toMatchObject({
      ok: true,
      value: {
        priceLabel: '$35',
        membershipDurationDays: 30,
        membershipPaymentRequired: true
      }
    });
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, {
      planId: 'monthly-standard', plan: 'day'
    }).value).not.toHaveProperty('plan');
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, { planId: 'unknown' })).toMatchObject({ ok: false });
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, { plan: 'monthly' })).toMatchObject({ ok: false });
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, { planId: 'weekly-custom' })).toMatchObject({
      ok: true,
      value: { planId: 'weekly-custom', planName: 'Seven Night Access', membershipDurationDays: 7 }
    });
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, { planId: 'weekly-custom' }).value).not.toHaveProperty('plan');
    expect(playerRoutes.applyAuthoritativeMembershipPlan(state, { planId: 'free-day' })).toMatchObject({
      ok: true,
      value: { membershipPaymentRequired: false }
    });
  });

  it('returns player mutation fields without backend publication internals', () => {
    const response = playerRoutes.buildPlayerMutationResponse({
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      mutationId: 'internal-mutation-id',
      duplicate: false,
      changedEntityCount: 3,
      publication: { status: 'pending', attempts: 0 }
    }, { registrationId: 'tournament:player' });

    expect(response).toEqual({
      ok: true,
      accountKey: 'venue-one',
      savedAt: '2026-08-11T12:00:00.000Z',
      revision: 7,
      registrationId: 'tournament:player'
    });
    expect(response).not.toHaveProperty('mutationId');
    expect(response).not.toHaveProperty('duplicate');
    expect(response).not.toHaveProperty('changedEntityCount');
    expect(response).not.toHaveProperty('publication');
  });

  it('removes player-specific records from public club snapshots', () => {
    const state = {
      settings: {
        accountLogin: { username: 'club@example.com' },
        clubAccount: { clubName: 'Orbit Card House', address: '100 Main Street' },
        membershipPlans: []
      },
      games: [{ id: 'game-1', name: '1/2 NLH', maxSeats: 9 }],
      sessions: [],
      playerSessions: [],
      profiles: [{ id: 'player-1', name: 'Private Player' }],
      interests: [{
        id: 'interest-1',
        gameId: 'game-1',
        profileId: 'player-1',
        playerName: 'Private Player',
        status: 'Interested',
        interestedAt: '2026-08-12T12:00:00.000Z'
      }],
      inAppNotifications: [{
        id: 'notice-1',
        gameId: 'game-1',
        title: 'Private alert',
        body: 'A seat opened.',
        reason: 'seat-opened',
        createdAt: '2026-08-12T12:00:00.000Z',
        targetPlayerIds: ['player-1']
      }]
    };

    const snapshot = playerRoutes.buildPublicClubSnapshot(state);

    expect(snapshot.memberships).toEqual([]);
    expect(snapshot.waitlists).toEqual([]);
    expect(snapshot.notifications).toEqual([]);
    expect(snapshot).not.toHaveProperty('timeAccess');
    expect(snapshot.social.knownPlayersInHouse).toBe(0);
    expect(snapshot.games[0].waitlistCount).toBe(1);
    expect(snapshot.games[0]).not.toHaveProperty('collectionMode');
  });

  it('removes non-public stress games from public club snapshots', () => {
    const state = {
      settings: {
        accountLogin: { username: 'club@example.com' },
        clubAccount: { clubName: 'Orbit Card House' },
        membershipPlans: []
      },
      games: [
        { id: 'game-1', name: '1/2 NLH', maxSeats: 9 },
        { id: 'game-2', name: 'Stress Game', maxSeats: 9 }
      ],
      sessions: [],
      playerSessions: [],
      profiles: [],
      interests: [],
      inAppNotifications: []
    };

    expect(playerRoutes.buildPublicClubSnapshot(state).games.map((game) => game.name)).toEqual(['1/2 NLH']);
  });

  it('fills a public discovery page after skipping non-public account records', async () => {
    const pages = new Map([
      ['', {
        records: [
          { accountKey: 'stress-one', state: { settings: { clubAccount: { clubName: 'Stress Club' } } } },
          { accountKey: 'test-one', state: { settings: { clubAccount: { clubName: 'Test Club' } } } }
        ],
        hasMore: true,
        nextCursor: 'test-one'
      }],
      ['test-one', {
        records: [
          { accountKey: 'aggieland', state: { settings: { clubAccount: { clubName: 'Aggieland Poker Club' }, pilotAccess: activePilotAccess('aggieland') } } },
          { accountKey: 'river-room', state: { settings: { clubAccount: { clubName: 'River Room' }, pilotAccess: activePilotAccess('river-room') } } }
        ],
        hasMore: false,
        nextCursor: null
      }]
    ]);
    const listStatePage = async ({ afterAccountKey = '' }) => pages.get(afterAccountKey);

    const page = await playerRoutes.listPublicStatePage({ limit: 1 }, {
      listStatePage, inspectPilotLicenses: inspectActivePilotLicenses
    });

    expect(page.records.map((record) => record.accountKey)).toEqual(['aggieland']);
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'aggieland' });
  });

  it('does not advertise another public page when only filtered records remain', async () => {
    const listStatePage = async ({ afterAccountKey = '' }) => afterAccountKey
      ? {
          records: [{ accountKey: 'stress-two', state: { settings: { clubAccount: { clubName: 'Stress Fixture' } } } }],
          hasMore: false,
          nextCursor: null
        }
      : {
          records: [{ accountKey: 'aggieland', state: { settings: {
            clubAccount: { clubName: 'Aggieland Poker Club' }, pilotAccess: activePilotAccess('aggieland')
          } } }],
          hasMore: true,
          nextCursor: 'aggieland'
        };

    const page = await playerRoutes.listPublicStatePage({ limit: 1 }, {
      listStatePage, inspectPilotLicenses: inspectActivePilotLicenses
    });

    expect(page.records.map((record) => record.accountKey)).toEqual(['aggieland']);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('filters test/stress clubs and games from authenticated discovery too', async () => {
    const visibleState = {
      settings: {
        accountLogin: { username: 'club@example.test' },
        clubAccount: { clubName: 'Orbit Room' },
        membershipPlans: [],
        pilotAccess: activePilotAccess('visible')
      },
      games: [
        { id: 'holdem', name: '1/2 Holdem', maxSeats: 9 },
        { id: 'stress-game', name: 'Stress Game', maxSeats: 9 }
      ],
      sessions: [], playerSessions: [], profiles: [], interests: [], tournaments: [], inAppNotifications: []
    };
    const listStatePage = vi.fn(async () => ({
      records: [
        { accountKey: 'visible', state: visibleState, savedAt: '2026-09-04T18:00:00.000Z' },
        { accountKey: 'stress', state: {
          ...visibleState,
          settings: { ...visibleState.settings, clubAccount: { clubName: 'Stress Club' } }
        }, savedAt: '2026-09-04T18:00:00.000Z' }
      ],
      hasMore: false,
      nextCursor: null
    }));
    const response = {
      body: undefined,
      set: vi.fn(),
      json(body) { this.body = body; return this; }
    };
    await playerRoutes.handlePlayerDiscovery({
      query: {},
      orbitPlayer: { uid: 'player-one', email: 'one@example.test', email_verified: true }
    }, response, { listStatePage, inspectPilotLicenses: inspectActivePilotLicenses });

    expect(response.body.clubs).toHaveLength(1);
    expect(response.body.clubs[0].club.name).toBe('Orbit Room');
    expect(response.body.clubs[0].games.map((game) => game.name)).toEqual(['1/2 Holdem']);
    expect(response.body.page).toMatchObject({ count: 1, hasMore: false });
  });

  it('fails snapshot reads closed for expired, revoked, or unverifiable venue licenses', async () => {
    const state = {
      games: [], sessions: [], playerSessions: [], profiles: [], interests: [], inAppNotifications: [],
      settings: {
        clubAccount: { clubName: 'Orbit Room' },
        membershipPlans: [],
        pilotAccess: activePilotAccess('club-one')
      }
    };
    const request = {
      query: { accountKey: 'club-one' },
      orbitPlayer: { uid: 'player-one', email: 'one@example.test', email_verified: true }
    };
    const record = (nextState = state) => ({ accountKey: 'club-one', state: nextState, revision: 4, savedAt: 'now' });

    const expiredInspector = vi.fn();
    const expired = responseHarness();
    await playerRoutes.handlePlayerSnapshot(request, expired, {
      loadState: vi.fn(async () => record({
        ...state,
        settings: { ...state.settings, pilotAccess: activePilotAccess('club-one', { expiresAt: '2020-01-01T00:00:00.000Z' }) }
      })),
      inspectPilotLicenses: expiredInspector,
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z')
    });
    expect(expired).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });
    expect(expiredInspector).not.toHaveBeenCalled();

    const revoked = responseHarness();
    await playerRoutes.handlePlayerSnapshot(request, revoked, {
      loadState: vi.fn(async () => record()),
      inspectPilotLicenses: vi.fn(async () => [{
        managed: true,
        active: false,
        license: { accountKey: 'club-one', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' }
      }])
    });
    expect(revoked).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });

    const unavailable = responseHarness();
    await playerRoutes.handlePlayerSnapshot(request, unavailable, {
      loadState: vi.fn(async () => record()),
      inspectPilotLicenses: vi.fn(async () => { throw new Error('offline'); })
    });
    expect(unavailable).toMatchObject({ statusCode: 503, body: { code: 'PLAYER_VENUE_LICENSE_UNAVAILABLE' } });
  });

  it('rejects every venue-bound Player state mutation before save when the license is revoked', async () => {
    const source = {
      games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }], sessions: [], playerSessions: [],
      profiles: [{
        id: 'player-one', orbitPlayerId: 'player-one', name: 'Verified Player',
        membershipStatus: 'Active', membershipExpiresAt: '2099-01-01T00:00:00.000Z'
      }],
      interests: [], inAppNotifications: [], tournaments: tournamentState().tournaments,
      settings: {
        pilotAccess: activePilotAccess('club-one'), clubAccount: { clubName: 'Club One' },
        membershipPlans: [{ id: 'weekly', name: 'Weekly', priceLabel: '$20', durationDays: 7, active: true }]
      }
    };
    const orbitPlayer = { uid: 'player-one', name: 'Verified Player', email: 'one@example.test', email_verified: true };
    const loadState = vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1, savedAt: 'now' }));
    const saveState = vi.fn();
    const inspectPilotLicenses = vi.fn(async () => [{
      managed: true,
      active: false,
      license: { accountKey: 'club-one', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' }
    }]);
    const dependencies = { loadState, saveState, inspectPilotLicenses };

    const membership = responseHarness();
    await playerRoutes.handlePlayerMembershipRequest({
      orbitPlayer,
      body: {
        id: 'join_550e8400-e29b-41d4-a716-446655440000', clubId: 'club-one', type: 'membership-request',
        planId: 'weekly', requestedAt: '2026-09-04T18:00:00.000Z',
        player: { id: 'player-one', name: 'Client Name', email: 'one@example.test' }
      }
    }, membership, dependencies);
    expect(membership).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });

    const waitlist = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({
      orbitPlayer,
      body: {
        id: 'wait_550e8400-e29b-41d4-a716-446655440000', clubId: 'club-one', type: 'waitlist-request',
        gameId: 'holdem', action: 'join', attendance: 'interested', requestedAt: '2026-09-04T18:00:00.000Z',
        player: { id: 'player-one', name: 'Client Name', email: 'one@example.test' }
      }
    }, waitlist, dependencies);
    expect(waitlist).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });

    const tournament = responseHarness();
    await playerRoutes.createTournamentInterestHandler(dependencies)({
      orbitPlayer,
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-one' }
    }, tournament, 'express');
    expect(tournament).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });
    expect(saveState).not.toHaveBeenCalled();
  });

  it('fails membership, waitlist, and tournament writes when current commit-time security state changed', async () => {
    const membershipState = {
      games: [], sessions: [], playerSessions: [], profiles: [], interests: [], inAppNotifications: [], tournaments: [],
      settings: {
        pilotAccess: activePilotAccess('club-one'),
        clubAccount: { clubName: 'Club One', minimumPlayerAge: 21 },
        membershipPlans: [{ id: 'weekly', name: 'Weekly', priceLabel: '$20', durationDays: 7, active: true }]
      }
    };
    const waitlistState = {
      ...membershipState,
      games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
      profiles: [{
        id: 'legacy-one', orbitPlayerId: 'player-one', name: 'Verified Player',
        membershipStatus: 'Active', membershipExpiresAt: '2099-01-01T00:00:00.000Z'
      }]
    };
    const orbitPlayer = { uid: 'player-one', name: 'Verified Player', email: 'one@example.test', email_verified: true };
    const baseDependencies = {
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      schedulePublicationDrain: vi.fn(),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    };
    const commitFailure = async (_state, options) => {
      await options.transactionPrecondition({});
      throw new Error('unreachable');
    };

    const membershipResponse = responseHarness();
    await playerRoutes.handlePlayerMembershipRequest({
      orbitPlayer,
      body: {
        id: 'join_550e8400-e29b-41d4-a716-446655440009', clubId: 'club-one', type: 'membership-request',
        planId: 'weekly', requestedAt: '2026-09-04T18:00:00.000Z',
        player: { id: 'player-one', name: 'Verified Player', email: 'one@example.test' }
      }
    }, membershipResponse, {
      ...baseDependencies,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: membershipState, revision: 1 })),
      saveState: vi.fn(commitFailure),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => {
        throw new PlayerStatePreconditionError('PLAYER_ACCOUNT_DELETION_IN_PROGRESS');
      })
    });
    expect(membershipResponse).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });

    const waitlistResponse = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({
      orbitPlayer,
      body: {
        id: 'wait_550e8400-e29b-41d4-a716-446655440009', clubId: 'club-one', type: 'waitlist-request',
        gameId: 'holdem', action: 'join', attendance: 'interested',
        requestedAt: '2026-09-04T18:00:00.000Z',
        player: { id: 'player-one', name: 'Verified Player', email: 'one@example.test' }
      }
    }, waitlistResponse, {
      ...baseDependencies,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: waitlistState, revision: 1 })),
      saveState: vi.fn(commitFailure),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => {
        throw new PlayerStatePreconditionError('AGE_VERIFICATION_REQUIRED', { minimumAge: 21 });
      })
    });
    expect(waitlistResponse).toMatchObject({ statusCode: 403, body: { code: 'AGE_VERIFICATION_REQUIRED' } });

    const tournamentResponse = responseHarness();
    const tournamentHandler = playerRoutes.createTournamentInterestHandler({
      ...baseDependencies,
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: tournamentState(), revision: 1 })),
      saveState: vi.fn(commitFailure),
      randomUUID: () => 'commit-race',
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => {
        throw new PlayerStatePreconditionError('PLAYER_VENUE_LICENSE_INACTIVE');
      })
    });
    await tournamentHandler({
      orbitPlayer,
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-commit-race' }
    }, tournamentResponse, 'express');
    expect(tournamentResponse).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_VENUE_LICENSE_INACTIVE' } });
  });

  it('keeps Player membership checkout default-off behind an explicit compatibility gate', () => {
    const disabled = responseHarness();
    const next = vi.fn();
    playerRoutes.requirePlayerMembershipCheckoutEnabled({}, disabled, next);
    expect(disabled).toMatchObject({
      statusCode: 410,
      body: { ok: false, code: 'PLAYER_MEMBERSHIP_CHECKOUT_DISABLED' }
    });
    expect(next).not.toHaveBeenCalled();

    vi.stubEnv('ORBIT_ENABLE_PLAYER_MEMBERSHIP_CHECKOUT', 'true');
    const enabled = responseHarness();
    playerRoutes.requirePlayerMembershipCheckoutEnabled({}, enabled, next);
    expect(next).toHaveBeenCalledOnce();
    expect(enabled.body).toBeUndefined();
  });

  it('requires a current authoritative game and same-game active table for waitlist requests', () => {
    const state = {
      games: [{ id: 'holdem' }, { id: 'omaha' }],
      sessions: [
        { id: 'table-holdem', gameId: 'holdem', status: 'Running' },
        { id: 'table-omaha', gameId: 'omaha', status: 'Running' },
        { id: 'table-forming', gameId: 'holdem', status: 'Forming' },
        { id: 'table-paused', gameId: 'holdem', status: 'Paused' },
        { id: 'table-closed', gameId: 'holdem', status: 'Closed' }
      ]
    };
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, { gameId: 'missing' })).toMatchObject({
      ok: false, status: 404, code: 'GAME_NOT_FOUND'
    });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-omaha', action: 'join', attendance: 'arrived'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_NOT_AVAILABLE_FOR_GAME' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-closed', action: 'join', attendance: 'arrived'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_NOT_AVAILABLE_FOR_GAME' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-forming', action: 'join', attendance: 'arrived'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_NOT_AVAILABLE_FOR_GAME' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-paused', action: 'join', attendance: 'arrived'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_NOT_AVAILABLE_FOR_GAME' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', action: 'join', attendance: 'interested'
    })).toEqual({ ok: true });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-holdem', action: 'join', attendance: 'arrived'
    })).toEqual({ ok: true });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', action: 'join', attendance: 'confirmed'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_REQUIRED_FOR_ATTENDANCE' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', tableId: 'table-holdem', action: 'join', attendance: 'interested'
    })).toMatchObject({ ok: false, status: 409, code: 'TABLE_NOT_ALLOWED_FOR_INTEREST' });
    expect(playerRoutes.validateAuthoritativeWaitlistTarget(state, {
      gameId: 'holdem', action: 'join'
    })).toMatchObject({ ok: false, status: 400, code: 'ATTENDANCE_REQUIRED' });
  });

  it('requires an exact active unexpired membership for joins but permits only owned cancellation', async () => {
    const nowMs = () => Date.parse('2026-09-04T18:00:00.000Z');
    const base = {
      games: [{ id: 'holdem' }], sessions: [], playerSessions: [],
      settings: { pilotAccess: activePilotAccess('club-one'), clubAccount: { clubName: 'Club One' } },
      interests: [], profiles: []
    };
    const request = {
      clubId: 'club-one', gameId: 'holdem', action: 'join', player: { id: 'firebase-player' }
    };
    for (const profile of [
      undefined,
      { id: 'legacy', orbitPlayerId: 'firebase-player', membershipStatus: 'Requested', membershipExpirationDate: '2099-01-01' },
      { id: 'legacy', orbitPlayerId: 'firebase-player', membershipStatus: 'Approved', membershipExpirationDate: '2099-01-01' },
      { id: 'legacy', orbitPlayerId: 'firebase-player', membershipStatus: 'Active', membershipExpirationDate: '2026-09-01' }
    ]) {
      expect(playerRoutes.validatePlayerWaitlistAuthorization({
        ...base, profiles: profile ? [profile] : []
      }, request, { nowMs })).toMatchObject({
        ok: false, status: 403, code: 'ACTIVE_MEMBERSHIP_REQUIRED'
      });
    }
    const activeProfile = {
      id: 'legacy', orbitPlayerId: 'firebase-player', membershipStatus: 'Active', membershipExpirationDate: '2099-01-01'
    };
    expect(playerRoutes.validatePlayerWaitlistAuthorization({
      ...base, profiles: [activeProfile]
    }, request, { nowMs })).toMatchObject({ ok: true, profile: activeProfile });
    expect(playerRoutes.validatePlayerWaitlistAuthorization({
      ...base, profiles: [activeProfile]
    }, { ...request, clubId: 'wrong-club' }, { nowMs })).toMatchObject({ ok: false, code: 'CLUB_NOT_FOUND' });

    const ownedInterest = { id: 'owned', gameId: 'holdem', profileId: 'legacy', status: 'Interested' };
    expect(playerRoutes.validatePlayerWaitlistAuthorization({
      ...base, profiles: [{ ...activeProfile, membershipStatus: 'Expired' }], interests: [ownedInterest]
    }, { ...request, action: 'cancel' }, { nowMs })).toMatchObject({ ok: true });
    expect(playerRoutes.validatePlayerWaitlistAuthorization({
      ...base,
      profiles: [{ ...activeProfile, membershipStatus: 'Expired' }],
      interests: [{ ...ownedInterest, profileId: 'other-player' }]
    }, { ...request, action: 'cancel' }, { nowMs })).toMatchObject({
      ok: false, status: 404, code: 'WAITLIST_REQUEST_NOT_FOUND'
    });

    const saveState = vi.fn();
    const response = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({
      body: {
        id: 'wait_550e8400-e29b-41d4-a716-446655440000',
        clubId: 'club-one', type: 'waitlist-request', gameId: 'holdem', action: 'join',
        attendance: 'interested',
        requestedAt: '2026-09-04T18:00:00.000Z',
        player: { id: 'firebase-player', name: 'Untrusted', email: 'player@example.test' }
      },
      orbitPlayer: {
        uid: 'firebase-player', name: 'Verified Player', email: 'player@example.test', email_verified: true
      },
      orbitIdentitySummary: { fullName: 'Verified Player' }
    }, response, {
      loadState: async () => ({ state: base, revision: 1 }),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs,
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(response).toMatchObject({ statusCode: 403, body: { code: 'ACTIVE_MEMBERSHIP_REQUIRED' } });
    expect(saveState).not.toHaveBeenCalled();
  });

  it('fingerprints membership request IDs and replays the current committed snapshot', async () => {
    const source = {
      games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }], sessions: [], playerSessions: [],
      profiles: [], interests: [], inAppNotifications: [], tournaments: [],
      settings: {
        pilotAccess: activePilotAccess('club-one'),
        clubAccount: { clubName: 'Club One' },
        membershipPlans: [{ id: 'weekly', name: 'Weekly', priceLabel: '$20', durationDays: 7, active: true }]
      }
    };
    const body = {
      id: 'join_550e8400-e29b-41d4-a716-446655440000',
      clubId: 'club-one', type: 'membership-request', planId: 'weekly',
      requestedAt: '1999-01-01T00:00:00.000Z',
      player: { id: 'player-one', name: 'Client Name', email: 'one@example.test' }
    };
    const orbitPlayer = { uid: 'player-one', name: 'Verified Player', email: 'one@example.test', email_verified: true };
    const saveState = vi.fn(async (_nextState = source, _options = {}) => ({
      accountKey: 'club-one', savedAt: '2026-09-04T18:00:01.000Z', revision: 2, duplicate: false
    }));
    const serverNow = vi.fn(() => Date.parse('2026-09-04T18:00:00.000Z'));
    const first = responseHarness();
    await playerRoutes.handlePlayerMembershipRequest({ body, orbitPlayer }, first, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs: serverNow,
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(first.statusCode).toBe(201);
    expect(serverNow).toHaveBeenCalledOnce();
    expect(saveState.mock.calls[0][1]).toMatchObject({
      globalMutationScope: expect.stringMatching(/^membership:[a-f0-9]{64}$/),
      globalMutationFingerprint: expect.any(String),
      globalMutationResult: { operation: 'membership-request' }
    });
    expect(saveState.mock.calls[0][0].profiles[0].membershipRequestedAt)
      .toBe('2026-09-04T18:00:00.000Z');
    expect(JSON.stringify(saveState.mock.calls[0][0])).not.toContain('1999-01-01');

    const fingerprint = ['membership-request', 'club-one', 'player-one', 'weekly', 'in-person'].join('\u0000');
    const receipt = { fingerprintRef: createHash('sha256').update(fingerprint).digest('hex') };
    const advanced = {
      ...source,
      games: [...source.games, { id: 'omaha', name: 'Omaha', maxSeats: 9 }],
      profiles: [{ id: 'player-one', orbitPlayerId: 'player-one', name: 'Verified Player', membershipStatus: 'Requested' }]
    };
    const replaySave = vi.fn();
    const replay = responseHarness();
    await playerRoutes.handlePlayerMembershipRequest({
      body: { ...body, requestedAt: '2099-01-01T00:00:00.000Z' }, orbitPlayer
    }, replay, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: advanced, revision: 9, savedAt: 'later' })),
      loadGlobalMutationReceipt: vi.fn(async () => receipt),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState: replaySave,
      nowMs: () => Date.parse('2026-09-05T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(replay).toMatchObject({ statusCode: 200, body: { revision: 9 } });
    expect(replay.body.snapshot.games.map((game) => game.id)).toEqual(['holdem', 'omaha']);
    expect(replaySave).not.toHaveBeenCalled();

    const conflict = responseHarness();
    await playerRoutes.handlePlayerMembershipRequest({ body: { ...body, planId: 'different-plan' }, orbitPlayer }, conflict, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: advanced, revision: 9, savedAt: 'later' })),
      loadGlobalMutationReceipt: vi.fn(async () => receipt),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState: replaySave,
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(conflict).toMatchObject({ statusCode: 409, body: { code: 'MUTATION_ID_REUSED' } });
  });

  it('fingerprints waitlist request IDs and never returns an uncommitted replay snapshot', async () => {
    const source = {
      games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }, { id: 'omaha', name: 'Omaha', maxSeats: 9 }],
      sessions: [], playerSessions: [], interests: [], inAppNotifications: [], tournaments: [],
      profiles: [{
        id: 'legacy-one', orbitPlayerId: 'player-one', name: 'Verified Player',
        membershipStatus: 'Active', membershipExpiresAt: '2099-01-01T00:00:00.000Z'
      }],
      settings: { pilotAccess: activePilotAccess('club-one'), clubAccount: { clubName: 'Club One' } }
    };
    const body = {
      id: 'wait_550e8400-e29b-41d4-a716-446655440000', clubId: 'club-one', type: 'waitlist-request',
      gameId: 'holdem', action: 'join', attendance: 'interested', requestedAt: '2099-01-01T00:00:00.000Z',
      player: { id: 'player-one', name: 'Client Name', email: 'one@example.test' }
    };
    const orbitPlayer = { uid: 'player-one', name: 'Verified Player', email: 'one@example.test', email_verified: true };
    const saveState = vi.fn(async (_nextState = source, _options = {}) => ({
      accountKey: 'club-one', savedAt: 'now', revision: 2, duplicate: false
    }));
    const serverNow = vi.fn(() => Date.parse('2026-09-04T18:00:00.000Z'));
    const first = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({ body, orbitPlayer }, first, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs: serverNow,
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(first.statusCode).toBe(201);
    expect(serverNow).toHaveBeenCalledOnce();
    expect(saveState.mock.calls[0][1]).toMatchObject({
      globalMutationScope: expect.stringMatching(/^waitlist:[a-f0-9]{64}$/),
      globalMutationFingerprint: expect.any(String),
      globalMutationResult: { operation: 'waitlist-join' }
    });
    expect(saveState.mock.calls[0][0].interests[0]).toMatchObject({
      timestamp: '2026-09-04T18:00:00.000Z',
      interestedAt: '2026-09-04T18:00:00.000Z'
    });
    expect(JSON.stringify(saveState.mock.calls[0][0].interests)).not.toContain('2099-01-01');

    const fingerprint = [
      'waitlist-request', 'club-one', 'player-one', 'join', 'holdem', 'interested', '', '', '', ''
    ].join('\u0000');
    const receipt = { fingerprintRef: createHash('sha256').update(fingerprint).digest('hex') };
    const advanced = { ...source, interests: [{
      id: 'staff-advanced', profileId: 'legacy-one', playerName: 'Verified Player', gameId: 'holdem', status: 'Seated'
    }] };
    const replaySave = vi.fn();
    const replay = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({
      body: { ...body, requestedAt: '1999-01-01T00:00:00.000Z' }, orbitPlayer
    }, replay, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: advanced, revision: 11, savedAt: 'later' })),
      loadGlobalMutationReceipt: vi.fn(async () => receipt),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState: replaySave,
      nowMs: () => Date.parse('2026-09-05T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(replay).toMatchObject({ statusCode: 200, body: { revision: 11 } });
    expect(replay.body.snapshot.waitlists[0]).toMatchObject({ id: 'staff-advanced', status: 'Seated' });
    expect(replaySave).not.toHaveBeenCalled();

    const conflict = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({ body: { ...body, gameId: 'omaha' }, orbitPlayer }, conflict, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: advanced, revision: 11, savedAt: 'later' })),
      loadGlobalMutationReceipt: vi.fn(async () => receipt),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState: replaySave,
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(conflict).toMatchObject({ statusCode: 409, body: { code: 'MUTATION_ID_REUSED' } });

    const legacy = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({ body, orbitPlayer }, legacy, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 2, savedAt: 'later' })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => ({ revision: 2, legacy: true })),
      saveState: replaySave,
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(legacy).toMatchObject({ statusCode: 409, body: { code: 'IDEMPOTENCY_RECEIPT_STALE' } });
  });

  it('rechecks membership at the waitlist commit clock and stamps the accepted server time', async () => {
    const source = {
      games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }], sessions: [], playerSessions: [], interests: [],
      inAppNotifications: [], tournaments: [],
      profiles: [{
        id: 'legacy-one', orbitPlayerId: 'player-one', name: 'Verified Player',
        membershipStatus: 'Active', membershipExpiresAt: '2026-09-04T18:00:01.000Z'
      }],
      settings: { pilotAccess: activePilotAccess('club-one'), clubAccount: { clubName: 'Club One' } }
    };
    const body = {
      id: 'wait_550e8400-e29b-41d4-a716-446655440099', clubId: 'club-one', type: 'waitlist-request',
      gameId: 'holdem', action: 'join', attendance: 'interested', requestedAt: '1999-01-01T00:00:00.000Z',
      player: { id: 'player-one', name: 'Ignored', email: 'one@example.test' }
    };
    const orbitPlayer = { uid: 'player-one', name: 'Verified Player', email: 'one@example.test', email_verified: true };
    const saveState = vi.fn(async (nextState, options) => {
      const evaluated = await options.transactionPrecondition({
        accountKey: 'club-one', currentState: source, nextState, transaction: {}
      });
      return {
        accountKey: 'club-one', savedAt: 'now', revision: 2, duplicate: false,
        transactionResult: evaluated.result
      };
    });
    const expired = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({ body, orbitPlayer }, expired, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: source, revision: 1 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      preconditionNowMs: () => Date.parse('2026-09-04T18:00:02.000Z'),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => undefined),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(expired).toMatchObject({ statusCode: 403, body: { code: 'ACTIVE_MEMBERSHIP_REQUIRED' } });

    const activeSource = {
      ...source,
      profiles: [{ ...source.profiles[0], membershipExpiresAt: '2026-09-04T18:00:10.000Z' }]
    };
    /** @type {any} */
    let committedState;
    const accepted = responseHarness();
    await playerRoutes.handlePlayerWaitlistRequest({ body: { ...body, id: 'wait_550e8400-e29b-41d4-a716-446655440098' }, orbitPlayer }, accepted, {
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: activeSource, revision: 1 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      loadStateMutationReceipt: vi.fn(async () => null),
      saveState: vi.fn(async (nextState, options) => {
        const evaluated = await options.transactionPrecondition({
          accountKey: 'club-one', currentState: activeSource, nextState, transaction: {}
        });
        committedState = evaluated.nextState;
        return {
          accountKey: 'club-one', savedAt: 'now', revision: 2, duplicate: false,
          transactionResult: evaluated.result
        };
      }),
      schedulePublicationDrain: vi.fn(),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      preconditionNowMs: () => Date.parse('2026-09-04T18:00:02.000Z'),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => undefined),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    expect(accepted.statusCode).toBe(201);
    if (!committedState) throw new Error('Expected the waitlist transaction to commit state.');
    expect(committedState.interests[0]).toMatchObject({
      timestamp: '2026-09-04T18:00:02.000Z',
      interestedAt: '2026-09-04T18:00:02.000Z'
    });
    expect(JSON.stringify(committedState.interests)).not.toContain('1999-01-01');
  });

  it('commits authenticated tournament interest without changing operational tournament or financial state', async () => {
    const source = tournamentState();
    const saveState = vi.fn(async (nextState, options) => ({
      accountKey: 'club-one', savedAt: '2026-09-04T18:00:00.000Z', revision: 5, duplicate: false,
      nextState, options
    }));
    const drain = vi.fn();
    const handler = playerRoutes.createTournamentInterestHandler({
      loadState: vi.fn(async () => ({ state: source, revision: 4 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: drain,
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses,
      randomUUID: () => '00000000-0000-4000-8000-000000000001'
    });
    const response = responseHarness();
    await handler({
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-one' },
      orbitPlayer: { uid: 'firebase-player-one' }
    }, response, 'express');

    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({
      ok: true,
      interest: { id: 'ti_00000000-0000-4000-8000-000000000001', playerId: 'firebase-player-one', status: 'interested' }
    });
    const [nextState, options] = saveState.mock.calls[0];
    expect(nextState.tournaments).toEqual(source.tournaments);
    expect(nextState.buyIns).toEqual(source.buyIns);
    expect(nextState.playerLedger).toEqual(source.playerLedger);
    expect(nextState.revenueTransactions).toEqual(source.revenueTransactions);
    expect(options.mutationId).toMatch(/^tournament-interest:[a-f0-9]{64}$/);
    expect(options.mutationId).not.toContain('firebase-player-one');
    expect(drain).toHaveBeenCalledOnce();
  });

  it('retries a revision conflict with one stable interest and receipt identity', async () => {
    const source = tournamentState();
    const saveState = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' }))
      .mockResolvedValueOnce({ accountKey: 'club-one', savedAt: 'now', revision: 6, duplicate: false });
    const handler = playerRoutes.createTournamentInterestHandler({
      loadState: vi.fn()
        .mockResolvedValueOnce({ state: source, revision: 4 })
        .mockResolvedValueOnce({ state: source, revision: 5 }),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses,
      randomUUID: () => 'stable-interest'
    });
    const response = responseHarness();
    await handler({ body: {
      clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-one'
    }, orbitPlayer: { uid: 'player-one' } }, response, 'express');

    expect(response.statusCode).toBe(201);
    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState.mock.calls[0][0].tournamentInterests[0].id).toBe('ti_stable-interest');
    expect(saveState.mock.calls[1][0].tournamentInterests[0].id).toBe('ti_stable-interest');
    expect(saveState.mock.calls[0][1].mutationId).toBe(saveState.mock.calls[1][1].mutationId);
  });

  it('rechecks express and withdraw boundaries at the tournament commit clock', async () => {
    const base = tournamentState();
    const createExecutingSave = (currentState) => vi.fn(async (nextState, options) => {
      const evaluated = await options.transactionPrecondition({
        accountKey: 'club-one', currentState, nextState, transaction: {}
      });
      return {
        accountKey: 'club-one', savedAt: 'now', revision: 5, duplicate: false,
        transactionResult: evaluated.result,
        idempotencyResult: evaluated.result?.globalMutationResult
      };
    });
    const dependencies = (currentState, saveState) => ({
      loadState: vi.fn(async () => ({ accountKey: 'club-one', state: currentState, revision: 4 })),
      loadGlobalMutationReceipt: vi.fn(async () => null),
      saveState,
      schedulePublicationDrain: vi.fn(),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      preconditionNowMs: () => Date.parse('2026-09-04T18:00:02.000Z'),
      createCurrentPlayerStatePrecondition: vi.fn(() => async () => undefined),
      inspectPilotLicenses: inspectActivePilotLicenses,
      randomUUID: () => 'commit-clock-interest'
    });

    const closing = {
      ...base,
      tournaments: [{
        ...base.tournaments[0],
        registrationClosesAt: '2026-09-04T18:00:01.000Z',
        scheduledAt: '2026-09-04T19:00:00.000Z'
      }]
    };
    const expressSave = createExecutingSave(closing);
    const express = responseHarness();
    await playerRoutes.createTournamentInterestHandler(dependencies(closing, expressSave))({
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-clock-express' },
      orbitPlayer: { uid: 'player-one' }
    }, express, 'express');
    expect(express).toMatchObject({ statusCode: 409, body: { code: 'TOURNAMENT_INTEREST_CLOSED' } });

    const existing = {
      id: 'ti_existing', clubId: 'club-one', tournamentId: 'event-one', playerId: 'player-one',
      status: 'interested', createdAt: '2026-09-04T17:00:00.000Z', updatedAt: '2026-09-04T17:00:00.000Z'
    };
    const starting = {
      ...base,
      tournamentInterests: [existing],
      tournaments: [{
        ...base.tournaments[0], unregisterAllowed: true,
        scheduledAt: '2026-09-04T18:00:01.000Z'
      }]
    };
    const withdraw = responseHarness();
    await playerRoutes.createTournamentInterestHandler(dependencies(starting, createExecutingSave(starting)))({
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-clock-withdraw' },
      orbitPlayer: { uid: 'player-one' }
    }, withdraw, 'withdraw');
    expect(withdraw).toMatchObject({
      statusCode: 409,
      body: { code: 'TOURNAMENT_INTEREST_WITHDRAWAL_CLOSED' }
    });
  });

  it('replays the original interest result and rejects conflicting mutation-ID reuse before state mutation', async () => {
    const loadState = vi.fn(async () => ({ state: tournamentState(), revision: 8 }));
    const stored = {
      accountKey: 'club-one', revision: 7, createdAt: '2026-09-04T18:00:00.000Z',
      fingerprintRef: createHash('sha256').update('express\u0000club-one\u0000event-one').digest('hex'),
      result: {
        interestId: 'ti_original', status: 'interested',
        createdAt: '2026-09-04T17:00:00.000Z', updatedAt: '2026-09-04T17:00:00.000Z'
      }
    };
    const replayHandler = playerRoutes.createTournamentInterestHandler({
      loadState,
      loadGlobalMutationReceipt: vi.fn(async () => stored),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    const replay = responseHarness();
    await replayHandler({
      body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-one' },
      orbitPlayer: { uid: 'player-one' }
    }, replay, 'express');
    expect(replay).toMatchObject({
      statusCode: 200,
      body: { interest: { id: 'ti_original', playerId: 'player-one', status: 'interested' }, revision: 7 }
    });
    expect(loadState).toHaveBeenCalledOnce();

    const conflictHandler = playerRoutes.createTournamentInterestHandler({
      loadState,
      loadGlobalMutationReceipt: vi.fn(async () => stored),
      nowMs: () => Date.parse('2026-09-04T18:00:00.000Z'),
      inspectPilotLicenses: inspectActivePilotLicenses
    });
    const conflict = responseHarness();
    await conflictHandler({
      body: { clubId: 'club-one', tournamentId: 'event-two', mutationId: 'opaque-request-one' },
      orbitPlayer: { uid: 'player-one' }
    }, conflict, 'express');
    expect(conflict).toMatchObject({ statusCode: 409, body: { code: 'MUTATION_ID_REUSED' } });
    expect(loadState).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong-player fields, wrong-club lookups, and both legacy registration methods', async () => {
    const loadState = vi.fn(async () => null);
    const handler = playerRoutes.createTournamentInterestHandler({ loadState });
    const wrongPlayer = responseHarness();
    await handler({ body: {
      clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-request-one', playerId: 'other'
    }, orbitPlayer: { uid: 'player-one' } }, wrongPlayer, 'express');
    expect(wrongPlayer).toMatchObject({ statusCode: 400, body: { code: 'INVALID_INPUT' } });
    expect(loadState).not.toHaveBeenCalled();

    const wrongClub = responseHarness();
    await handler({ body: {
      clubId: 'club-two', tournamentId: 'event-one', mutationId: 'opaque-request-one'
    }, orbitPlayer: { uid: 'player-one' } }, wrongClub, 'express');
    expect(wrongClub).toMatchObject({ statusCode: 404, body: { code: 'CLUB_NOT_FOUND' } });

    for (const method of ['POST', 'DELETE']) {
      const legacy = responseHarness();
      playerRoutes.rejectLegacyTournamentRegistration({ method }, legacy);
      expect(legacy).toMatchObject({
        statusCode: 410,
        body: { code: 'PLAYER_TOURNAMENT_REGISTRATION_DISABLED' }
      });
    }
  });
});
