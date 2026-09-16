import { describe, expect, it } from 'vitest';
import { normalizeState, seedState } from '../../domain/state';
import type { AccountLogin, AppState, PilotAccess } from '../../domain/types';
import { resolveOwnerRecoveryState, type OwnerRecoveryResult } from './ownerRecoveryState';

const access: PilotAccess = {
  authorized: true,
  authorizationCode: 'fixture-signed-access',
  licenseId: 'lic_fixture_club',
  activatedAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z'
};
const login: AccountLogin = {
  username: 'owner@example.com',
  passwordSalt: 'fixture-new-salt',
  passwordHash: 'fixture-new-hash',
  createdAt: '2026-07-01T00:00:00.000Z',
  lastLoginAt: '2026-09-16T00:00:00.000Z'
};
const currentState = (): AppState => normalizeState({
  ...seedState,
  tournaments: [],
  settings: {
    ...seedState.settings,
    pilotAccess: access,
    accountLogin: { ...login, passwordSalt: 'fixture-old-salt', passwordHash: 'fixture-old-hash' }
  }
});
const recoveredState = (): AppState => normalizeState({
  ...seedState,
  profiles: [{
    id: 'server-profile', name: 'Fixture Player', phone: '', birthday: '',
    membershipStartDate: '2026-07-01', membershipExpirationDate: '2027-07-01',
    totalTimePlayedHours: 45, lastSessionTimePlayedHours: 3,
    commonlyPlaysWithProfileIds: [], preferredGameId: 'fixture-game', preferredGameIds: ['fixture-game'],
    gamePlayCounts: { 'fixture-game': 8 }, mostPlayedGameId: 'fixture-game', preferredStakes: '',
    typicalBuyInMin: 100, typicalBuyInMax: 300, willingnessToMove: false,
    typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: 'Server history'
  }],
  games: [{ id: 'fixture-game', name: 'Fixture Game', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 2, minTotalForViable: 4 }],
  revenueTransactions: [{ id: 'server-payment', type: 'membership', amountCents: 3000, occurredAt: '2026-09-01T00:00:00.000Z', paymentStatus: 'paid', source: 'manual' }],
  history: [{ id: 'server-night', date: '2026-09-01', occupiedSeatHours: 45, gamesStarted: 3, averageSessionDurationHours: 3, averageActiveTables: 2, waitlistConversionRate: 0.8, hadTwoPlusTables: true }],
  settings: {
    ...seedState.settings,
    pilotAccess: { ...access, authorizationCode: '', expiresAt: '2099-12-31T00:00:00.000Z' },
    accountLogin: login,
    defaultHourlyFee: 12,
    activeStaffId: 'stale-staff-selection'
  }
});
const recoveryResult = (): OwnerRecoveryResult => ({
  ok: true,
  accountKey: 'lic_fixture_club',
  accountLogin: login,
  revision: 9,
  state: recoveredState()
});

describe('owner recovery authoritative state adoption', () => {
  it('loads server club data instead of merging recovered credentials into an empty local snapshot', () => {
    const current = currentState();
    const result = recoveryResult();
    const beforeCurrent = structuredClone(current);
    const beforeResult = structuredClone(result);

    const next = resolveOwnerRecoveryState(current, access, result);

    expect(next.profiles).toEqual(result.state?.profiles);
    expect(next.games).toEqual(result.state?.games);
    expect(next.history).toEqual(result.state?.history);
    expect(next.revenueTransactions).toEqual(result.state?.revenueTransactions);
    expect(next.tournaments).toEqual(result.state?.tournaments);
    expect(next.settings.defaultHourlyFee).toBe(12);
    expect(next.settings.accountLogin).toEqual(login);
    expect(next.settings.pilotAccess?.authorizationCode).toBe(access.authorizationCode);
    expect(next.settings.pilotAccess?.expiresAt).toBe('2099-12-31T00:00:00.000Z');
    expect(next.settings.activeStaffId).toBeUndefined();
    expect(current).toEqual(beforeCurrent);
    expect(result).toEqual(beforeResult);
  });

  it('rejects a login-only response instead of manufacturing an empty authoritative state', () => {
    const result = recoveryResult();
    delete result.state;
    expect(() => resolveOwnerRecoveryState(currentState(), access, result)).toThrow();
  });

  it.each(['games', 'sessions', 'playerSessions'] as const)('rejects a response missing the required %s collection', (collection) => {
    const result = recoveryResult();
    if (!result.state) throw new Error('Expected fixture state');
    delete result.state[collection];
    expect(() => resolveOwnerRecoveryState(currentState(), access, result)).toThrow('complete club data');
  });

  it('retains legacy normalization for optional collections', () => {
    const result = recoveryResult();
    if (!result.state) throw new Error('Expected fixture state');
    delete result.state.profiles;
    delete result.state.revenueTransactions;
    const next = resolveOwnerRecoveryState(currentState(), access, result);
    expect(next.profiles).toEqual([]);
    expect(next.revenueTransactions).toEqual([]);
    expect(next.history).toEqual(result.state.history);
  });

  it('rejects an account switch while the recovery request is outstanding', () => {
    const current = currentState();
    current.settings.pilotAccess = { ...access, licenseId: 'lic_other_club' };
    expect(() => resolveOwnerRecoveryState(current, access, recoveryResult())).toThrow('active account');
  });

  it('rejects a mismatched response account key', () => {
    expect(() => resolveOwnerRecoveryState(currentState(), access, {
      ...recoveryResult(), accountKey: 'lic_other_club'
    })).toThrow('active account');
  });

  it('rejects club data for another license even when the response key matches', () => {
    const authoritative = recoveredState();
    authoritative.settings.pilotAccess = { ...access, licenseId: 'lic_other_club' };
    expect(() => resolveOwnerRecoveryState(currentState(), access, {
      ...recoveryResult(), state: authoritative
    })).toThrow('active account');
  });

  it.each(['username', 'passwordSalt', 'passwordHash'] as const)('rejects server data whose %s disagrees with recovered credentials', (field) => {
    const authoritative = recoveredState();
    authoritative.settings.accountLogin = { ...login, [field]: 'mismatched-value' };
    expect(() => resolveOwnerRecoveryState(currentState(), access, {
      ...recoveryResult(), state: authoritative
    })).toThrow('recovered login');
  });

  it('rejects a recovery result for a different login on the same license', () => {
    const differentLogin = { ...login, username: 'different@example.com' };
    const authoritative = recoveredState();
    authoritative.settings.accountLogin = differentLogin;
    expect(() => resolveOwnerRecoveryState(currentState(), access, {
      ...recoveryResult(), accountLogin: differentLogin, state: authoritative
    })).toThrow('recovered login');
  });

  it('preserves the server failure without adopting data', () => {
    expect(() => resolveOwnerRecoveryState(currentState(), access, {
      ...recoveryResult(), ok: false, error: 'Recovery override expired.'
    })).toThrow('Recovery override expired.');
  });
});
