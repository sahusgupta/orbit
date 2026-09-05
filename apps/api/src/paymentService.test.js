import { describe, expect, it, vi } from 'vitest';
import database from './database.js';
import paymentService from './paymentService.js';
import deletionGuard from './playerDeletionGuard.js';

const {
  applyRevenueCatEvent,
  buildPaidMembershipProjection,
  isVerifiedPlayerClaims,
  parseMembershipPlanAmountCents,
  recordMembershipPayment,
  reconcileMembershipPayment,
  resolveAuthoritativeCheckoutProduct
} = paymentService;
const { StateConflictError } = database;

describe('verified player identity claims', () => {
  it('accepts provider-verified email or phone claims and rejects unverified email', () => {
    expect(isVerifiedPlayerClaims({ email: 'player@example.com', email_verified: true })).toBe(true);
    expect(isVerifiedPlayerClaims({ phone_number: '+15551112222' })).toBe(true);
    expect(isVerifiedPlayerClaims({ email: 'player@example.com', email_verified: false })).toBe(false);
  });
});

describe('authoritative membership checkout pricing', () => {
  const state = {
    settings: {
      membershipPlans: [
        { id: 'daily-special', name: 'Daily Special', priceLabel: '$12.50/day', durationDays: 1, active: true },
        { id: 'monthly-vip', name: 'VIP Month', priceLabel: '$79/mo', durationDays: 45, active: true },
        { id: 'retired', name: 'Retired', priceLabel: '$1', durationDays: 30, active: false }
      ]
    }
  };

  it('derives checkout amount, product, duration, and metadata from the selected active plan', () => {
    expect(resolveAuthoritativeCheckoutProduct(state, {
      product: 'monthly',
      planId: 'daily-special',
      priceLabel: '$0',
      membershipDurationDays: 999
    })).toEqual({
      ok: true,
      value: {
        product: 'day',
        planId: 'daily-special',
        planName: 'Daily Special',
        priceLabel: '$12.50/day',
        membershipDurationDays: 1,
        amountCents: 1250,
        name: 'Daily Special'
      }
    });
    expect(resolveAuthoritativeCheckoutProduct(state, { product: 'day', planId: 'monthly-vip' }))
      .toMatchObject({ ok: true, value: { product: 'monthly', membershipDurationDays: 45, amountCents: 7900 } });
  });

  it('requires a known active plan ID and refuses free or unpriced Stripe checkout', () => {
    expect(resolveAuthoritativeCheckoutProduct(state, { product: 'monthly' })).toMatchObject({ ok: false, status: 400 });
    expect(resolveAuthoritativeCheckoutProduct(state, { product: 'monthly', planId: 'retired' })).toMatchObject({ ok: false, status: 400 });
    expect(resolveAuthoritativeCheckoutProduct({ settings: { membershipPlans: [
      { id: 'free', name: 'Free', priceLabel: 'Free', durationDays: 30, active: true },
      { id: 'ask', name: 'Ask', priceLabel: 'Ask staff', durationDays: 30, active: true }
    ] } }, { product: 'monthly', planId: 'free' })).toMatchObject({ ok: false, status: 409 });
    expect(resolveAuthoritativeCheckoutProduct({ settings: { membershipPlans: [
      { id: 'ask', name: 'Ask', priceLabel: 'Ask staff', durationDays: 30, active: true }
    ] } }, { product: 'monthly', planId: 'ask' })).toMatchObject({ ok: false, status: 409 });
    expect(parseMembershipPlanAmountCents({ amountCents: 4321, priceLabel: '$99' })).toBe(4321);
    expect(parseMembershipPlanAmountCents({ priceLabel: '$10 first, then $35' })).toBeNull();
  });

  it('prices each allowed time package from the time club hourly fee and rejects forged durations and drop clubs', () => {
    expect(resolveAuthoritativeCheckoutProduct({
      settings: { defaultCollectionMode: 'Time', defaultHourlyFee: 12 }
    }, { product: 'time-30' })).toEqual({
      ok: true,
      value: { product: 'time-30', timeMinutes: 30, amountCents: 600, name: '30-Minute Time Pack' }
    });
    expect(resolveAuthoritativeCheckoutProduct({
      settings: { defaultCollectionMode: 'Time', defaultHourlyFee: 12 }
    }, { product: 'time-60' })).toMatchObject({ value: { timeMinutes: 60, amountCents: 1200 } });
    expect(resolveAuthoritativeCheckoutProduct({
      settings: { defaultCollectionMode: 'Time', defaultHourlyFee: 12 }
    }, { product: 'time-120' })).toMatchObject({ value: { timeMinutes: 120, amountCents: 2400 } });
    expect(resolveAuthoritativeCheckoutProduct({
      settings: { defaultCollectionMode: 'Time', defaultHourlyFee: 12 }
    }, { product: 'time-90' })).toMatchObject({ ok: false, status: 400 });
    expect(resolveAuthoritativeCheckoutProduct({
      settings: { defaultCollectionMode: 'Drop', defaultHourlyFee: 12 }, sessions: []
    }, { product: 'time-30' })).toMatchObject({ ok: false, status: 409 });
  });
});

function createFirestoreHarness(seed = {}) {
  const records = new Map(Object.entries(seed));
  const writes = [];
  const FieldValue = {
    increment: (amount) => ({ operation: 'increment', amount }),
    serverTimestamp: () => ({ operation: 'server-timestamp' })
  };
  const snapshot = (path) => ({
    exists: records.has(path),
    data: () => records.get(path)
  });
  const mergeValue = (current, next) => {
    if (next?.operation === 'increment') return Number(current || 0) + next.amount;
    if (!next || typeof next !== 'object' || Array.isArray(next) || next.operation) return next;
    return Object.fromEntries(Object.entries(next).map(([key, value]) => [
      key,
      mergeValue(current?.[key], value)
    ]));
  };
  const database = {
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    runTransaction: async (operation) => operation({
      get: async (reference) => snapshot(reference.path),
      set: (reference, value, options) => {
        writes.push({ path: reference.path, value, options });
        records.set(reference.path, options?.merge
          ? { ...(records.get(reference.path) || {}), ...mergeValue(records.get(reference.path), value) }
          : mergeValue({}, value));
      }
    })
  };
  const admin = { firestore: { FieldValue } };
  return { admin, database, records, writes };
}

function stripeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    type: 'checkout.session.completed',
    created: 1_786_406_400,
    account: 'acct-test',
    data: {
      object: {
        id: 'cs-1',
        payment_status: 'paid',
        amount_total: 5000,
        currency: 'usd',
        client_reference_id: /** @type {string | undefined} */ (undefined),
        metadata: /** @type {Record<string, string>} */ ({
          kind: 'club_access',
          clubId: 'club-1',
          playerId: 'player-1',
          playerName: 'Alex',
          product: 'time-5'
        })
      }
    },
    ...overrides
  };
}

describe('payment webhook idempotency and ordering', () => {
  it('ignores current and legacy Stripe fulfillments after account deletion', async () => {
    for (const legacy of [false, true]) {
      const event = stripeEvent();
      if (legacy) {
        event.data.object.metadata = {
          kind: 'club_membership',
          clubId: 'club-1',
          plan: 'monthly',
          playerName: 'Private Name',
          playerEmail: 'private@example.test'
        };
        event.data.object.client_reference_id = 'player-1';
      }
      const markerPath = deletionGuard.playerDeletionMarkerPath('player-1');
      const harness = createFirestoreHarness({ [markerPath]: { status: 'blocked' } });
      const loadState = vi.fn();
      const saveState = vi.fn();
      const readIdentityRecord = vi.fn();

      await expect(recordMembershipPayment(event, {
        ...harness,
        loadState,
        saveState,
        readIdentityRecord
      })).resolves.toBe('deleted-player');
      expect(loadState).not.toHaveBeenCalled();
      expect(saveState).not.toHaveBeenCalled();
      expect(readIdentityRecord).not.toHaveBeenCalled();
      expect(harness.writes).toEqual([]);
      expect(harness.records.has('clubs/club-1/memberships/player-1')).toBe(false);
      expect(harness.records.has('clubs/club-1/timeWallets/player-1')).toBe(false);
    }
  });

  it('rechecks deletion atomically before writing Stripe club projections', async () => {
    const markerPath = deletionGuard.playerDeletionMarkerPath('player-1');
    const harness = createFirestoreHarness({ [markerPath]: { status: 'blocked' } });
    await expect(recordMembershipPayment(stripeEvent(), {
      ...harness,
      isPlayerDeletionMarkedInAdminDatabase: async () => false,
      reconcileState: false
    })).resolves.toBe('deleted-player');

    expect(harness.records.has('clubs/club-1/transactions/cs-1')).toBe(false);
    expect(harness.records.has('clubs/club-1/timeWallets/player-1')).toBe(false);
    const eventWrite = harness.writes.find((write) => write.path.startsWith('webhookEvents/stripe_'));
    expect(eventWrite?.value).toMatchObject({ provider: 'stripe', outcome: 'deleted-player' });
    expect(JSON.stringify(eventWrite?.value)).not.toContain('player-1');
  });

  it('stops authoritative payment reconciliation when deletion begins before a retry', async () => {
    const baseState = {
      games: [], sessions: [], playerSessions: [], profiles: [], interests: [], revenueTransactions: [],
      settings: { pilotAccess: { licenseId: 'club-1' }, clubAccount: { clubName: 'Club One' } }
    };
    const deletionChecks = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const loadState = vi.fn(async () => ({ state: baseState, revision: 1 }));
    const saveState = vi.fn(async () => {
      throw new StateConflictError('club-1', 1, 2);
    });

    await expect(reconcileMembershipPayment(stripeEvent({
      data: { object: {
        ...stripeEvent().data.object,
        metadata: { ...stripeEvent().data.object.metadata, product: 'monthly' }
      } }
    }), {
      isPlayerDeletionMarked: deletionChecks,
      loadState,
      saveState,
      schedulePublicationDrain: vi.fn(),
      readIdentityRecord: async () => ({})
    })).resolves.toEqual({ outcome: 'deleted-player', profile: null });
    expect(loadState).toHaveBeenCalledOnce();
    expect(saveState).toHaveBeenCalledOnce();
  });

  it('publishes payment facts without activation dates while physical ID review is pending', () => {
    expect(buildPaidMembershipProjection({
      reconciliation: { profile: {
        membershipStatus: 'Approved',
        membershipPaymentStatus: 'Paid',
        identityReviewStatus: 'Pending',
        membershipStartDate: '',
        membershipExpirationDate: ''
      } },
      id: 'club-1:player-1',
      clubId: 'club-1',
      playerId: 'player-1',
      playerName: 'Alex',
      plan: 'monthly',
      paymentTransactionId: 'cs-1',
      updatedAt: 'server-time'
    })).toMatchObject({
      status: 'Approved',
      membershipPaymentStatus: 'Paid',
      identityReviewStatus: 'Pending',
      joinedAt: '',
      expiresAt: null,
      paymentTransactionId: 'cs-1'
    });
  });

  it('publishes the canonical activation window only after approved-ID Core activation', () => {
    expect(buildPaidMembershipProjection({
      reconciliation: { profile: {
        membershipStatus: 'Active',
        membershipPaymentStatus: 'Paid',
        identityReviewStatus: 'Approved',
        membershipStartDate: '2026-08-28',
        membershipExpirationDate: '2026-09-27'
      } },
      id: 'club-1:player-1',
      clubId: 'club-1',
      playerId: 'player-1',
      playerName: 'Alex',
      plan: 'monthly',
      paymentTransactionId: 'cs-1',
      updatedAt: 'server-time'
    })).toMatchObject({
      status: 'Active',
      membershipPaymentStatus: 'Paid',
      identityReviewStatus: 'Approved',
      joinedAt: '2026-08-28',
      expiresAt: '2026-09-27'
    });
  });

  it('applies a paid Stripe session once when the same event is repeated', async () => {
    const harness = createFirestoreHarness();
    await expect(recordMembershipPayment(stripeEvent(), harness)).resolves.toBe('applied');
    await expect(recordMembershipPayment(stripeEvent(), harness)).resolves.toBe('duplicate-event');

    expect(harness.records.get('clubs/club-1/timeWallets/player-1').balanceMinutes).toBe(300);
    expect(harness.writes.filter((write) => write.path === 'clubs/club-1/timeWallets/player-1')).toHaveLength(1);
  });

  it('does not fulfill one Stripe checkout session twice through different event IDs', async () => {
    const harness = createFirestoreHarness();
    await recordMembershipPayment(stripeEvent(), harness);
    await expect(recordMembershipPayment(stripeEvent({ id: 'evt-2' }), harness)).resolves.toBe('duplicate-payment');
    expect(harness.records.get('clubs/club-1/timeWallets/player-1').balanceMinutes).toBe(300);
  });

  it('fulfills the server-approved duration instead of a modified metadata duration', async () => {
    const harness = createFirestoreHarness();
    const event = stripeEvent();
    event.data.object.metadata.product = 'time-30';
    event.data.object.metadata.timeMinutes = '999';

    await expect(recordMembershipPayment(event, harness)).resolves.toBe('applied');

    expect(harness.records.get('clubs/club-1/timeWallets/player-1').balanceMinutes).toBe(30);
  });

  it('reconciles a paid membership into authoritative state and revenue without clearing ID review', async () => {
    const state = {
      games: [],
      sessions: [],
      playerSessions: [],
      profiles: [],
      interests: [],
      revenueTransactions: [],
      settings: {
        pilotAccess: { licenseId: 'club-1' },
        clubAccount: { clubName: 'Club One' }
      }
    };
    let savedState = state;
    let scheduled = 0;
    const result = await reconcileMembershipPayment(stripeEvent({
      data: {
        object: {
          ...stripeEvent().data.object,
          metadata: {
            ...stripeEvent().data.object.metadata,
            product: 'monthly',
            playerEmail: 'alex@example.test'
          }
        }
      }
    }), {
      loadState: async () => ({ state, revision: 4 }),
      saveState: async (next, options) => {
        savedState = next;
        expect(options).toMatchObject({
          expectedRevision: 4,
          mutationId: 'stripe-payment:cs-1',
          mutationType: 'stripe-membership-payment'
        });
        return { duplicate: false };
      },
      schedulePublicationDrain: () => { scheduled += 1; },
      readIdentityRecord: async () => ({
        status: 'provisional',
        ageEligible: true,
        ageLevel: 21,
        reviewStatus: 'pending-in-person',
        captureMethod: 'camera-pdf417',
        capturedAt: '2026-08-27T12:00:00.000Z',
        verifiedDetails: {
          fullName: 'Alex Rivera',
          dateOfBirth: '1990-01-02',
          address: '100 Main St'
        }
      })
    });

    expect(result.outcome).toBe('applied');
    expect(savedState?.profiles[0]).toMatchObject({
      id: 'player-1',
      name: 'Alex Rivera',
      birthday: '1990-01-02',
      address: '100 Main St',
      identityReviewStatus: 'Pending',
      membershipPaymentStatus: 'Paid',
      membershipStatus: 'Approved'
    });
    expect(savedState?.revenueTransactions).toEqual([expect.objectContaining({
      id: 'cs-1',
      amountCents: 5000,
      paymentStatus: 'paid',
      source: 'stripe'
    })]);
    expect(scheduled).toBe(1);
  });

  it('activates a paid membership only when the stored identity review is approved', async () => {
    const state = {
      games: [],
      sessions: [],
      playerSessions: [],
      profiles: [{
        id: 'player-1',
        name: 'Alex',
        phone: '',
        birthday: '1990-01-02',
        membershipStartDate: '',
        membershipExpirationDate: '',
        membershipStatus: 'Approved',
        identityReviewStatus: 'Approved',
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: '',
        preferredGameIds: [],
        preferredStakes: '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: '',
        preferredTags: [],
        usualCompanions: [],
        notes: ''
      }],
      interests: [],
      revenueTransactions: [],
      settings: { pilotAccess: { licenseId: 'club-1' }, clubAccount: { clubName: 'Club One' } }
    };
    let savedState = state;
    await reconcileMembershipPayment(stripeEvent({
      data: { object: { ...stripeEvent().data.object, metadata: { ...stripeEvent().data.object.metadata, product: 'monthly' } } }
    }), {
      loadState: async () => ({ state, revision: 2 }),
      saveState: async (next) => { savedState = next; return { duplicate: false }; },
      schedulePublicationDrain: () => undefined,
      readIdentityRecord: async () => ({})
    });
    expect(savedState?.profiles[0]).toMatchObject({
      identityReviewStatus: 'Approved',
      membershipPaymentStatus: 'Paid',
      membershipStatus: 'Active',
      membershipStartDate: '2026-08-11',
      membershipExpirationDate: '2026-09-10'
    });
  });

  it('merges pending identity review onto an existing legacy profile before recording payment', async () => {
    const state = {
      games: [], sessions: [], playerSessions: [], interests: [], revenueTransactions: [],
      profiles: [{ id: 'player-1', name: 'Legacy Alex', identityReviewStatus: undefined }],
      settings: { pilotAccess: { licenseId: 'club-1' }, clubAccount: { clubName: 'Club One' } }
    };
    let savedState = state;
    await reconcileMembershipPayment(stripeEvent({
      data: { object: { ...stripeEvent().data.object, metadata: { ...stripeEvent().data.object.metadata, product: 'monthly' } } }
    }), {
      loadState: async () => ({ state, revision: 1 }),
      saveState: async (next) => { savedState = next; return { duplicate: false }; },
      schedulePublicationDrain: () => undefined,
      readIdentityRecord: async () => ({
        status: 'provisional', ageEligible: true, ageLevel: 21,
        reviewStatus: 'pending-in-person', captureMethod: 'camera-pdf417',
        capturedAt: '2026-08-27T12:00:00.000Z',
        verifiedDetails: { fullName: 'Alex Rivera', dateOfBirth: '1990-01-02', address: '100 Main St' }
      })
    });
    expect(savedState.profiles[0]).toMatchObject({
      name: 'Alex Rivera',
      identityReviewStatus: 'Pending',
      membershipPaymentStatus: 'Paid',
      membershipStatus: 'Approved'
    });
  });

  it('fails closed when paid checkout has no authoritative Core state', async () => {
    await expect(reconcileMembershipPayment(stripeEvent(), {
      loadState: async () => null,
      saveState: async () => { throw new Error('must not save'); },
      schedulePublicationDrain: () => undefined,
      readIdentityRecord: async () => ({})
    })).rejects.toThrow('Authoritative club state is unavailable');
  });

  it('reloads and retries once after an authoritative revision conflict', async () => {
    const baseState = {
      games: [], sessions: [], playerSessions: [], profiles: [], interests: [], revenueTransactions: [],
      settings: { pilotAccess: { licenseId: 'club-1' }, clubAccount: { clubName: 'Club One' } }
    };
    let loads = 0;
    let saves = 0;
    let scheduled = 0;
    await expect(reconcileMembershipPayment(stripeEvent({
      data: { object: { ...stripeEvent().data.object, metadata: { ...stripeEvent().data.object.metadata, product: 'monthly' } } }
    }), {
      loadState: async () => ({ state: baseState, revision: ++loads }),
      saveState: async () => {
        saves += 1;
        if (saves === 1) throw new StateConflictError('club-1', 1, 2);
        return { duplicate: false };
      },
      schedulePublicationDrain: () => { scheduled += 1; },
      readIdentityRecord: async () => ({})
    })).resolves.toMatchObject({ outcome: 'applied' });
    expect({ loads, saves, scheduled }).toEqual({ loads: 2, saves: 2, scheduled: 1 });
  });

  it('returns the already canonical active profile on a duplicate paid session', async () => {
    const activeProfile = {
      id: 'player-1',
      membershipStatus: 'Active',
      membershipPaymentStatus: 'Paid',
      identityReviewStatus: 'Approved',
      membershipStartDate: '2026-08-28',
      membershipExpirationDate: '2026-09-27'
    };
    let scheduled = 0;
    await expect(reconcileMembershipPayment(stripeEvent(), {
      loadState: async () => ({
        revision: 9,
        state: {
          profiles: [activeProfile],
          revenueTransactions: [{ id: 'cs-1' }]
        }
      }),
      saveState: async () => { throw new Error('duplicate must not be resaved'); },
      schedulePublicationDrain: () => { scheduled += 1; },
      readIdentityRecord: async () => ({})
    })).resolves.toEqual({ outcome: 'duplicate-payment', profile: activeProfile });
    expect(scheduled).toBe(1);
  });

  it('ignores a stale RevenueCat event after a newer entitlement update', async () => {
    const harness = createFirestoreHarness({
      'players/player-1': {
        premium: {
          status: 'active',
          lastRevenueCatEventId: 'newer-event',
          lastRevenueCatEventAtMs: 2000
        },
        subscriptionStatus: 'active'
      }
    });
    const staleEvent = {
      id: 'older-event',
      type: 'EXPIRATION',
      app_user_id: 'player-1',
      event_timestamp_ms: 1000,
      expiration_at_ms: 1000
    };

    await expect(applyRevenueCatEvent(harness.database, harness.admin, staleEvent, {
      entitlementId: 'player_premium',
      entitlementIds: []
    })).resolves.toBe('stale');

    expect(harness.records.get('players/player-1')).toMatchObject({
      premium: { status: 'active', lastRevenueCatEventId: 'newer-event' },
      subscriptionStatus: 'active'
    });
    expect(harness.writes.filter((write) => write.path === 'players/player-1')).toHaveLength(0);
  });

  it('claims but does not apply a delayed RevenueCat event for a deleted player', async () => {
    const markerPath = deletionGuard.playerDeletionMarkerPath('player-1');
    const harness = createFirestoreHarness({ [markerPath]: { status: 'blocked' } });
    const event = {
      id: 'late-revenuecat-event',
      type: 'RENEWAL',
      app_user_id: 'player-1',
      event_timestamp_ms: 1_786_406_400_000,
      expiration_at_ms: 1_789_084_800_000,
      product_id: 'legacy-premium'
    };

    await expect(applyRevenueCatEvent(harness.database, harness.admin, event, {
      entitlementId: 'player_premium',
      entitlementIds: ['player_premium']
    })).resolves.toBe('deleted-player');

    expect(harness.records.has('players/player-1')).toBe(false);
    expect(harness.writes.filter((write) => write.path === 'players/player-1')).toEqual([]);
    const eventWrite = harness.writes.find((write) => write.path.startsWith('webhookEvents/revenuecat_'));
    expect(eventWrite?.value).toMatchObject({ provider: 'revenuecat', outcome: 'deleted-player' });
    expect(JSON.stringify(eventWrite?.value)).not.toContain('player-1');
  });
});
