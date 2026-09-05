import { describe, expect, it, vi } from 'vitest';
import eligibility from './playerVenueEligibility.js';

const { getActivePlayerVenueStateLicense, inspectPlayerVenueRecord, inspectPlayerVenueRecords } = eligibility;
const now = Date.parse('2026-09-04T18:00:00.000Z');

function record(accountKey = 'club-one', overrides = {}) {
  return {
    accountKey,
    state: {
      settings: {
        pilotAccess: {
          authorized: true,
          licenseId: accountKey,
          authorizationCode: `TT-PILOT-${accountKey}`,
          expiresAt: '2099-01-01T00:00:00.000Z',
          ...overrides
        }
      }
    }
  };
}

function activeInspection(accountKey) {
  return {
    managed: true,
    active: true,
    license: { accountKey, status: 'active', expiresAt: '2099-01-01T00:00:00.000Z' }
  };
}

describe('Player venue license eligibility', () => {
  it('fails local eligibility closed for missing, expired, unauthorized, and cross-account state', () => {
    expect(getActivePlayerVenueStateLicense(record().state, 'club-one', now)).toMatchObject({ accountKey: 'club-one' });
    expect(getActivePlayerVenueStateLicense(record('club-one', { authorized: false }).state, 'club-one', now)).toBeNull();
    expect(getActivePlayerVenueStateLicense(record('club-one', { expiresAt: '2026-09-01T00:00:00.000Z' }).state, 'club-one', now)).toBeNull();
    expect(getActivePlayerVenueStateLicense(record('club-one', { licenseId: 'club-two' }).state, 'club-one', now)).toBeNull();
    expect(getActivePlayerVenueStateLicense(record('club-one', { authorizationCode: '' }).state, 'club-one', now)).toBeNull();
  });

  it('batches active checks once and omits revoked or mismatched venues', async () => {
    const inspectPilotLicenses = vi.fn(async () => [
      activeInspection('club-one'),
      { managed: true, active: false, license: { accountKey: 'club-two', status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z' } },
      activeInspection('wrong-account')
    ]);
    const result = await inspectPlayerVenueRecords([
      record('club-one'), record('club-two'), record('club-three')
    ], { nowMs: () => now, inspectPilotLicenses });
    expect(result).toMatchObject({ ok: true });
    expect(result.eligibleRecords.map((item) => item.accountKey)).toEqual(['club-one']);
    expect(inspectPilotLicenses).toHaveBeenCalledOnce();
  });

  it('distinguishes inactive state from an unavailable authoritative license lookup', async () => {
    await expect(inspectPlayerVenueRecord(record('club-one'), {
      nowMs: () => now,
      inspectPilotLicenses: async () => [{ managed: true, active: false, license: { accountKey: 'club-one', status: 'revoked' } }]
    })).resolves.toMatchObject({ ok: false, code: 'inactive' });
    await expect(inspectPlayerVenueRecord(record('club-one'), {
      nowMs: () => now,
      inspectPilotLicenses: async () => { throw new Error('lookup unavailable'); }
    })).resolves.toMatchObject({ ok: false, code: 'unavailable' });
  });
});
