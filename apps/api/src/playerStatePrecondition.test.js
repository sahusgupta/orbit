import { describe, expect, it, vi } from 'vitest';
import preconditions from './playerStatePrecondition.js';
import licenseService from './licenseService.js';
import deletionGuard from './playerDeletionGuard.js';

const { createCurrentPlayerStatePrecondition } = preconditions;
const { hashAuthorizationCode } = licenseService;
const { playerDeletionMarkerPath } = deletionGuard;
const nowMs = Date.parse('2026-09-04T18:00:00.000Z');

function currentState(minimumPlayerAge = 21) {
  return {
    settings: {
      clubAccount: { email: 'club-one', minimumPlayerAge },
      pilotAccess: {
        authorized: true,
        licenseId: 'club-one',
        authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    }
  };
}

function documents(overrides = {}) {
  return new Map([
    ['players/player-one/private/identity', { status: 'verified', ageVerified: true, ageLevel: 21 }],
    [`pilotLicenses/${hashAuthorizationCode('TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA')}`, {
      accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z'
    }],
    ...Object.entries(overrides)
  ]);
}

function context(records, state = currentState()) {
  return {
    transaction: { getDocument: vi.fn(async (path) => records.get(path) || null) },
    accountKey: 'club-one',
    currentState: state,
    nextState: state,
    commitNowMs: nowMs
  };
}

describe('current Player state transaction precondition', () => {
  it('reads only exact immutable marker, identity, and hashed license documents for a valid player', async () => {
    const records = documents();
    const transactionContext = context(records);
    const precondition = createCurrentPlayerStatePrecondition({ playerId: 'player-one', nowMs: () => nowMs });

    await expect(precondition(transactionContext)).resolves.toBeUndefined();

    expect(transactionContext.transaction.getDocument.mock.calls.map(([path]) => path)).toEqual([
      playerDeletionMarkerPath('player-one'),
      'players/player-one/private/identity',
      `pilotLicenses/${hashAuthorizationCode('TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA')}`
    ]);
  });

  it('fails closed for a deletion marker before reading or writing identity-derived state', async () => {
    const records = documents({ [playerDeletionMarkerPath('player-one')]: { status: 'blocked' } });
    const transactionContext = context(records);

    await expect(createCurrentPlayerStatePrecondition({ playerId: 'player-one', nowMs: () => nowMs })(transactionContext))
      .rejects.toMatchObject({ name: 'PlayerStatePreconditionError', code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' });
    expect(transactionContext.transaction.getDocument).toHaveBeenCalledOnce();
  });

  it('fails closed for missing, revoked, under-age, or malformed current identity', async () => {
    for (const identity of [
      null,
      { status: 'redacted', ageVerified: false, ageLevel: 21 },
      { status: 'verified', ageVerified: true, ageLevel: 18 },
      { status: 'verified', ageVerified: true, ageLevel: 999 }
    ]) {
      const records = documents({ 'players/player-one/private/identity': identity });
      await expect(createCurrentPlayerStatePrecondition({ playerId: 'player-one', nowMs: () => nowMs })(context(records)))
        .rejects.toMatchObject({ code: 'AGE_VERIFICATION_REQUIRED' });
    }
  });

  it('accepts exact 18/18 and 21/21 identity bands', async () => {
    for (const age of [18, 21]) {
      const records = documents({
        'players/player-one/private/identity': { status: 'verified', ageVerified: true, ageLevel: age }
      });
      await expect(createCurrentPlayerStatePrecondition({ playerId: 'player-one', nowMs: () => nowMs })(
        context(records, currentState(age))
      )).resolves.toBeUndefined();
    }
  });

  it('fails closed when the exact central license is missing, revoked, expired, or cross-tenant', async () => {
    const path = `pilotLicenses/${hashAuthorizationCode('TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA')}`;
    for (const license of [
      null,
      { accountKey: 'club-one', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' },
      { accountKey: 'club-one', status: 'active', expiresAt: '2026-09-01T00:00:00.000Z' },
      { accountKey: 'club-two', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
    ]) {
      const records = documents({ [path]: license });
      await expect(createCurrentPlayerStatePrecondition({ playerId: 'player-one', nowMs: () => nowMs })(context(records)))
        .rejects.toMatchObject({ code: 'PLAYER_VENUE_LICENSE_INACTIVE' });
    }
  });
});
