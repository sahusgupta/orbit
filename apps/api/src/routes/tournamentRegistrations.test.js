import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import routes from './tournamentRegistrations';
import preconditions from '../playerStatePrecondition';

const nowMs = Date.parse('2026-10-20T12:00:00Z');
const request = { body: { clubId: 'club-one', tournamentId: 'event-one', mutationId: 'opaque-registration-request' },
  orbitPlayer: { uid: 'player-one', name: 'Verified Player', email: 'verified@example.invalid', email_verified: true } };
const source = () => ({
  settings: { clubAccount: { email: 'club-one' }, pilotAccess: { authorized: true, licenseId: 'club-one', authorizationCode: 'fixture-license', expiresAt: '2099-01-01T00:00:00Z' } },
  profiles: [], tournaments: [{ id: 'event-one', name: 'Launch Freeroll', status: 'Draft', registrationStatus: 'open',
    registrationOpensAt: '2026-10-01T00:00:00Z', registrationClosesAt: '2026-10-21T12:00:00Z', scheduledAt: '2026-10-21T13:00:00Z',
    buyIn: 0, startingStack: 10000, players: [] }]
});
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

function harness(overrides = {}) {
  const state = source();
  const security = vi.fn(async () => undefined);
  const saveState = vi.fn(async (_state, options) => {
    const transactionResult = (await options.transactionPrecondition({ currentState: state })).result;
    return { accountKey: 'club-one', revision: 2, savedAt: new Date(nowMs).toISOString(), transactionResult };
  });
  const dependencies = {
    loadState: vi.fn(async () => ({ accountKey: 'club-one', revision: 1, state })),
    loadGlobalMutationReceipt: vi.fn(async () => null), saveState,
    nowMs: () => nowMs, preconditionNowMs: () => nowMs, randomUUID: () => 'fixture',
    schedulePublicationDrain: vi.fn(), createCurrentPlayerStatePrecondition: vi.fn(() => security),
    inspectPilotLicenses: vi.fn(async () => [{ managed: true, active: true, license: { accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00Z' } }]),
    ...overrides
  };
  return { handler: routes.createTournamentRegistrationHandler(dependencies), state, security, dependencies };
}

describe('authoritative free-event registration route', () => {
  it('commits an authenticated zero-cost entrant and uses revision/receipt/security barriers', async () => {
    const test = harness(), res = response();
    await test.handler(request, res);
    expect(res).toMatchObject({ statusCode: 201, body: { ok: true, registration: { playerId: 'player-one', status: 'registered' } } });
    const [saved, options] = test.dependencies.saveState.mock.calls[0];
    expect(saved.tournaments[0].players[0]).toMatchObject({ buyIn: 0, status: 'Registered' });
    expect(options).toMatchObject({ expectedRevision: 1, mutationType: 'player-tournament-registration', globalMutationFingerprint: 'club-one\u0000event-one' });
    expect(options.mutationId).toMatch(/^tournament-registration:[a-f0-9]{64}$/);
    expect(options.globalMutationResult).toEqual({ registrationId: 'tr_fixture', status: 'registered', registeredAt: new Date(nowMs).toISOString() });
    expect(JSON.stringify(options.globalMutationResult)).not.toContain('player-one');
    expect(test.security).toHaveBeenCalledWith(expect.objectContaining({ commitNowMs: nowMs }));
    expect(test.dependencies.schedulePublicationDrain).toHaveBeenCalledOnce();
  });

  it('replays the original receipt and rejects reused mutation IDs without writing', async () => {
    const registration = { id: 'original', playerId: 'player-one', tournamentId: 'event-one', clubId: 'club-one', status: 'registered', registeredAt: new Date(nowMs).toISOString() };
    const receipt = { accountKey: 'club-one', revision: 5, result: { registrationId: registration.id, status: registration.status, registeredAt: registration.registeredAt }, fingerprintRef: createHash('sha256').update('club-one\u0000event-one').digest('hex') };
    const test = harness({ loadGlobalMutationReceipt: vi.fn(async () => receipt) }), res = response();
    await test.handler(request, res);
    expect(res.body.registration).toEqual(registration);
    const conflict = response();
    await test.handler({ ...request, body: { ...request.body, tournamentId: 'different-event' } }, conflict);
    expect(conflict).toMatchObject({ statusCode: 409, body: { code: 'MUTATION_ID_REUSED' } });
    expect(test.dependencies.saveState).not.toHaveBeenCalled();
  });

  it.each(['price', 'window', 'security'])('rechecks %s at the transaction commit boundary', async (change) => {
    const test = harness(), res = response();
    test.dependencies.saveState.mockImplementation(async (_state, options) => {
      const currentState = source();
      if (change === 'price') currentState.tournaments[0].buyIn = 10;
      if (change === 'window') currentState.tournaments[0].registrationStatus = 'closed';
      if (change === 'security') test.security.mockRejectedValueOnce(new preconditions.PlayerStatePreconditionError('AGE_VERIFICATION_REQUIRED'));
      await options.transactionPrecondition({ currentState });
      throw new Error('Commit should have been rejected.');
    });
    await test.handler(request, res);
    expect(res.statusCode).toBe(change === 'security' ? 403 : 409);
    expect(res.body.ok).toBe(false);
    expect(test.dependencies.schedulePublicationDrain).not.toHaveBeenCalled();
  });

  it('retries revision conflicts with the same entrant and receipt identity', async () => {
    const test = harness(), res = response();
    test.dependencies.saveState.mockRejectedValueOnce(Object.assign(new Error('Revision conflict'), { code: 'STATE_REVISION_CONFLICT' }));
    await test.handler(request, res);
    expect(res.statusCode).toBe(201);
    const calls = test.dependencies.saveState.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].tournaments[0].players[0].id).toBe(calls[1][0].tournaments[0].players[0].id);
    expect(calls[0][1].mutationId).toBe(calls[1][1].mutationId);
  });

  it('returns a concurrent registration on retry without adding a duplicate entrant', async () => {
    const test = harness(), res = response();
    const concurrent = source();
    concurrent.tournaments[0].players = [{ id: 'concurrent-entry', profileId: 'player-one', registeredAt: new Date(nowMs).toISOString() }];
    test.dependencies.loadState.mockResolvedValueOnce({ accountKey: 'club-one', revision: 1, state: test.state })
      .mockResolvedValueOnce({ accountKey: 'club-one', revision: 2, state: concurrent });
    test.dependencies.saveState.mockRejectedValueOnce(Object.assign(new Error('Revision conflict'), { code: 'STATE_REVISION_CONFLICT' }))
      .mockImplementationOnce(async (_state, options) => {
        const committed = await options.transactionPrecondition({ currentState: concurrent });
        return { accountKey: 'club-one', revision: 3, savedAt: new Date(nowMs).toISOString(), transactionResult: committed.result };
      });
    await test.handler(request, res);
    expect(res).toMatchObject({ statusCode: 200, body: { registration: { id: 'concurrent-entry' } } });
    expect(test.dependencies.saveState.mock.calls[1][0].tournaments[0].players).toHaveLength(1);
  });

  it('rejects supplied player/payment fields and unavailable venues before writing', async () => {
    const test = harness(), res = response();
    await test.handler({ ...request, body: { ...request.body, playerId: 'other-player', buyIn: 0 } }, res);
    expect(res.statusCode).toBe(400);
    expect(test.dependencies.loadState).not.toHaveBeenCalled();
    const missing = harness({ loadState: vi.fn(async () => null) }), unavailable = response();
    await missing.handler(request, unavailable);
    expect(unavailable.statusCode).toBe(404);
    expect(missing.dependencies.saveState).not.toHaveBeenCalled();
  });
});
