import { describe, expect, it } from 'vitest';
import licenseService from './licenseService.js';

const {
  hashAuthorizationCode,
  isLicenseActive,
  normalizeExpiration
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
});
