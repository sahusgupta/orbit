import { describe, expect, it, vi } from 'vitest';
import identityService from './identityService.js';

const {
  buildEligibilityUpdate,
  buildCameraIdentityRecord,
  calculateAgeFromDate,
  capturePlayerIdentity,
  cleanupIdentityProviderIntentsForPlayer,
  completeIdentityProviderCleanupForSession,
  compensateIdentitySession,
  createPlayerIdentitySession,
  createRequireVerifiedPlayerAge,
  drainIdentityProviderCleanupQueue,
  deletePlayerIdentityData,
  getAgeLevel,
  getPublicIdentityStatus,
  handleStripeIdentityEvent,
  listIdentityProviderCleanupDocuments,
  normalizeCameraCapture,
  normalizeRequiredMinimumAge,
  persistEligibilityUpdate,
  scheduleIdentityProviderCleanupDrain
} = identityService;

describe('Stripe Identity age eligibility', () => {
  const today = new Date('2026-07-27T12:00:00.000Z');

  it('calculates age using the birthday instead of elapsed milliseconds', () => {
    expect(calculateAgeFromDate({ year: 2005, month: 7, day: 27 }, today)).toBe(21);
    expect(calculateAgeFromDate({ year: 2005, month: 7, day: 28 }, today)).toBe(20);
  });

  it('maps ages into the only eligibility bands Orbit exposes', () => {
    expect(getAgeLevel(17)).toBe(0);
    expect(getAgeLevel(18)).toBe(18);
    expect(getAgeLevel(21)).toBe(21);
    expect(normalizeRequiredMinimumAge(18)).toBe(18);
    expect(normalizeRequiredMinimumAge(21)).toBe(21);
    expect(normalizeRequiredMinimumAge(undefined)).toBe(21);
  });

  it('allows an 18-year-old identity while leaving 21+ enforcement to the selected club', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_eighteen',
      status: 'verified',
      verified_outputs: { dob: { year: 2008, month: 7, day: 27 } }
    }, { id: 'evt_eighteen', created: 1785172800 }, 18, today);

    expect(update).toMatchObject({ status: 'verified', ageVerified: true, ageLevel: 18 });
  });

  it('retains only the requested verified ID details for an eligible player', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_adult',
      status: 'verified',
      livemode: true,
      verified_outputs: {
        first_name: 'Jordan',
        last_name: 'Rivera',
        dob: { year: 1990, month: 1, day: 2 },
        address: { line1: '100 Main St', city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
        id_number: 'never-store-this'
      }
    }, { id: 'evt_adult', created: 1785172800 }, 21, today);

    expect(update).toMatchObject({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      providerSessionId: 'vs_adult',
      verifiedDetails: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St, Austin, TX 78701, US'
      }
    });
    expect(update).not.toHaveProperty('dob');
    expect(update).not.toHaveProperty('age');
    expect(JSON.stringify(update)).not.toContain('never-store-this');
  });

  it('blocks a successfully identified player who is below the launch age', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_minor',
      status: 'verified',
      verified_outputs: { dob: { year: 2010, month: 1, day: 1 } }
    }, { id: 'evt_minor', created: 1785172800 }, 21, today);

    expect(getPublicIdentityStatus(update)).toMatchObject({
      status: 'underage',
      ageVerified: false,
      ageLevel: 0,
      failureCode: 'minimum_age_not_met'
    });
  });

  it('does not approve a verified session when Stripe supplies no birthdate', () => {
    const update = buildEligibilityUpdate({
      id: 'vs_missing_dob',
      status: 'verified',
      verified_outputs: {}
    }, { id: 'evt_missing_dob', created: 1785172800 }, 21, today);

    expect(update).toMatchObject({
      status: 'requires_input',
      ageVerified: false,
      failureCode: 'date_of_birth_unavailable'
    });
  });

  it('never exposes Stripe session details through the public status response', () => {
    const status = getPublicIdentityStatus({
      status: 'verified',
      ageVerified: true,
      ageLevel: 21,
      providerSessionId: 'vs_private',
      verified_outputs: { dob: { year: 1990, month: 1, day: 2 } },
      verifiedAt: { toDate: () => today }
    });

    expect(status).toEqual({
      status: 'verified',
      ageVerified: true,
      ageEligible: true,
      ageLevel: 21,
      minimumAge: 18,
      verifiedAt: today.toISOString(),
      reviewStatus: 'approved',
      capturedAt: null,
      failureCode: null,
      verifiedDetails: null
    });
  });

  it('accepts only sanitized camera extraction fields and calculates age on the server', () => {
    expect(normalizeCameraCapture({
      fullName: '  Jordan   Rivera ',
      dateOfBirth: '2008-07-27',
      address: ' 100 Main St ',
      mutationId: 'identity_550e8400-e29b-41d4-a716-446655440000'
    }, today)).toEqual({
      ok: true,
      value: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '2008-07-27',
        address: '100 Main St',
        mutationId: 'identity_550e8400-e29b-41d4-a716-446655440000',
        age: 18
      }
    });
    expect(normalizeCameraCapture({
      fullName: 'Jordan Rivera',
      dateOfBirth: '2005-02-29',
      address: '100 Main St',
      mutationId: 'identity_550e8400-e29b-41d4-a716-446655440001'
    }, today)).toMatchObject({ ok: false });
  });

  it('rejects raw identity media, barcode data, document numbers, and unknown fields', () => {
    const base = {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'identity_550e8400-e29b-41d4-a716-446655440002'
    };
    expect(normalizeCameraCapture({ ...base, image: 'data:image/jpeg;base64,abc' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, barcode: 'raw-pdf417' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, idNumber: '1234' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, age: 40 }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, mutationId: 'identity_short' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, mutationId: 'private-player@example.test' }, today)).toMatchObject({ ok: false });
    expect(normalizeCameraCapture({ ...base, mutationId: 'capture:550e8400-e29b-41d4-a716-446655440000' }, today)).toMatchObject({ ok: false });
  });

  it('exposes provisional eligibility without treating camera extraction as verified identity', () => {
    expect(getPublicIdentityStatus({
      status: 'provisional',
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      reviewStatus: 'pending-in-person',
      capturedAt: today.toISOString(),
      verifiedDetails: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St'
      }
    })).toMatchObject({
      status: 'provisional',
      ageVerified: false,
      ageEligible: true,
      ageLevel: 21,
      reviewStatus: 'pending-in-person',
      capturedAt: today.toISOString()
    });
  });

  it('preserves provider session references needed for deletion redaction after camera recapture', () => {
    const record = buildCameraIdentityRecord({
      provider: 'stripe_identity',
      providerSessionId: 'vs_latest',
      providerSessionIds: ['vs_older']
    }, {
      fullName: 'Jordan Rivera',
      dateOfBirth: '1990-01-02',
      address: '100 Main St',
      mutationId: 'identity_550e8400-e29b-41d4-a716-446655440003',
      age: 36
    }, today);
    expect(record).toMatchObject({
      provider: 'stripe_identity',
      providerSessionId: 'vs_latest',
      providerSessionIds: ['vs_older', 'vs_latest'],
      status: 'provisional'
    });
  });

  it('returns a decoder-safe status before a player has scanned an ID', () => {
    expect(getPublicIdentityStatus({})).toMatchObject({
      status: 'unverified',
      ageVerified: false,
      ageEligible: false,
      reviewStatus: 'not-started',
      capturedAt: null,
      verifiedDetails: null
    });
  });

  it('ignores Identity events that were not created for Orbit player verification', async () => {
    await expect(handleStripeIdentityEvent({
      type: 'identity.verification_session.verified',
      data: { object: { id: 'vs_unrelated', metadata: { purpose: 'another_product' } } }
    })).resolves.toBe(false);
    await expect(handleStripeIdentityEvent({
      type: 'identity.verification_session.verified',
      data: { object: { id: 'vs_missing_metadata', metadata: {} } }
    })).resolves.toBe(false);
  });

  it('fails the venue feature gate closed when the authenticated player has no identity record', async () => {
    const response = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };
    const next = vi.fn();
    const requireAge = createRequireVerifiedPlayerAge({
      readIdentityRecord: vi.fn(async () => ({})),
      loadState: vi.fn(async () => ({
        state: { settings: { clubAccount: { minimumPlayerAge: 21 } } }
      }))
    });

    await requireAge({ orbitPlayer: { uid: 'player-one' }, body: { clubId: 'club-one' } }, response, next);

    expect(response).toMatchObject({
      statusCode: 403,
      body: { ok: false, code: 'AGE_VERIFICATION_REQUIRED', identity: { ageEligible: false, minimumAge: 21 } }
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores delayed Stripe Identity events after the durable deletion marker exists', async () => {
    const retrieve = vi.fn(async () => {
      throw new Error('deleted identity output must not be retrieved');
    });
    const persist = vi.fn(async () => true);
    const completeCleanup = vi.fn(async () => 1);
    const dependencies = {
      database: {},
      getAdminSdk: () => ({}),
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { retrieve } } }),
      isPlayerDeletionMarkedInAdminDatabase: vi.fn(async () => true),
      completeIdentityProviderCleanupForSession: completeCleanup,
      persistEligibilityUpdate: persist
    };

    await expect(handleStripeIdentityEvent({
      id: 'event-verified',
      type: 'identity.verification_session.verified',
      data: { object: {
        id: 'vs_deleted', status: 'verified',
        metadata: { purpose: 'orbit_player_age_verification', playerId: 'deleted-player' }
      } }
    }, dependencies)).resolves.toBe(false);
    await expect(handleStripeIdentityEvent({
      id: 'event-redacted',
      type: 'identity.verification_session.redacted',
      data: { object: {
        id: 'vs_deleted', status: 'redacted',
        metadata: { purpose: 'orbit_player_age_verification', playerId: 'deleted-player' }
      } }
    }, dependencies)).resolves.toBe(true);
    expect(retrieve).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(completeCleanup).toHaveBeenCalledOnce();
    expect(completeCleanup).toHaveBeenCalledWith('vs_deleted', expect.objectContaining({ database: {} }));
  });

  it('atomically refuses eligibility persistence when deletion begins before commit', async () => {
    const transaction = {
      get: vi.fn(async (reference) => ({
        exists: reference.path.startsWith('orbitPlayerDeletionMarkers/'),
        data: () => ({})
      })),
      set: vi.fn()
    };
    const database = {
      doc: vi.fn((path) => ({ path })),
      runTransaction: vi.fn(async (operation) => operation(transaction))
    };
    const getUser = vi.fn();
    const setCustomUserClaims = vi.fn();
    const admin = { auth: () => ({ getUser, setCustomUserClaims }) };

    await expect(persistEligibilityUpdate('deleted-player', {
      status: 'verified', ageVerified: true, ageLevel: 21
    }, {
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({})
    })).resolves.toBe(false);

    expect(transaction.set).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('atomically refuses a camera identity write when deletion begins after route authorization', async () => {
    const transaction = {
      get: vi.fn(async (reference) => ({
        exists: reference.path.startsWith('orbitPlayerDeletionMarkers/'),
        data: () => ({})
      })),
      set: vi.fn()
    };
    const database = {
      doc: vi.fn((path) => ({ path })),
      runTransaction: vi.fn(async (operation) => operation(transaction))
    };
    const admin = {
      firestore: Object.assign(() => database, {
        FieldValue: { serverTimestamp: vi.fn(() => 'server-time') }
      })
    };
    const response = {
      statusCode: 200,
      body: undefined,
      set: vi.fn(),
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };

    await capturePlayerIdentity({
      orbitPlayer: { uid: 'deleted-player' },
      body: {
        fullName: 'Jordan Rivera',
        dateOfBirth: '1990-01-02',
        address: '100 Main St',
        mutationId: 'identity_550e8400-e29b-41d4-a716-446655440099'
      }
    }, response, {
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      nowMs: () => today.getTime()
    });

    expect(response).toMatchObject({
      statusCode: 410,
      body: { ok: false, code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' }
    });
    expect(transaction.set).not.toHaveBeenCalled();
    expect(transaction.get).toHaveBeenCalledOnce();
  });

  it('compensates a newly-created provider session when deletion begins before identity persistence', async () => {
    const originalSecret = process.env.STRIPE_SECRET_KEY;
    const originalReturnUrl = process.env.ORBIT_IDENTITY_RETURN_URL;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.ORBIT_IDENTITY_RETURN_URL = 'https://local.invalid/identity-return';
    try {
      const create = vi.fn(async () => ({
        id: 'vs_created_during_deletion',
        status: 'requires_input',
        url: 'https://verify.invalid/session'
      }));
      const cancel = vi.fn(async () => ({ id: 'vs_created_during_deletion', status: 'canceled' }));
      const cleanupDelete = vi.fn(async () => undefined);
      const cleanupSet = vi.fn(async () => undefined);
      let transactionAttempt = 0;
      const transaction = {
        get: vi.fn(async (reference) => ({
          exists: reference.path.startsWith('orbitPlayerDeletionMarkers/') && transactionAttempt >= 2,
          data: () => ({})
        })),
        set: vi.fn(),
        delete: vi.fn()
      };
      const database = {
        doc: vi.fn((path) => ({
          path,
          get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
          delete: cleanupDelete,
          set: cleanupSet
        })),
        runTransaction: vi.fn(async (operation) => {
          transactionAttempt += 1;
          return operation(transaction);
        })
      };
      const admin = {
        firestore: Object.assign(() => database, {
          FieldValue: {
            arrayUnion: vi.fn((value) => ({ arrayUnion: value })),
            serverTimestamp: vi.fn(() => 'server-time')
          }
        })
      };
      const response = {
        statusCode: 200,
        body: undefined,
        set: vi.fn(),
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };

      await createPlayerIdentitySession({
        orbitPlayer: { uid: 'deleted-player', email: 'verified@example.test' }
      }, response, {
        database,
        getAdminSdk: () => admin,
        getAdminApp: () => ({}),
        getStripe: () => ({ identity: { verificationSessions: { create, cancel } } }),
        isPlayerDeletionMarkedInAdminDatabase: vi.fn(async () => false),
        scheduleIdentityProviderCleanupDrain: vi.fn(async () => ({}))
      });

      expect(create).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledWith('vs_created_during_deletion');
      expect(transaction.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({
          provider: 'stripe_identity',
          providerSessionId: '',
          status: 'pending',
          reason: 'identity-session-create',
          idempotencyKey: expect.stringMatching(/^orbit-player-identity-[a-f0-9]{64}$/),
          createParams: expect.objectContaining({ client_reference_id: 'deleted-player' })
        }),
        { merge: false }
      );
      expect(transaction.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({ reason: 'player-deletion-race', notBeforeMs: 0 }),
        { merge: true }
      );
      expect(cleanupDelete).toHaveBeenCalledOnce();
      expect(response).toMatchObject({
        statusCode: 410,
        body: { ok: false, code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' }
      });
    } finally {
      if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalSecret;
      if (originalReturnUrl === undefined) delete process.env.ORBIT_IDENTITY_RETURN_URL;
      else process.env.ORBIT_IDENTITY_RETURN_URL = originalReturnUrl;
    }
  });

  it('keeps failed provider compensation in a durable opaque queue and schedules retry', async () => {
    const originalSecret = process.env.STRIPE_SECRET_KEY;
    const originalReturnUrl = process.env.ORBIT_IDENTITY_RETURN_URL;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.ORBIT_IDENTITY_RETURN_URL = 'https://local.invalid/identity-return';
    try {
      const create = vi.fn(async () => ({
        id: 'vs_cleanup_must_retry', status: 'requires_input', url: 'https://verify.invalid/retry'
      }));
      const cancel = vi.fn(async () => { throw new Error('provider unavailable'); });
      const redact = vi.fn(async () => { throw new Error('provider unavailable'); });
      const cleanupDelete = vi.fn();
      const cleanupSet = vi.fn(async () => undefined);
      let transactionAttempt = 0;
      const transaction = {
        get: vi.fn(async (reference) => ({
          exists: reference.path.startsWith('orbitPlayerDeletionMarkers/') && transactionAttempt >= 2,
          data: () => ({})
        })),
        set: vi.fn(),
        delete: vi.fn()
      };
      const database = {
        doc: vi.fn((path) => ({
          path,
          get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
          delete: cleanupDelete,
          set: cleanupSet
        })),
        runTransaction: vi.fn(async (operation) => {
          transactionAttempt += 1;
          return operation(transaction);
        })
      };
      const admin = {
        firestore: Object.assign(() => database, {
          FieldValue: {
            arrayUnion: vi.fn((value) => ({ arrayUnion: value })),
            serverTimestamp: vi.fn(() => 'server-time')
          }
        })
      };
      const scheduleCleanup = vi.fn(async () => ({ processed: 0, failed: 1 }));
      const response = {
        statusCode: 200, body: undefined, set: vi.fn(),
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };

      await createPlayerIdentitySession({
        orbitPlayer: { uid: 'deleted-player', email: 'verified@example.test' }
      }, response, {
        database,
        getAdminSdk: () => admin,
        getAdminApp: () => ({}),
        getStripe: () => ({ identity: { verificationSessions: { create, cancel, redact } } }),
        isPlayerDeletionMarkedInAdminDatabase: vi.fn(async () => false),
        scheduleIdentityProviderCleanupDrain: scheduleCleanup
      });

      expect(cancel).toHaveBeenCalledOnce();
      expect(redact).toHaveBeenCalledOnce();
      expect(cleanupDelete).not.toHaveBeenCalled();
      expect(scheduleCleanup).toHaveBeenCalledWith({ force: true });
      expect(transaction.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({
          providerSessionId: '',
          status: 'pending',
          idempotencyKey: expect.stringMatching(/^orbit-player-identity-[a-f0-9]{64}$/)
        }),
        { merge: false }
      );
      expect(JSON.stringify(transaction.set.mock.calls)).not.toContain('verified@example.test');
      expect(response).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });
    } finally {
      if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalSecret;
      if (originalReturnUrl === undefined) delete process.env.ORBIT_IDENTITY_RETURN_URL;
      else process.env.ORBIT_IDENTITY_RETURN_URL = originalReturnUrl;
    }
  });

  it('retains cleanup ownership and never returns a provider URL when identity persistence fails', async () => {
    const originalSecret = process.env.STRIPE_SECRET_KEY;
    const originalReturnUrl = process.env.ORBIT_IDENTITY_RETURN_URL;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.ORBIT_IDENTITY_RETURN_URL = 'https://local.invalid/identity-return';
    try {
      const create = vi.fn(async () => ({
        id: 'vs_transaction_failed', status: 'requires_input', url: 'https://verify.invalid/must-not-return'
      }));
      const cancel = vi.fn(async () => { throw new Error('cancel unavailable'); });
      const redact = vi.fn(async () => { throw new Error('redact unavailable'); });
      const cleanupDelete = vi.fn(async () => undefined);
      const cleanupSet = vi.fn(async () => undefined);
      const transaction = {
        get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
        set: vi.fn(),
        delete: vi.fn()
      };
      let transactionAttempt = 0;
      const database = {
        doc: vi.fn((path) => ({
          path,
          get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
          delete: cleanupDelete,
          set: cleanupSet
        })),
        runTransaction: vi.fn(async (operation) => {
          transactionAttempt += 1;
          if (transactionAttempt <= 2) return operation(transaction);
          throw new Error('identity transaction unavailable');
        })
      };
      const admin = {
        firestore: Object.assign(() => database, {
          FieldValue: {
            arrayUnion: vi.fn((value) => ({ arrayUnion: value })),
            serverTimestamp: vi.fn(() => 'server-time')
          }
        })
      };
      const scheduleCleanup = vi.fn(async () => ({ processed: 0, failed: 1 }));
      const response = {
        statusCode: 200, body: undefined, set: vi.fn(),
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };

      await createPlayerIdentitySession({
        orbitPlayer: { uid: 'transaction-player', email: 'verified@example.test' }
      }, response, {
        database,
        getAdminSdk: () => admin,
        getAdminApp: () => ({}),
        getStripe: () => ({ identity: { verificationSessions: { create, cancel, redact } } }),
        isPlayerDeletionMarkedInAdminDatabase: vi.fn(async () => false),
        scheduleIdentityProviderCleanupDrain: scheduleCleanup
      });

      expect(transaction.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({
          providerSessionId: '',
          status: 'pending',
          deletionMarkerRef: expect.stringMatching(/^orbitPlayerDeletionMarkers\/deleted_[a-f0-9]{64}$/),
          idempotencyKey: expect.stringMatching(/^orbit-player-identity-[a-f0-9]{64}$/)
        }),
        { merge: false }
      );
      expect(transaction.set.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
      expect(transaction.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({ providerSessionId: 'vs_transaction_failed' }),
        { merge: true }
      );
      expect(cancel).toHaveBeenCalledWith('vs_transaction_failed');
      expect(redact).toHaveBeenCalledWith('vs_transaction_failed');
      expect(cleanupDelete).not.toHaveBeenCalled();
      expect(scheduleCleanup).toHaveBeenCalledWith({ force: true });
      expect(response).toMatchObject({
        statusCode: 503,
        body: { ok: false, code: 'IDENTITY_SESSION_PERSISTENCE_FAILED' }
      });
      expect(JSON.stringify(response.body)).not.toContain('must-not-return');
    } finally {
      if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalSecret;
      if (originalReturnUrl === undefined) delete process.env.ORBIT_IDENTITY_RETURN_URL;
      else process.env.ORBIT_IDENTITY_RETURN_URL = originalReturnUrl;
    }
  });

  it('retains an unavailable cleanup record and completes it on a later provider retry', async () => {
    const cleanupSet = vi.fn(async () => undefined);
    const cleanupDelete = vi.fn(async () => undefined);
    const cleanupDocument = {
      data: () => ({
        providerSessionId: '',
        status: 'pending',
        attempts: 0,
        notBeforeMs: 0,
        idempotencyKey: 'orbit-player-identity-opaque-attempt',
        createParams: { client_reference_id: 'pending-player', metadata: { purpose: 'orbit_player_age_verification' } }
      }),
      ref: { set: cleanupSet, delete: cleanupDelete }
    };
    const get = vi.fn(async () => ({ docs: [cleanupDocument] }));
    const limit = vi.fn(() => ({ get }));
    const where = vi.fn(() => ({ limit }));
    const database = { collection: vi.fn(() => ({ where })) };
    const admin = {
      firestore: Object.assign(() => database, {
        FieldValue: {
          increment: vi.fn((value) => ({ increment: value })),
          serverTimestamp: vi.fn(() => 'server-time')
        }
      })
    };

    await expect(drainIdentityProviderCleanupQueue({
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: {} } })
    })).resolves.toEqual({ processed: 1, completed: 0, failed: 1, deferred: 0 });
    expect(cleanupSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending', attempts: { increment: 1 }
    }), { merge: true });
    expect(cleanupDelete).not.toHaveBeenCalled();

    const create = vi.fn(async () => ({ id: 'vs_pending_cleanup', status: 'requires_input' }));
    const retrieve = vi.fn(async () => ({ id: 'vs_pending_cleanup', status: 'requires_input' }));
    const cancel = vi.fn(async () => ({ id: 'vs_pending_cleanup', status: 'canceled' }));
    await expect(drainIdentityProviderCleanupQueue({
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { create, retrieve, cancel } } })
    })).resolves.toEqual({ processed: 1, completed: 1, failed: 0, deferred: 0 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference_id: 'pending-player' }),
      { idempotencyKey: 'orbit-player-identity-opaque-attempt' }
    );
    expect(retrieve).toHaveBeenCalledWith('vs_pending_cleanup');
    expect(cancel).toHaveBeenCalledWith('vs_pending_cleanup');
    expect(cleanupDelete).toHaveBeenCalledOnce();
  });

  it('does not cancel a known provider session while its creator lease is active', async () => {
    const cleanupSet = vi.fn(async () => undefined);
    const cleanupDelete = vi.fn(async () => undefined);
    const cleanupDocument = {
      data: () => ({
        providerSessionId: 'vs_active_creator',
        status: 'pending',
        notBeforeMs: 10_000
      }),
      ref: { set: cleanupSet, delete: cleanupDelete }
    };
    const get = vi.fn(async () => ({ docs: [cleanupDocument] }));
    const limit = vi.fn(() => ({ get }));
    const where = vi.fn(() => ({ limit }));
    const database = { collection: vi.fn(() => ({ where })) };
    const admin = { firestore: Object.assign(() => database, { FieldValue: {} }) };
    const retrieve = vi.fn();
    const cancel = vi.fn();

    await expect(drainIdentityProviderCleanupQueue({
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { retrieve, cancel } } }),
      nowMs: () => 9_999
    })).resolves.toEqual({ processed: 1, completed: 0, failed: 0, deferred: 1 });

    expect(retrieve).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(cleanupSet).not.toHaveBeenCalled();
    expect(cleanupDelete).not.toHaveBeenCalled();
  });

  it('reports no pending provider cleanup when account deletion finds no exact intent', async () => {
    const getStripe = vi.fn(() => { throw new Error('must not initialize Stripe'); });
    await expect(cleanupIdentityProviderIntentsForPlayer('player-without-intent', {
      database: {},
      getAdminSdk: () => ({ firestore: { FieldValue: {} } }),
      getAdminApp: () => ({}),
      getStripe,
      listIdentityProviderCleanupDocuments: vi.fn(async () => [])
    })).resolves.toEqual({
      identityProviderCleanupPending: 0,
      identityProviderCleanupCompleted: 0
    });
    expect(getStripe).not.toHaveBeenCalled();
  });

  it('discovers deletion cleanup intents only by exact immutable UID or protected marker reference', async () => {
    const exactDocument = { id: 'intent-one', ref: { path: 'orbitIdentityProviderCleanup/intent-one' } };
    const duplicateDocument = { id: 'intent-one-copy', ref: exactDocument.ref };
    const snapshots = [
      { docs: [exactDocument] },
      { docs: [duplicateDocument] },
      { docs: [] }
    ];
    const get = vi.fn(async () => snapshots.shift());
    const limit = vi.fn(() => ({ get }));
    const where = vi.fn(() => ({ limit }));
    const database = { collection: vi.fn(() => ({ where })) };

    await expect(listIdentityProviderCleanupDocuments(database, 'immutable-player-uid'))
      .resolves.toEqual([exactDocument]);

    expect(database.collection).toHaveBeenCalledWith('orbitIdentityProviderCleanup');
    expect(where.mock.calls).toEqual([
      ['deletionMarkerRef', '==', expect.stringMatching(/^orbitPlayerDeletionMarkers\/deleted_[a-f0-9]{64}$/)],
      ['createParams.client_reference_id', '==', 'immutable-player-uid'],
      ['createParams.metadata.playerId', '==', 'immutable-player-uid']
    ]);
    expect(where.mock.calls.flat().join(' ')).not.toMatch(/name|email|phone/i);
  });

  it('retains an exact account-deletion intent when the provider is unavailable', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const scheduleCleanup = vi.fn(async () => ({}));
    const document = {
      data: () => ({
        providerSessionId: '',
        idempotencyKey: 'orbit-player-identity-pending',
        createParams: { client_reference_id: 'pending-account-player' },
        notBeforeMs: 0,
        attempts: 2
      }),
      ref: { set, delete: remove }
    };
    const admin = {
      firestore: {
        FieldValue: {
          increment: vi.fn((value) => ({ increment: value })),
          serverTimestamp: vi.fn(() => 'server-time')
        }
      }
    };

    await expect(cleanupIdentityProviderIntentsForPlayer('pending-account-player', {
      database: {},
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => { throw new Error('provider unavailable'); },
      listIdentityProviderCleanupDocuments: vi.fn(async () => [document]),
      scheduleIdentityProviderCleanupDrain: scheduleCleanup
    })).resolves.toEqual({
      identityProviderCleanupPending: 1,
      identityProviderCleanupCompleted: 0
    });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'player-account-deletion',
      notBeforeMs: 0,
      attempts: { increment: 1 }
    }), { merge: true });
    expect(remove).not.toHaveBeenCalled();
    expect(scheduleCleanup).toHaveBeenCalledWith({ force: true });
  });

  it('cancels an abandoned creation session before removing its account-deletion intent', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const retrieve = vi.fn(async () => ({ id: 'vs_known_cleanup', status: 'requires_input' }));
    const cancel = vi.fn(async () => ({ id: 'vs_known_cleanup', status: 'canceled' }));
    const document = {
      data: () => ({
        providerSessionId: 'vs_known_cleanup',
        cleanupMode: 'compensate',
        reason: 'identity-session-create',
        notBeforeMs: 0
      }),
      ref: { set, delete: remove }
    };
    const admin = {
      firestore: {
        FieldValue: { serverTimestamp: vi.fn(() => 'server-time') }
      }
    };

    await expect(cleanupIdentityProviderIntentsForPlayer('known-account-player', {
      database: {},
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { retrieve, cancel } } }),
      listIdentityProviderCleanupDocuments: vi.fn(async () => [document])
    })).resolves.toEqual({
      identityProviderCleanupPending: 0,
      identityProviderCleanupCompleted: 1
    });

    expect(retrieve).toHaveBeenCalledWith('vs_known_cleanup');
    expect(cancel).toHaveBeenCalledWith('vs_known_cleanup');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('replays an absent provider response idempotently before account-deletion cleanup', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const create = vi.fn(async () => ({ id: 'vs_replayed_cleanup', status: 'requires_input' }));
    const retrieve = vi.fn(async () => ({ id: 'vs_replayed_cleanup', status: 'requires_input' }));
    const cancel = vi.fn(async () => ({ id: 'vs_replayed_cleanup', status: 'canceled' }));
    const createParams = {
      client_reference_id: 'replay-account-player',
      metadata: { playerId: 'replay-account-player', purpose: 'orbit_player_age_verification' }
    };
    const document = {
      data: () => ({
        providerSessionId: '',
        idempotencyKey: 'orbit-player-identity-replay-account-player',
        createParams,
        notBeforeMs: 0
      }),
      ref: { set, delete: remove }
    };
    const admin = {
      firestore: {
        FieldValue: { serverTimestamp: vi.fn(() => 'server-time') }
      }
    };

    await expect(cleanupIdentityProviderIntentsForPlayer('replay-account-player', {
      database: {},
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { create, retrieve, cancel } } }),
      listIdentityProviderCleanupDocuments: vi.fn(async () => [document])
    })).resolves.toEqual({
      identityProviderCleanupPending: 0,
      identityProviderCleanupCompleted: 1
    });

    expect(create).toHaveBeenCalledWith(createParams, {
      idempotencyKey: 'orbit-player-identity-replay-account-player'
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      providerSessionId: 'vs_replayed_cleanup',
      reason: 'player-account-deletion'
    }), { merge: true });
    expect(cancel).toHaveBeenCalledWith('vs_replayed_cleanup');
    expect(remove).toHaveBeenCalledOnce();
  });

  it('makes an indeterminate provider-create result immediately retryable and never returns a URL', async () => {
    const originalSecret = process.env.STRIPE_SECRET_KEY;
    const originalReturnUrl = process.env.ORBIT_IDENTITY_RETURN_URL;
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_only';
    process.env.ORBIT_IDENTITY_RETURN_URL = 'https://local.invalid/identity-return';
    try {
      const cleanupSet = vi.fn(async () => undefined);
      const transactionSet = vi.fn();
      const scheduleCleanup = vi.fn(async () => ({ processed: 1, failed: 1 }));
      const database = {
        doc: vi.fn((path) => ({
          path,
          get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
          set: cleanupSet,
          delete: vi.fn(async () => undefined)
        })),
        runTransaction: vi.fn(async (operation) => operation({
          get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
          set: transactionSet,
          delete: vi.fn()
        }))
      };
      const admin = {
        firestore: { FieldValue: { serverTimestamp: vi.fn(() => 'server-time') } }
      };
      const response = {
        statusCode: 200, body: undefined, set: vi.fn(),
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
      };

      await createPlayerIdentitySession({ orbitPlayer: { uid: 'provider-create-player' } }, response, {
        database,
        getAdminSdk: () => admin,
        getAdminApp: () => ({}),
        getStripe: () => ({ identity: { verificationSessions: {
          create: vi.fn(async () => { throw new Error('indeterminate provider result'); })
        } } }),
        isPlayerDeletionMarkedInAdminDatabase: vi.fn(async () => false),
        scheduleIdentityProviderCleanupDrain: scheduleCleanup,
        nowMs: () => 10_000
      });

      expect(transactionSet).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringMatching(/^orbitIdentityProviderCleanup\/[a-f0-9]{64}$/) }),
        expect.objectContaining({ notBeforeMs: 130_000, providerSessionId: '', status: 'pending' }),
        { merge: false }
      );
      expect(cleanupSet).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'provider-create-result-unknown', status: 'pending', notBeforeMs: 0
      }), { merge: true });
      expect(scheduleCleanup).toHaveBeenCalledWith({ force: true });
      expect(response).toMatchObject({
        statusCode: 503,
        body: { ok: false, code: 'IDENTITY_SESSION_UNAVAILABLE' }
      });
      expect(JSON.stringify(response.body)).not.toContain('indeterminate provider result');
    } finally {
      if (originalSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalSecret;
      if (originalReturnUrl === undefined) delete process.env.ORBIT_IDENTITY_RETURN_URL;
      else process.env.ORBIT_IDENTITY_RETURN_URL = originalReturnUrl;
    }
  });

  it('writes a durable known-session redaction intent before deleting the private identity record', async () => {
    const cleanupSet = vi.fn(async () => undefined);
    const identityDelete = vi.fn(async () => undefined);
    const cleanupProvider = vi.fn(async () => ({
      identityProviderCleanupPending: 1,
      identityProviderCleanupCompleted: 0
    }));
    const identityReference = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ providerSessionId: 'vs_delete_known', providerSessionIds: ['vs_delete_older'] })
      })),
      delete: identityDelete
    };
    const database = {
      doc: vi.fn((path) => path.includes('/private/identity')
        ? identityReference
        : { path, set: cleanupSet })
    };
    const setCustomUserClaims = vi.fn(async () => undefined);
    const admin = {
      firestore: { FieldValue: { serverTimestamp: vi.fn(() => 'server-time') } },
      auth: () => ({
        getUser: vi.fn(async () => ({ customClaims: { existing: true } })),
        setCustomUserClaims
      })
    };

    await expect(deletePlayerIdentityData('delete-known-player', {
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      cleanupIdentityProviderIntentsForPlayer: cleanupProvider
    })).resolves.toMatchObject({
      redactionRequested: true,
      identityProviderCleanupPending: 1,
      identityProviderCleanupCompleted: 0
    });

    expect(cleanupSet).toHaveBeenCalledTimes(2);
    expect(cleanupSet).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'stripe_identity', providerSessionId: 'vs_delete_known',
      reason: 'identity-redaction', cleanupMode: 'redact', status: 'pending', notBeforeMs: 0
    }), { merge: true });
    expect(cleanupSet.mock.invocationCallOrder[0]).toBeLessThan(identityDelete.mock.invocationCallOrder[0]);
    expect(cleanupProvider).toHaveBeenCalledWith('delete-known-player', expect.objectContaining({ database }));
    expect(setCustomUserClaims).toHaveBeenCalledWith('delete-known-player', expect.objectContaining({
      ageVerified: false, ageLevel: 0
    }));
  });

  it('keeps processing and failed provider redaction pending, then completes and wakes deletion finalization', async () => {
    const set = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const scheduleCleanup = vi.fn(async () => ({}));
    const scheduleFinalization = vi.fn(async () => ({ finalized: 1, failed: 0 }));
    const document = {
      data: () => ({
        providerSessionId: 'vs_processing', cleanupMode: 'redact',
        reason: 'identity-redaction', notBeforeMs: 0, attempts: 0
      }),
      ref: { set, delete: remove }
    };
    const retrieve = vi.fn()
      .mockResolvedValueOnce({ id: 'vs_processing', status: 'verified', redaction: { status: 'processing' } })
      .mockRejectedValueOnce(new Error('provider temporarily unavailable'))
      .mockResolvedValueOnce({ id: 'vs_processing', status: 'verified', redaction: { status: 'redacted' } });
    const cancel = vi.fn(async () => { throw new Error('provider temporarily unavailable'); });
    const redact = vi.fn(async () => { throw new Error('provider temporarily unavailable'); });
    const admin = {
      firestore: { FieldValue: {
        increment: vi.fn((value) => ({ increment: value })),
        serverTimestamp: vi.fn(() => 'server-time')
      } }
    };
    const dependencies = {
      database: {},
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      getStripe: () => ({ identity: { verificationSessions: { retrieve, cancel, redact } } }),
      listIdentityProviderCleanupDocuments: vi.fn(async () => [document]),
      scheduleIdentityProviderCleanupDrain: scheduleCleanup,
      scheduleDeletionFinalizationDrain: scheduleFinalization
    };

    await expect(cleanupIdentityProviderIntentsForPlayer('processing-player', dependencies)).resolves.toEqual({
      identityProviderCleanupPending: 1,
      identityProviderCleanupCompleted: 0
    });
    expect(remove).not.toHaveBeenCalled();
    expect(scheduleCleanup).toHaveBeenCalledWith({ force: true });
    expect(scheduleFinalization).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(redact).not.toHaveBeenCalled();

    await expect(cleanupIdentityProviderIntentsForPlayer('processing-player', dependencies)).resolves.toEqual({
      identityProviderCleanupPending: 1,
      identityProviderCleanupCompleted: 0
    });
    expect(remove).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(redact).toHaveBeenCalledOnce();
    expect(scheduleFinalization).not.toHaveBeenCalled();

    await expect(cleanupIdentityProviderIntentsForPlayer('processing-player', dependencies)).resolves.toEqual({
      identityProviderCleanupPending: 0,
      identityProviderCleanupCompleted: 1
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
  });

  it('treats a provider resource-missing result as confirmed cleanup', async () => {
    const cancel = vi.fn();
    const redact = vi.fn();
    await expect(compensateIdentitySession({ id: 'vs_missing' }, {
      identity: { verificationSessions: {
        retrieve: vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'resource_missing' }); }),
        cancel,
        redact
      } }
    }, { requireRedaction: true })).resolves.toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(redact).not.toHaveBeenCalled();
  });

  it('never treats cancellation as completion when deletion requires provider redaction', async () => {
    const cancel = vi.fn();
    const redact = vi.fn(async () => ({ id: 'vs_canceled', redaction: { status: 'processing' } }));
    await expect(compensateIdentitySession({ id: 'vs_canceled' }, {
      identity: { verificationSessions: {
        retrieve: vi.fn(async () => ({ id: 'vs_canceled', status: 'canceled' })),
        cancel,
        redact
      } }
    }, { requireRedaction: true })).resolves.toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(redact).toHaveBeenCalledWith('vs_canceled');
  });

  it('removes exact redacted-session intents and wakes the deletion finalizer', async () => {
    const remove = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({ docs: [{ ref: { delete: remove } }] }));
    const limit = vi.fn(() => ({ get }));
    const where = vi.fn(() => ({ limit }));
    const database = { collection: vi.fn(() => ({ where })) };
    const scheduleFinalization = vi.fn(async () => ({ finalized: 1, failed: 0 }));

    await expect(completeIdentityProviderCleanupForSession('vs_redacted_webhook', {
      database,
      getAdminSdk: () => ({}),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: scheduleFinalization
    })).resolves.toBe(1);

    expect(where).toHaveBeenCalledWith('providerSessionId', '==', 'vs_redacted_webhook');
    expect(remove).toHaveBeenCalledOnce();
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
  });

  it('runs and registers a forced follow-up when an intent arrives after the active drain snapshot', async () => {
    /** @type {(value: { docs: any[] }) => void} */
    let releaseFirstSnapshot = () => {};
    const firstSnapshot = new Promise((resolveSnapshot) => { releaseFirstSnapshot = resolveSnapshot; });
    const remove = vi.fn(async () => undefined);
    const document = {
      data: () => ({
        providerSessionId: 'vs_late_intent',
        cleanupMode: 'compensate',
        status: 'pending',
        notBeforeMs: 0
      }),
      ref: { delete: remove, set: vi.fn(async () => undefined) }
    };
    const get = vi.fn()
      .mockImplementationOnce(async () => firstSnapshot)
      .mockResolvedValueOnce({ docs: [document] });
    const database = {
      collection: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => ({ get })) })) }))
    };
    const admin = {
      firestore: { FieldValue: {
        increment: vi.fn((value) => ({ increment: value })),
        serverTimestamp: vi.fn(() => 'server-time')
      } }
    };
    const waitUntil = vi.fn();
    const dependencies = {
      database,
      getAdminSdk: () => admin,
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: vi.fn(async () => ({ finalized: 0, failed: 0 })),
      getStripe: () => ({ identity: { verificationSessions: {
        retrieve: vi.fn(async () => ({ id: 'vs_late_intent', status: 'requires_input' })),
        cancel: vi.fn(async () => ({ id: 'vs_late_intent', status: 'canceled' }))
      } } })
    };

    const first = scheduleIdentityProviderCleanupDrain({ force: true, dependencies, waitUntil });
    const joined = scheduleIdentityProviderCleanupDrain({ force: true, dependencies, waitUntil });
    expect(joined).toBe(first);
    expect(waitUntil).toHaveBeenCalledWith(first);

    releaseFirstSnapshot({ docs: [] });
    await first;
    await vi.waitFor(() => expect(waitUntil).toHaveBeenCalledTimes(2));
    await waitUntil.mock.calls[1][0];
    expect(get).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  });
});
