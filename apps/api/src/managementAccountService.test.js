import { describe, expect, it, vi } from 'vitest';
import managementAccountService from './managementAccountService.js';

const {
  ManagementAccountError,
  createManagementAccountService,
  sendFirebasePasswordResetEmail,
  validateNewPassword
} = managementAccountService;

const validTestPassword = (purpose) => `${purpose}-${'x'.repeat(20)}-A7`;

function makeRecord() {
  return {
    accountKey: 'room-one',
    venueName: 'Room One',
    revision: 4,
    savedAt: '2026-08-11T15:00:00.000Z',
    state: {
      games: [],
      sessions: [],
      playerSessions: [],
      profiles: [],
      settings: {
        clubAccount: { clubName: 'Room One' },
        accountLogin: {
          username: 'Owner@Example.com',
          passwordSalt: 'old-salt',
          passwordHash: 'old-hash',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }
  };
}

function makeRecoveryStore(overrides = {}) {
  return {
    claim: vi.fn(async () => ({ id: 'recovery-1', accountKey: 'room-one', status: 'processing' })),
    consume: vi.fn(async () => true),
    create: vi.fn(async (input) => ({
      id: 'recovery-1',
      accountKey: input.accountKey,
      status: 'active',
      expiresAt: '2026-08-11T15:30:00.000Z',
      createdAt: '2026-08-11T15:00:00.000Z',
      consumedAt: null,
      revokedAt: null,
      reason: input.reason || ''
    })),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    release: vi.fn(async () => undefined),
    revoke: vi.fn(async () => true),
    ...overrides
  };
}

function makeService(overrides = {}) {
  const record = makeRecord();
  const recoveryStore = overrides.recoveryStore || makeRecoveryStore();
  const events = [];
  const passwordProvider = overrides.passwordProvider || {
    updatePassword: vi.fn(async () => {
      events.push('provider');
      return { userRef: 'user-ref' };
    })
  };
  const saveState = overrides.saveState || vi.fn(async () => {
    events.push('state');
    return { accountKey: 'room-one', revision: 5, publication: { status: 'pending' } };
  });
  return {
    events,
    passwordProvider,
    recoveryStore,
    saveState,
    service: createManagementAccountService({
      listStatePage: async () => ({ records: [record], hasMore: false, nextCursor: null }),
      loadState: async () => record,
      saveState,
      recoveryStore,
      passwordProvider,
      passwordResetSender: overrides.passwordResetSender || vi.fn(async () => undefined),
      schedulePublicationDrain: vi.fn(async () => undefined),
      sendOperationalAlert: vi.fn(async () => undefined),
      now: () => new Date('2026-08-11T15:00:00.000Z'),
      randomUUID: () => 'operation-1',
      createSalt: () => 'new-salt',
      hashPassword: async () => 'pbkdf2-sha256$210000$new-hash'
    })
  };
}

describe('management account recovery service', () => {
  it('lists management accounts without exposing password hashes or salts', async () => {
    const { service } = makeService();
    const accounts = await service.listAccounts();

    expect(accounts).toEqual([expect.objectContaining({
      accountKey: 'room-one',
      venueName: 'Room One',
      username: 'owner@example.com',
      hasManagementLogin: true,
      revision: 4
    })]);
    expect(JSON.stringify(accounts)).not.toContain('old-hash');
    expect(JSON.stringify(accounts)).not.toContain('old-salt');
  });

  it('requires an owner-created override, updates Firebase before durable state, then consumes it once', async () => {
    const { events, passwordProvider, recoveryStore, saveState, service } = makeService();
    const password = validTestPassword('recovery');
    recoveryStore.consume.mockImplementation(async () => {
      events.push('consume');
      return true;
    });

    const result = await service.completeRecovery({ accountKey: 'room-one', password });

    expect(events).toEqual(['provider', 'state', 'consume']);
    expect(passwordProvider.updatePassword).toHaveBeenCalledWith('owner@example.com', password);
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        accountLogin: expect.objectContaining({
          username: 'owner@example.com',
          passwordSalt: 'new-salt',
          passwordHash: 'pbkdf2-sha256$210000$new-hash'
        })
      })
    }), expect.objectContaining({ expectedRevision: 4, mutationId: 'management-password:recovery-1' }));
    expect(recoveryStore.consume).toHaveBeenCalledWith('recovery-1', expect.any(Object));
    expect(result).toMatchObject({ accountKey: 'room-one', revision: 5, passwordSalt: 'new-salt' });
  });

  it('releases the override and leaves durable state unchanged when Firebase rejects the password update', async () => {
    const recoveryStore = makeRecoveryStore();
    const saveState = vi.fn();
    const { service } = makeService({
      recoveryStore,
      saveState,
      passwordProvider: { updatePassword: vi.fn(async () => { throw new Error('provider unavailable'); }) }
    });

    await expect(service.completeRecovery({ accountKey: 'room-one', password: validTestPassword('provider-failure') }))
      .rejects.toThrow('provider unavailable');
    expect(saveState).not.toHaveBeenCalled();
    expect(recoveryStore.consume).not.toHaveBeenCalled();
    expect(recoveryStore.release).toHaveBeenCalledWith('recovery-1', expect.any(Object));
  });

  it('lets the owner change a known management password without creating or consuming an override', async () => {
    const { recoveryStore, saveState, service } = makeService();
    const result = await service.changePassword({ accountKey: 'room-one', password: validTestPassword('owner-change') });

    expect(result.revision).toBe(5);
    expect(saveState.mock.calls[0][0].settings.accountLogin.lastLoginAt).toBeUndefined();
    expect(recoveryStore.claim).not.toHaveBeenCalled();
    expect(recoveryStore.consume).not.toHaveBeenCalled();
  });

  it('rejects weak passwords before contacting Firebase', async () => {
    const { passwordProvider, service } = makeService();
    await expect(service.changePassword({ accountKey: 'room-one', password: 'password1' }))
      .rejects.toBeInstanceOf(ManagementAccountError);
    expect(passwordProvider.updatePassword).not.toHaveBeenCalled();
    expect(() => validateNewPassword('x'.repeat(129))).toThrow('between 12 and 128');
  });

  it('uses Firebase Identity Toolkit only when a web API key is configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendFirebasePasswordResetEmail('owner@example.com', {
      env: { FIREBASE_WEB_API_KEY: 'local-web-key' },
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=local-web-key',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: 'owner@example.com' })
      })
    );
    await expect(sendFirebasePasswordResetEmail('owner@example.com', { env: {}, fetchImpl }))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_EMAIL_NOT_CONFIGURED', status: 503 });
    await expect(sendFirebasePasswordResetEmail('owner@example.com', {
      env: { FIREBASE_WEB_API_KEY: 'local-web-key' },
      fetchImpl: vi.fn(async () => { throw new Error('request URL with key'); })
    })).rejects.toMatchObject({ code: 'PASSWORD_RESET_EMAIL_FAILED', status: 503 });
  });
});
