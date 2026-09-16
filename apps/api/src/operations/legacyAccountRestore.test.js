import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import restoration from './legacyAccountRestore.js';

const { buildLegacyAccountRestore } = restoration;

function fixture() {
  const state = (licenseId) => ({
    games: [{ id: 'shared-game', name: 'Holdem', limits: { small: 1, big: 2 } }],
    sessions: [], playerSessions: [], profiles: [], tournaments: [],
    scriptTemplates: ['Welcome'],
    settings: {
      pilotAccess: { licenseId, authorizationCode: `fixture-access-${licenseId}` },
      accountLogin: { username: 'owner@example.test', passwordHash: `fixture-${licenseId}`, passwordSalt: 'fixture-salt' },
      clubAccount: { clubName: 'Example Club', email: 'owner@example.test' },
      collectionProfiles: [{ gameId: 'shared-game', collectionMode: 'Time', hourlyFee: 10, estimatedDropPerSeatHour: 0 }],
      membershipPlans: [{ id: 'day', name: 'Day', priceLabel: '$10', durationDays: 1, active: true }],
      staffAccounts: []
    }
  });
  return {
    sourceState: state('legacy-fixture'),
    targetState: state('current-fixture'),
    expectedSourceAccountKey: 'legacy-fixture',
    expectedTargetAccountKey: 'current-fixture',
    expectedUsername: 'owner@example.test'
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('reviewed legacy account restore planner', () => {
  it('restores original activity and settings while keeping current unique records and recovered access', () => {
    const input = fixture();
    Object.assign(input.sourceState, {
      profiles: [{ id: 'original-player', name: 'Original Player' }],
      sessions: [{ id: 'original-session', gameId: 'shared-game' }],
      scriptTemplates: ['Welcome', 'Original announcement']
    });
    Object.assign(input.targetState, {
      games: [{ limits: { big: 2, small: 1 }, name: 'Holdem', id: 'shared-game' }, { id: 'new-game', name: 'Omaha' }],
      profiles: [{ id: 'new-player', name: 'New Player' }],
      scriptTemplates: ['Welcome', 'New announcement'],
      newSetting: 'retain me'
    });
    Object.assign(input.sourceState.settings, { defaultHourlyFee: 10, collectionProfiles: [{ gameId: 'shared-game', collectionMode: 'Time', hourlyFee: 10, estimatedDropPerSeatHour: 0 }] });
    Object.assign(input.targetState.settings, { defaultHourlyFee: 20, collectionProfiles: [{ gameId: 'new-game', collectionMode: 'Drop', hourlyFee: 0, estimatedDropPerSeatHour: 5 }], targetOnly: true });
    Object.assign(input.sourceState.settings.clubAccount, { phone: 'fixture-phone', email: 'old-contact@example.test' });
    Object.assign(input.targetState.settings.clubAccount, { minimumPlayerAge: 21 });
    const before = structuredClone(input);

    const result = buildLegacyAccountRestore(input);

    expect(result.state.games).toHaveLength(2);
    expect(result.state.profiles).toEqual([...input.sourceState.profiles, ...input.targetState.profiles]);
    expect(result.state.sessions).toEqual(input.sourceState.sessions);
    expect(result.state.scriptTemplates).toEqual(['Welcome', 'Original announcement', 'New announcement']);
    expect(result.state.settings).toMatchObject({ defaultHourlyFee: 10, targetOnly: true });
    expect(result.state.settings.collectionProfiles).toEqual([...input.sourceState.settings.collectionProfiles, ...input.targetState.settings.collectionProfiles]);
    expect(result.state.settings.clubAccount).toMatchObject({ phone: 'fixture-phone', email: 'owner@example.test', minimumPlayerAge: 21 });
    expect(result.state.settings.accountLogin).toEqual(input.targetState.settings.accountLogin);
    expect(result.state.settings.pilotAccess).toEqual(input.targetState.settings.pilotAccess);
    expect(result.state.newSetting).toBe('retain me');
    expect(input).toEqual(before);
    expect(result.state.settings.accountLogin).not.toBe(input.targetState.settings.accountLogin);
    expect(result.summary.collections.profiles).toEqual({ source: 1, target: 1, merged: 2, resolvedConflicts: 0, restored: 2 });
    expect(JSON.stringify(result.summary)).not.toMatch(/owner@|fixture-current|Original Player|fixture-access/);
  });

  it('matches login case and venue whitespace without changing the recovered login', () => {
    const input = fixture();
    input.sourceState.settings.accountLogin.username = ' OWNER@EXAMPLE.TEST ';
    input.sourceState.settings.clubAccount.clubName = ' example   club ';
    expect(buildLegacyAccountRestore(input).state.settings.accountLogin).toEqual(input.targetState.settings.accountLogin);
  });

  it.each(['source', 'target'])('rejects an unreviewed %s account key', (side) => {
    const input = fixture();
    input[`${side}State`].settings.pilotAccess.licenseId = 'another-account';
    expect(() => buildLegacyAccountRestore(input)).toThrow('account identity');
  });

  it.each(['source', 'target'])('rejects a mismatched %s management login even if venue matches', (side) => {
    const input = fixture();
    input[`${side}State`].settings.accountLogin.username = 'another-owner@example.test';
    expect(() => buildLegacyAccountRestore(input)).toThrow('management login');
  });

  it('rejects a mismatched venue even if management login matches', () => {
    const input = fixture();
    input.sourceState.settings.clubAccount.clubName = 'Another Club';
    expect(() => buildLegacyAccountRestore(input)).toThrow('venue identities');
  });

  it('fails closed for conflicting shared IDs until the named collection is explicitly reviewed', () => {
    const input = fixture();
    input.sourceState.tournaments = [{ id: 'fixture-tournament', status: 'Paused', players: [] }];
    input.targetState.tournaments = [{ id: 'fixture-tournament', status: 'Draft', players: [] }];
    expect(() => buildLegacyAccountRestore(input)).toThrow('explicit conflict review: tournaments');
    /** @type {Array<'source' | 'target'>} */
    const preferences = ['source', 'target'];
    for (const preference of preferences) {
      const result = buildLegacyAccountRestore({ ...input, conflictPreferences: { tournaments: preference } });
      expect(result.state.tournaments).toEqual(input[`${preference}State`].tournaments);
      expect(result.summary.collections.tournaments.resolvedConflicts).toBe(1);
    }
    expect(() => buildLegacyAccountRestore({ ...input, conflictPreferences: { games: 'source' } })).toThrow('explicit conflict review');
  });

  it('uses the domain collection profile gameId and requires review before restoring changed fees', () => {
    const input = fixture();
    input.targetState.settings.collectionProfiles[0].hourlyFee = 20;
    expect(() => buildLegacyAccountRestore(input)).toThrow('explicit conflict review: settings.collectionProfiles');
    const result = buildLegacyAccountRestore({ ...input, conflictPreferences: { 'settings.collectionProfiles': 'source' } });
    expect(result.state.settings.collectionProfiles).toEqual(input.sourceState.settings.collectionProfiles);
    expect(result.summary.collections['settings.collectionProfiles']).toMatchObject({ merged: 1, resolvedConflicts: 1 });
  });

  it('merges staff and membership plans by id without replacing current unique entries', () => {
    const input = fixture();
    Object.assign(input.sourceState.settings, {
      staffAccounts: [{ id: 'original-staff', name: 'Original', role: 'Owner', pinSalt: 'fixture', pinHash: 'fixture', active: true, createdAt: '2026-01-01' }]
    });
    Object.assign(input.targetState.settings, {
      staffAccounts: [{ id: 'new-staff', name: 'New', role: 'Floor', pinSalt: 'fixture', pinHash: 'fixture', active: true, createdAt: '2026-02-01' }],
      membershipPlans: [...input.targetState.settings.membershipPlans, { id: 'month', name: 'Month', priceLabel: '$50', durationDays: 30, active: true }]
    });
    const result = buildLegacyAccountRestore(input).state;
    expect(result.settings.staffAccounts).toEqual([...input.sourceState.settings.staffAccounts, ...input.targetState.settings.staffAccounts]);
    expect(result.settings.membershipPlans).toEqual(input.targetState.settings.membershipPlans);
  });

  it('keeps usage events newest first while retaining undated legacy events', () => {
    const input = fixture();
    const event = (id, timestamp) => ({ id, timestamp, feature: 'floor', action: 'view', route: 'floor', accountKey: 'fixture-club' });
    const original = event('original', '2026-07-20T12:00:00.000Z');
    const undated = event('undated', 'invalid-legacy-date');
    const recent = event('recent', '2026-09-16T12:00:00.000Z');
    const middle = event('middle', '2026-08-20T12:00:00.000Z');
    Object.assign(input.sourceState, { usageEvents: [original, undated] });
    Object.assign(input.targetState, { usageEvents: [recent, middle] });
    expect(buildLegacyAccountRestore(input).state.usageEvents).toEqual([recent, middle, original, undated]);
    expect(input.sourceState).toHaveProperty('usageEvents', [original, undated]);
  });

  it('does not allow conflict preferences to hide malformed or duplicate records', () => {
    const input = fixture();
    input.sourceState.games.push({ id: 'shared-game', name: 'Conflicting duplicate', limits: { small: 1, big: 2 } });
    expect(() => buildLegacyAccountRestore({ ...input, conflictPreferences: { games: 'source' } })).toThrow('conflicting duplicate identities');
    Object.assign(input.sourceState, { games: [{}] });
    expect(() => buildLegacyAccountRestore(input)).toThrow('without a stable identity');
    Object.assign(input.sourceState, { games: null });
    expect(() => buildLegacyAccountRestore(input)).toThrow('missing games');
  });

  it('rejects unknown conflict preference names', () => {
    expect(() => buildLegacyAccountRestore({ ...fixture(), conflictPreferences: { typo: 'source' } })).toThrow('unknown collection');
  });

  it('preserves only current server-issued state and does not revive source credentials', () => {
    const input = fixture();
    Object.assign(input.sourceState, {
      selfCheckIn: { secret: 'old-fixture-secret' }, membershipQrTokens: [{ id: 'old-token' }],
      tournamentInterests: [{ id: 'old-interest' }]
    });
    Object.assign(input.targetState, { tournamentInterests: [{ id: 'current-interest' }], membershipQrTokens: [] });
    const result = buildLegacyAccountRestore(input).state;
    expect(result).not.toHaveProperty('selfCheckIn');
    expect(result.membershipQrTokens).toEqual([]);
    expect(result.tournamentInterests).toEqual([{ id: 'current-interest' }]);
    Object.assign(input.targetState, { selfCheckIn: { secret: 'current-fixture-secret' } });
    expect(buildLegacyAccountRestore(input).state.selfCheckIn).toEqual({ secret: 'current-fixture-secret' });
  });

  it('honors both accounts privacy tombstones and prevents restored deleted profiles and interests', () => {
    const input = fixture();
    const secret = 'isolated-test-only-pseudonym-secret-for-restoration';
    vi.stubEnv('ORBIT_DELETION_PSEUDONYM_SECRET', secret);
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify({ financialRecords: 'anonymize', auditRecords: 'anonymize', providerRecords: 'retain' }));
    const pseudonym = (id) => `deleted_${createHmac('sha256', secret).update(id).digest('hex').slice(0, 24)}`;
    Object.assign(input.sourceState, {
      profiles: [{ id: 'deleted-one', name: 'Removed One' }, { id: 'deleted-two', name: 'Removed Two' }, { id: 'retained-player', name: 'Retained' }],
      interests: [{ id: 'old-interest', profileId: 'deleted-one' }],
      playerPrivacyTombstones: [pseudonym('deleted-two')]
    });
    Object.assign(input.targetState, { playerPrivacyTombstones: [pseudonym('deleted-one')] });
    const before = structuredClone(input);
    const result = buildLegacyAccountRestore(input);
    expect(result.state.profiles).toEqual([{ id: 'retained-player', name: 'Retained' }]);
    expect(result.state.interests).toEqual([]);
    expect(result.state.playerPrivacyTombstones).toEqual([pseudonym('deleted-two'), pseudonym('deleted-one')]);
    expect(result.summary.collections.profiles).toMatchObject({ merged: 3, restored: 1 });
    expect(JSON.stringify(result.state)).not.toMatch(/Removed One|Removed Two/);
    expect(input).toEqual(before);
  });

  it('fails closed when privacy enforcement policy is unavailable', () => {
    const input = fixture();
    Object.assign(input.targetState, { playerPrivacyTombstones: ['deleted_fixture'] });
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', '');
    expect(() => buildLegacyAccountRestore(input)).toThrow('deletion policy');
  });
});
