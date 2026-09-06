import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import licenseService from './licenseService.js';

const {
  canonicalPayload,
  hashAuthorizationCode,
  inspectPilotLicenses,
  isLicenseActive,
  normalizeExpiration,
  verifySignedPilotLicense
} = licenseService;

describe('pilot license service', () => {
  it('stores a one-way authorization-code identifier', () => {
    const code = 'TT-PILOT-1234567890ABCDEF12345678';
    const hash = hashAuthorizationCode(code);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(code);
    expect(hashAuthorizationCode(code)).toBe(hash);
  });

  it('normalizes date-only expirations through the end of that UTC day', () => {
    expect(normalizeExpiration('2027-01-31')).toBe('2027-01-31T23:59:59.999Z');
  });

  it('requires both an unexpired date and a non-revoked status', () => {
    const now = Date.parse('2027-01-01T00:00:00.000Z');
    expect(isLicenseActive({ status: 'active', expiresAt: '2027-01-02T00:00:00.000Z' }, now)).toBe(true);
    expect(isLicenseActive({ status: 'active', expiresAt: '2026-12-31T00:00:00.000Z' }, now)).toBe(false);
    expect(isLicenseActive({ status: 'revoked', expiresAt: '2028-01-01T00:00:00.000Z' }, now)).toBe(false);
  });

  it('inspects a bounded venue page in one Firestore getAll operation', async () => {
    const codes = ['license-club-one', 'license-club-two'];
    const records = new Map([[hashAuthorizationCode(codes[0]), {
      accountKey: 'club-one', status: 'active', expiresAt: '2099-01-01T00:00:00.000Z'
    }]]);
    const getAll = vi.fn(async (...references) => references.map((reference) => ({
      id: reference.id,
      exists: records.has(reference.id),
      data: () => records.get(reference.id)
    })));
    const collection = {
      doc: (id) => ({ id }),
      firestore: { getAll }
    };
    await expect(inspectPilotLicenses(codes, { collection })).resolves.toMatchObject([
      { managed: true, active: true, license: { accountKey: 'club-one' } },
      { managed: false, active: false, license: null }
    ]);
    expect(getAll).toHaveBeenCalledOnce();
  });

  it('accepts an authentic signed license and rejects a forged payload', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    const payload = {
      authorizationCode: 'TT-PILOT-1234567890ABCDEF12345678',
      expiresAt: '2099-01-01',
      issuedTo: 'Test Club',
      issuedAt: '2026-08-11T00:00:00.000Z',
      licenseId: 'lic_test'
    };
    const signature = crypto.sign(
      'sha256',
      Buffer.from(canonicalPayload(payload)),
      { key: privateKey, dsaEncoding: 'ieee-p1363' }
    ).toString('base64');

    expect(verifySignedPilotLicense({ algorithm: 'ECDSA-P256-SHA256', payload, signature }, {
      publicKeyPem,
      nowMs: Date.parse('2026-08-11T00:00:00.000Z')
    })).toMatchObject({
      ok: true,
      access: { authorizationCode: payload.authorizationCode, licenseId: 'lic_test' }
    });
    expect(verifySignedPilotLicense({ payload: { ...payload, licenseId: 'forged' }, signature }, {
      publicKeyPem,
      nowMs: Date.parse('2026-08-11T00:00:00.000Z')
    })).toEqual({ ok: false, error: 'The pilot license signature is invalid.' });
  });
});
