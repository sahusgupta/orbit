import { describe, expect, it, vi } from 'vitest';
import {
  AccountRecoveryValidationError,
  recoverAccountLogin,
  type RecoverableAccountLogin
} from './accountRecovery';

const accountLogin: RecoverableAccountLogin & { auditLabel: string } = {
  username: 'owner@example.com',
  passwordSalt: 'old-salt',
  passwordHash: 'old-hash',
  createdAt: '2026-07-01T00:00:00.000Z',
  auditLabel: 'primary-owner'
};

describe('account password recovery', () => {
  it('verifies the new Firebase credential before replacing the local password hash', async () => {
    const events: string[] = [];
    const recovered = await recoverAccountLogin({
      accountLogin,
      username: ' OWNER@example.com ',
      password: 'Stronger-passphrase-2026',
      authenticate: async (username, password) => {
        events.push(`authenticate:${username}:${password}`);
      },
      createSalt: () => 'new-salt',
      hashPassword: async (password, salt) => {
        events.push(`hash:${password}:${salt}`);
        return 'new-hash';
      },
      now: () => '2026-08-06T02:00:00.000Z'
    });

    expect(events).toEqual([
      'authenticate:owner@example.com:Stronger-passphrase-2026',
      'hash:Stronger-passphrase-2026:new-salt'
    ]);
    expect(recovered).toEqual({
      ...accountLogin,
      username: 'owner@example.com',
      passwordSalt: 'new-salt',
      passwordHash: 'new-hash',
      lastLoginAt: '2026-08-06T02:00:00.000Z'
    });
  });

  it('rejects a different card-house email before Firebase authentication', async () => {
    const authenticate = vi.fn();

    await expect(recoverAccountLogin({
      accountLogin,
      username: 'other@example.com',
      password: 'Stronger-passphrase-2026',
      authenticate,
      createSalt: () => 'new-salt',
      hashPassword: async () => 'new-hash',
      now: () => '2026-08-06T02:00:00.000Z'
    })).rejects.toBeInstanceOf(AccountRecoveryValidationError);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejects the requested shared weak password before Firebase authentication', async () => {
    const authenticate = vi.fn();

    await expect(recoverAccountLogin({
      accountLogin,
      username: 'owner@example.com',
      password: '12345678',
      authenticate,
      createSalt: () => 'new-salt',
      hashPassword: async () => 'new-hash',
      now: () => '2026-08-06T02:00:00.000Z'
    })).rejects.toThrow('at least 12 characters');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('does not change the local hash when Firebase rejects the new credential', async () => {
    const hashPassword = vi.fn();

    await expect(recoverAccountLogin({
      accountLogin,
      username: 'owner@example.com',
      password: 'Stronger-passphrase-2026',
      authenticate: async () => { throw new Error('Firebase rejected the credential.'); },
      createSalt: () => 'new-salt',
      hashPassword,
      now: () => '2026-08-06T02:00:00.000Z'
    })).rejects.toThrow('Firebase rejected the credential.');
    expect(hashPassword).not.toHaveBeenCalled();
    expect(accountLogin.passwordHash).toBe('old-hash');
  });
});
