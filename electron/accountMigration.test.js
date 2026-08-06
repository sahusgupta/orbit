import { describe, expect, it } from 'vitest';
import migration from './accountMigration.cjs';

const { findReplacementAccountRecord, migrateStateToPilotAccess } = migration;

function accountRecord(accountKey, savedAt, issuedTo, clubName = issuedTo) {
  return {
    accountKey,
    schemaVersion: 3,
    savedAt,
    state: {
      games: [{ id: 'nlh', name: '1/2 NLH' }],
      profiles: [{ id: 'player-1', name: 'Existing Player' }],
      sessions: [],
      playerSessions: [],
      settings: {
        pilotAccess: issuedTo ? { authorizationCode: 'existing-code', issuedTo } : undefined,
        clubAccount: { clubName },
        accountLogin: { username: 'manager@example.test', passwordHash: 'existing-hash' }
      }
    }
  };
}

describe('replacement pilot key account migration', () => {
  it('selects the newest prior account for the same signed venue identity', () => {
    const records = [
      accountRecord('old-lodge', '2026-07-01T00:00:00.000Z', 'Example Lodge'),
      accountRecord('newer-lodge', '2026-08-01T00:00:00.000Z', 'example lodge'),
      accountRecord('other-club', '2026-08-02T00:00:00.000Z', 'Another Club'),
      accountRecord('replacement-key', '2026-08-03T00:00:00.000Z', 'Example Lodge')
    ];

    const result = findReplacementAccountRecord(
      records,
      { issuedTo: 'Example Lodge' },
      'replacement-key'
    );

    expect(result?.accountKey).toBe('newer-lodge');
  });

  it('can match the existing club name when an older state has no issued-to value', () => {
    const result = findReplacementAccountRecord(
      [accountRecord('legacy-lodge', '2026-07-01T00:00:00.000Z', '', 'Example Lodge')],
      { issuedTo: 'Example Lodge' },
      'replacement-key'
    );

    expect(result?.accountKey).toBe('legacy-lodge');
  });

  it('does not migrate without an exact venue identity match', () => {
    const result = findReplacementAccountRecord(
      [accountRecord('other-club', '2026-08-01T00:00:00.000Z', 'Different Lodge')],
      { issuedTo: 'Example Lodge' },
      'replacement-key'
    );

    expect(result).toBeNull();
  });

  it('preserves existing club data and replaces only pilot access', () => {
    const source = accountRecord('old-lodge', '2026-08-01T00:00:00.000Z', 'Example Lodge').state;
    const replacementAccess = {
      authorizationCode: 'replacement-code',
      issuedTo: 'Example Lodge',
      licenseId: 'replacement-license',
      expiresAt: '2026-09-04'
    };

    const migrated = migrateStateToPilotAccess(source, replacementAccess);

    expect(migrated.games).toEqual(source.games);
    expect(migrated.profiles).toEqual(source.profiles);
    expect(migrated.settings.accountLogin).toEqual(source.settings.accountLogin);
    expect(migrated.settings.pilotAccess).toEqual(replacementAccess);
    expect(migrated).not.toBe(source);
    expect(migrated.settings).not.toBe(source.settings);
  });
});
