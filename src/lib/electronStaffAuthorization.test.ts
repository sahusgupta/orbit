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
    expect(verified).toMatchObject({ ok: true, staffId: 'manager-1', role: 'Manager', accountKey: 'club-one' });
    expect(authorization.authorize({ token: verified.token, action: 'manager-lock' })).toMatchObject({ ok: true, role: 'Manager' });
    now += 16 * 60_000;
    expect(authorization.authorize({ token: verified.token, action: 'manager-lock' })).toEqual({
      ok: false,
      error: 'Staff reauthentication is required.',
      reauthenticate: true
    });
  });

  it('keeps a valid Floor session when a privileged action is denied', async () => {
    const pinHash = await hashStaffPin('4821', 'staff-salt');
    const authorization = createStaffAuthorization({
      now: () => Date.parse('2026-08-11T12:00:00.000Z'),
      loadStateForAccess: vi.fn().mockResolvedValue({
        authoritative: true,
        accountKey: 'club-one',
        state: {
          settings: {
            staffAccounts: [{
              id: 'floor-1',
              role: 'Floor',
              active: true,
              pinSalt: 'staff-salt',
              pinHash
            }]
          }
        }
      })
    });
    const verified = await authorization.activate({
      staffId: 'floor-1',
      pin: '4821',
      access: { licenseId: 'club-one' }
    });

    expect(authorization.authorize({ token: verified.token, action: 'staff-admin' })).toEqual({
      ok: false,
      error: 'Select and verify an Owner or Manager for this action.',
      reauthenticate: false
    });
    expect(authorization.authorize({ token: verified.token, action: 'staff-sign' })).toMatchObject({
      ok: true,
      staffId: 'floor-1',
      role: 'Floor'
    });
  });

  it('fails closed without consuming PIN attempts when authoritative state is unavailable', async () => {
    const pinHash = await hashStaffPin('4821', 'staff-salt');
    const loadStateForAccess = vi.fn().mockResolvedValue({
      authoritative: false,
      state: { settings: { staffAccounts: [{ id: 'owner-1', role: 'Owner', active: true, pinSalt: 'staff-salt', pinHash }] } }
    });
    const authorization = createStaffAuthorization({
      now: () => 1_000,
      loadStateForAccess
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(authorization.activate({ staffId: 'owner-1', pin: '4821', access: { licenseId: 'club-one' } }))
        .resolves.toEqual({ ok: false, error: 'Authoritative staff verification is temporarily unavailable.' });
    }
    loadStateForAccess.mockResolvedValue({
      authoritative: true,
      accountKey: 'club-one',
      state: { settings: { staffAccounts: [{ id: 'owner-1', role: 'Owner', active: true, pinSalt: 'staff-salt', pinHash }] } }
    });
    await expect(authorization.activate({ staffId: 'owner-1', pin: '4821', access: { licenseId: 'club-one' } }))
      .resolves.toMatchObject({ ok: true, staffId: 'owner-1' });
  });

  it('locks repeated wrong PIN attempts against authoritative state', async () => {
    const pinHash = await hashStaffPin('4821', 'staff-salt');
    let now = 1_000;
    const authorization = createStaffAuthorization({
      now: () => now,
      loadStateForAccess: vi.fn().mockResolvedValue({
        authoritative: true,
        accountKey: 'club-one',
        state: { settings: { staffAccounts: [{ id: 'owner-1', role: 'Owner', active: true, pinSalt: 'staff-salt', pinHash }] } }
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
