import { describe, expect, it, vi } from 'vitest';
import managementAccountService from './managementAccountService.js';

const {
  ManagementAccountError,
  createManagementAccountService,
  sendFirebasePasswordResetEmail,
  validateNewPassword
} = managementAccountService;

const testCredential = (purpose, character = 'x') => `${purpose}-${character.repeat(20)}-A7`;
const validTestPassword = (purpose) => testCredential(purpose);
const priorSalt = testCredential('prior-salt', 's');
const priorHash = testCredential('prior-hash', 'h');
const updatedSalt = testCredential('updated-salt', 's');
const updatedHash = testCredential('updated-hash', 'h');
const firebaseWebApiKey = testCredential('firebase-web-key', 'k');

function makeRecord({ withLogin = true } = {}) {
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
        pilotAccess: { licenseId: 'room-one', expiresAt: '2099-01-01T00:00:00.000Z' },
        ...(withLogin ? { accountLogin: {
          username: 'Owner@Example.com',
          passwordSalt: priorSalt,
          passwordHash: priorHash,
          createdAt: '2026-01-01T00:00:00.000Z'
        } } : {})
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
  const record = overrides.record || makeRecord();
  const recoveryStore = overrides.recoveryStore || makeRecoveryStore();
  const events = [];
  const passwordProvider = overrides.passwordProvider || {
    createUser: vi.fn(async () => {
      events.push('provider-create');
      return { userId: 'firebase-user-1', userRef: 'user-ref' };
    }),
    deleteUser: vi.fn(async () => {
      events.push('provider-delete');
    }),
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
      loadPilotLicense: overrides.loadPilotLicense || vi.fn(async () => ({
        id: 'license-document-1',
        licenseId: 'room-one',
        accountKey: 'room-one',
        issuedTo: 'Room One',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00.000Z'
      })),
      saveState,
      recoveryStore,
      passwordProvider,
      passwordResetSender: overrides.passwordResetSender || vi.fn(async () => undefined),
      schedulePublicationDrain: vi.fn(async () => undefined),
      sendOperationalAlert: vi.fn(async () => undefined),
      now: () => new Date('2026-08-11T15:00:00.000Z'),
      randomUUID: () => 'operation-1',
      createSalt: () => updatedSalt,
      hashPassword: async () => updatedHash
    })
  };
}

describe('management account recovery service', () => {
  it('provisions credentials only onto an active license state while preserving all existing club data', async () => {
    const record = makeRecord({ withLogin: false });
    record.state.games = [{ id: 'holdem', name: '1/2 NLH' }];
    record.state.profiles = [{ id: 'player-1', name: 'Lucky Lodge Regular' }];
    const { passwordProvider, saveState, service } = makeService({ record });
    const password = validTestPassword('new-management-login');

    const result = await service.provisionAccount({
      licenseDocumentId: 'license-document-1',
      username: 'Manager@LuckyLodge.example',
      password
    });

    expect(passwordProvider.createUser).toHaveBeenCalledWith('manager@luckylodge.example', password);
    expect(saveState).toHaveBeenCalledWith({
      ...record.state,
      settings: {
        ...record.state.settings,
        accountLogin: {
          username: 'manager@luckylodge.example',
          passwordSalt: updatedSalt,
          passwordHash: updatedHash,
          createdAt: '2026-08-11T15:00:00.000Z'
        }
      }
    }, expect.objectContaining({
      expectedRevision: 4,
      mutationId: 'management-account-provision:operation-1',
      mutationType: 'management-account-provision'
    }));
    expect(result).toMatchObject({
      accountKey: 'room-one',
      username: 'manager@luckylodge.example',
      revision: 5
    });
    expect(passwordProvider.deleteUser).not.toHaveBeenCalled();
  });

  it('rejects provisioning for inactive licenses or accounts that already have a login', async () => {
    const inactive = makeService({
      record: makeRecord({ withLogin: false }),
      loadPilotLicense: vi.fn(async () => ({
        id: 'license-document-1',
        accountKey: 'room-one',
        status: 'expired'
      }))
    });
    await expect(inactive.service.provisionAccount({
      licenseDocumentId: 'license-document-1',
      username: 'manager@example.com',
      password: validTestPassword('inactive-license')
    })).rejects.toMatchObject({ code: 'MANAGEMENT_LICENSE_INACTIVE', status: 409 });
    expect(inactive.passwordProvider.createUser).not.toHaveBeenCalled();

    const configured = makeService();
    await expect(configured.service.provisionAccount({
      licenseDocumentId: 'license-document-1',
      username: 'replacement@example.com',
      password: validTestPassword('existing-login')
    })).rejects.toMatchObject({ code: 'MANAGEMENT_LOGIN_ALREADY_CONFIGURED', status: 409 });
    expect(configured.passwordProvider.createUser).not.toHaveBeenCalled();
  });

  it('removes a newly created Firebase user when authoritative state provisioning fails', async () => {
    const saveState = vi.fn(async () => {
      throw new Error('state unavailable');
    });
    const { passwordProvider, service } = makeService({
      record: makeRecord({ withLogin: false }),
      saveState
    });

    await expect(service.provisionAccount({
      licenseDocumentId: 'license-document-1',
      username: 'manager@example.com',
      password: validTestPassword('rollback')
    })).rejects.toThrow('state unavailable');
    expect(passwordProvider.deleteUser).toHaveBeenCalledWith('firebase-user-1');
  });

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
    expect(JSON.stringify(accounts)).not.toContain(priorHash);
    expect(JSON.stringify(accounts)).not.toContain(priorSalt);
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
          passwordSalt: updatedSalt,
          passwordHash: updatedHash
        })
      })
    }), expect.objectContaining({ expectedRevision: 4, mutationId: 'management-password:recovery-1' }));
    expect(recoveryStore.consume).toHaveBeenCalledWith('recovery-1', expect.any(Object));
    expect(result).toMatchObject({ accountKey: 'room-one', revision: 5, passwordSalt: updatedSalt });
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
    await expect(service.changePassword({ accountKey: 'room-one', password: 'x'.repeat(11) }))
      .rejects.toBeInstanceOf(ManagementAccountError);
    expect(passwordProvider.updatePassword).not.toHaveBeenCalled();
    expect(() => validateNewPassword('x'.repeat(129))).toThrow('between 12 and 128');
  });

  it('uses Firebase Identity Toolkit only when a web API key is configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendFirebasePasswordResetEmail('owner@example.com', {
      env: { FIREBASE_WEB_API_KEY: firebaseWebApiKey },
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseWebApiKey}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: 'owner@example.com' })
      })
    );
    await expect(sendFirebasePasswordResetEmail('owner@example.com', { env: {}, fetchImpl }))
      .rejects.toMatchObject({ code: 'PASSWORD_RESET_EMAIL_NOT_CONFIGURED', status: 503 });
    await expect(sendFirebasePasswordResetEmail('owner@example.com', {
      env: { FIREBASE_WEB_API_KEY: firebaseWebApiKey },
      fetchImpl: vi.fn(async () => { throw new Error('request URL with key'); })
    })).rejects.toMatchObject({ code: 'PASSWORD_RESET_EMAIL_FAILED', status: 503 });
  });
});
