import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { hashStaffPin } from '../domain/staffAuth';

const require = createRequire(import.meta.url);
const { createStaffAuthorization } = require('../../electron/staffAuthorization.cjs');

describe('trusted Electron staff authorization', () => {
  it('requires an authoritative state PIN and role-scopes short-lived actions', async () => {
    const pinHash = await hashStaffPin('4821', 'staff-salt');
    let now = Date.parse('2026-08-11T12:00:00.000Z');
    const loadStateForAccess = vi.fn().mockResolvedValue({
      authoritative: true,
      accountKey: 'club-one',
      state: { settings: { staffAccounts: [{ id: 'manager-1', role: 'Manager', active: true, pinSalt: 'staff-salt', pinHash }] } }
    });
    const authorization = createStaffAuthorization({ loadStateForAccess, now: () => now });

    await expect(authorization.activate({ staffId: 'manager-1', pin: '0000', access: { licenseId: 'club-one' } }))
      .resolves.toEqual({ ok: false, error: 'Staff verification failed.' });
    const verified = await authorization.activate({ staffId: 'manager-1', pin: '4821', access: { licenseId: 'club-one' } });
    expect(verified).toMatchObject({ ok: true, staffId: 'manager-1', role: 'Manager' });
    expect(authorization.authorize({ token: verified.token, action: 'manager-lock' })).toMatchObject({ ok: true, role: 'Manager' });
    now += 16 * 60_000;
    expect(authorization.authorize({ token: verified.token, action: 'manager-lock' })).toEqual({ ok: false, error: 'Staff reauthentication is required.' });
  });

  it('fails closed for an offline cache and locks repeated failures', async () => {
    let now = 1_000;
    const authorization = createStaffAuthorization({
      now: () => now,
      loadStateForAccess: vi.fn().mockResolvedValue({
        authoritative: false,
        state: { settings: { staffAccounts: [{ id: 'owner-1', role: 'Owner', active: true, pinSalt: 'salt', pinHash: 'hash' }] } }
      })
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(authorization.activate({ staffId: 'owner-1', pin: '1111', access: { licenseId: 'club-one' } }))
        .resolves.toMatchObject({ ok: false });
    }
    await expect(authorization.activate({ staffId: 'owner-1', pin: '1111', access: { licenseId: 'club-one' } }))
      .resolves.toEqual({ ok: false, error: 'Staff verification is temporarily locked.' });
    now += 60_000;
    await expect(authorization.activate({ staffId: 'owner-1', pin: '1111', access: { licenseId: 'club-one' } }))
      .resolves.toEqual({ ok: false, error: 'Staff verification is temporarily locked.' });
  });
});
