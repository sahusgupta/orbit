import { describe, expect, it, vi } from 'vitest';
import {
  activateStaffSelection,
  hasActiveStaffAdministrator,
  isStaffAdministratorRole,
  isValidStaffPin,
  staffPinInputPattern
} from './staffSelection';

describe('staff selection orchestration', () => {
  it('recognizes only active Owner and Manager accounts as staff administrators', () => {
    expect(isStaffAdministratorRole('Owner')).toBe(true);
    expect(isStaffAdministratorRole('Manager')).toBe(true);
    expect(isStaffAdministratorRole('Floor')).toBe(false);
    expect(hasActiveStaffAdministrator([
      {
        id: 'floor-one',
        name: 'Floor One',
        role: 'Floor',
        pinSalt: 'floor-salt',
        pinHash: 'floor-hash',
        active: true,
        createdAt: '2026-08-26T12:00:00.000Z'
      },
      {
        id: 'manager-inactive',
        name: 'Inactive Manager',
        role: 'Manager',
        pinSalt: 'manager-salt',
        pinHash: 'manager-hash',
        active: false,
        createdAt: '2026-08-26T12:00:00.000Z'
      }
    ])).toBe(false);
  });

  it('requests the PIN immediately but waits for the pending authoritative save before verifying it', async () => {
    let finishSave: (() => void) | undefined;
    const pendingSave = new Promise<{ ok: true }>((resolve) => {
      finishSave = () => resolve({ ok: true });
    });
    const requestPin = vi.fn(async () => '4821');
    const verifyStaffPin = vi.fn(async () => ({
      ok: true,
      token: 'staff-token',
      staffId: 'manager-one',
      role: 'Manager' as const,
      accountKey: 'manager-account',
      expiresAt: '2026-08-25T12:15:00.000Z'
    }));

    const activation = activateStaffSelection({
      access: {
        authorized: true,
        authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA',
        expiresAt: '2027-08-25',
        activatedAt: '2026-08-25T12:00:00.000Z'
      },
      accountKey: 'manager-account',
      pendingSave,
      requestPin,
      staffId: 'manager-one',
      verifyStaffPin
    });

    await Promise.resolve();
    expect(requestPin).toHaveBeenCalledOnce();
    expect(verifyStaffPin).not.toHaveBeenCalled();

    finishSave?.();
    await expect(activation).resolves.toEqual({
      ok: true,
      session: {
        token: 'staff-token',
        staffId: 'manager-one',
        role: 'Manager',
        expiresAt: '2026-08-25T12:15:00.000Z',
        accountKey: 'manager-account'
      }
    });
    expect(requestPin).toHaveBeenCalledOnce();
    expect(verifyStaffPin).toHaveBeenCalledWith({
      staffId: 'manager-one',
      pin: '4821',
      access: expect.objectContaining({ authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA' })
    });
  });

  it.each([
    ['reported failure', () => Promise.resolve({ ok: false, error: 'revision conflict' })],
    ['rejected save', () => Promise.reject(new Error('offline'))]
  ])('does not risk a verification attempt after a %s', async (_label, createPendingSave) => {
    const requestPin = vi.fn(async () => '4821');
    const verifyStaffPin = vi.fn();

    await expect(activateStaffSelection({
      access: {
        authorized: true,
        authorizationCode: 'TT-PILOT-CCCCCCCCCCCCCCCCCCCCCCCC',
        expiresAt: '2027-08-25',
        activatedAt: '2026-08-25T12:00:00.000Z'
      },
      accountKey: 'manager-account',
      pendingSave: createPendingSave(),
      requestPin,
      staffId: 'manager-one',
      verifyStaffPin
    })).resolves.toEqual({
      ok: false,
      error: 'Resolve the current save issue before selecting a staff account.'
    });
    expect(requestPin).toHaveBeenCalledOnce();
    expect(verifyStaffPin).not.toHaveBeenCalled();
  });

  it('treats closing the PIN dialog as a cancellation without verifying', async () => {
    const verifyStaffPin = vi.fn();

    await expect(activateStaffSelection({
      access: {
        authorized: true,
        authorizationCode: 'TT-PILOT-DDDDDDDDDDDDDDDDDDDDDDDD',
        expiresAt: '2027-08-25',
        activatedAt: '2026-08-25T12:00:00.000Z'
      },
      accountKey: 'manager-account',
      pendingSave: Promise.resolve({ ok: true }),
      requestPin: async () => null,
      staffId: 'manager-one',
      verifyStaffPin
    })).resolves.toEqual({ ok: false, canceled: true });
    expect(verifyStaffPin).not.toHaveBeenCalled();
  });

  it('rejects unusable PINs and mismatched trusted responses', async () => {
    expect(isValidStaffPin('1234')).toBe(true);
    expect(isValidStaffPin('123456789012')).toBe(true);
    expect(isValidStaffPin('12ab')).toBe(false);
    expect(isValidStaffPin('123')).toBe(false);
    expect(staffPinInputPattern).toBe('[0-9]{4,12}');

    const verifyStaffPin = vi.fn(async () => ({
      ok: true,
      token: 'wrong-token',
      staffId: 'different-staff',
      role: 'Floor' as const,
      accountKey: 'manager-account',
      expiresAt: '2026-08-25T12:15:00.000Z'
    }));
    await expect(activateStaffSelection({
      access: {
        authorized: true,
        authorizationCode: 'TT-PILOT-BBBBBBBBBBBBBBBBBBBBBBBB',
        expiresAt: '2027-08-25',
        activatedAt: '2026-08-25T12:00:00.000Z'
      },
      accountKey: 'manager-account',
      pendingSave: Promise.resolve({ ok: true }),
      requestPin: async () => '4821',
      staffId: 'manager-one',
      verifyStaffPin
    })).resolves.toEqual({ ok: false, error: 'Staff verification failed.' });
  });
});
