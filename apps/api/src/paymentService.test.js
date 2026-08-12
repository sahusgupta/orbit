import { describe, expect, it } from 'vitest';
import paymentService from './paymentService.js';

const { applyRevenueCatEvent, isVerifiedPlayerClaims, recordMembershipPayment } = paymentService;

describe('verified player identity claims', () => {
  it('accepts provider-verified email or phone claims and rejects unverified email', () => {
    expect(isVerifiedPlayerClaims({ email: 'player@example.com', email_verified: true })).toBe(true);
    expect(isVerifiedPlayerClaims({ phone_number: '+15551112222' })).toBe(true);
    expect(isVerifiedPlayerClaims({ email: 'player@example.com', email_verified: false })).toBe(false);
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
    doc: (path) => ({ path }),
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
        metadata: {
          kind: 'club_access',
          clubId: 'club-1',
          playerId: 'player-1',
          playerName: 'Alex',
          product: 'time-5'
        }
      }
    },
    ...overrides
  };
}

describe('payment webhook idempotency and ordering', () => {
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
});
