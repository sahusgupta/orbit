import { describe, expect, it } from 'vitest';
import selfCheckInSecurity from './selfCheckInSecurity.js';

const {
  createSelfCheckInSecurity,
  normalizePlayerName,
  validateMutationId,
  validateTableId
} = selfCheckInSecurity;

const signingSecret = 'test-self-check-in-secret-that-is-long-enough';

describe('self-check-in security', () => {
  it('normalizes bounded Unicode player names and rejects invalid input', () => {
    expect(normalizePlayerName('  Jos\u00e9   O\u2019Brien  ')).toEqual({
      displayName: 'Jos\u00e9 O\u2019Brien',
      lookupKey: 'jos\u00e9 o\u2019brien'
    });
    expect(normalizePlayerName('A')).toBeNull();
    expect(normalizePlayerName('Player\u0000Name')).toBeNull();
    expect(normalizePlayerName('<script>')).toBeNull();
    expect(normalizePlayerName('x'.repeat(81))).toBeNull();
    expect(normalizePlayerName({ name: 'Player' })).toBeNull();
  });

  it('accepts only stable bounded mutation and table identifiers', () => {
    expect(validateMutationId('scan:2d60f061-2146-4a9f-a24c-171753565c52')).toBe(true);
    expect(validateMutationId('has spaces')).toBe(false);
    expect(validateMutationId('x'.repeat(181))).toBe(false);
    expect(validateTableId('table._:-17')).toBe(true);
    expect(validateTableId('../table')).toBe(false);
  });

  it('issues tenant-bound capabilities and rejects tampering, wrong secrets, and expiry', () => {
    let nowMs = Date.parse('2026-08-24T12:00:00.000Z');
    const security = createSelfCheckInSecurity({
      secret: signingSecret,
      nowMs: () => nowMs,
      randomUUID: () => 'capability-id'
    });
    const issued = security.issueClubCapability({ clubId: 'club-one', generation: 'generation-one', lifetimeMs: 60_000 });

    expect(security.verifyClubCapability(issued.token)).toMatchObject({
      ok: true,
      value: { audience: 'orbit-club-self-check-in', clubId: 'club-one', generation: 'generation-one' }
    });
    expect(security.verifyClubCapability(issued.token, { expectedGeneration: 'generation-two' }))
      .toEqual({ ok: false, code: 'revoked' });
    expect(security.verifyClubCapability(`${issued.token.slice(0, -1)}x`)).toEqual({ ok: false, code: 'invalid' });
    expect(createSelfCheckInSecurity({ secret: `${signingSecret}-other`, nowMs: () => nowMs })
      .verifyClubCapability(issued.token)).toEqual({ ok: false, code: 'invalid' });

    nowMs += 60_001;
    expect(security.verifyClubCapability(issued.token)).toEqual({ ok: false, code: 'expired' });
  });

  it('issues short-lived profile sessions that cannot be used as club capabilities', () => {
    const nowMs = Date.parse('2026-08-24T12:00:00.000Z');
    const security = createSelfCheckInSecurity({
      secret: signingSecret,
      nowMs: () => nowMs,
      randomUUID: () => 'scan-session-id'
    });
    const issued = security.issueScanSession({ clubId: 'club-one', profileId: 'profile-one', generation: 'generation-one' });

    expect(security.verifyScanSession(issued.token)).toMatchObject({
      ok: true,
      value: {
        audience: 'orbit-player-self-check-in',
        clubId: 'club-one',
        profileId: 'profile-one',
        tokenId: 'scan-session-id',
        generation: 'generation-one'
      }
    });
    expect(security.verifyScanSession(issued.token, { expectedGeneration: 'generation-two' }))
      .toEqual({ ok: false, code: 'revoked' });
    expect(security.verifyClubCapability(issued.token)).toEqual({ ok: false, code: 'invalid' });
  });

  it('fails closed when signing is not independently configured', () => {
    expect(() => createSelfCheckInSecurity({ secret: 'too-short' }))
      .toThrow(/at least 32 characters/);
  });
});
