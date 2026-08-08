import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, PlayerProfile } from '../../domain/types';
import { activateInPersonMembership, approveMembershipRequest } from './membershipCommands';

const now = '2026-08-08T20:00:00.000Z';
const profile = (overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id: 'profile-member',
  name: 'Member Player',
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2026-02-01',
  membershipPlan: 'monthly',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: 'game',
  preferredGameIds: ['game'],
  gamePlayCounts: {},
  mostPlayedGameId: 'game',
  preferredStakes: '',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: true,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: '',
  ...overrides
});
const state = (member: PlayerProfile, overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  profiles: [member],
  revenueTransactions: [],
  inAppNotifications: [],
  ...overrides
});
const context = { accountKey: 'club-key', clubDisplayName: 'Command Club' };
const dependencies = () => {
  let nextId = 0;
  return {
    createId: () => `created-${++nextId}`,
    nowDate: () => new Date(now),
    nowIso: () => now,
    nowMs: () => Date.parse(now)
  };
};

describe('management membership commands', () => {
  it('approves only requested profiles without revenue and prunes expired notifications', () => {
    const requested = profile({ membershipStatus: 'Requested', membershipExpiresAt: '2026-08-09T00:00:00.000Z' });
    const source = state(requested, {
      inAppNotifications: [
        { id: 'current', clubId: 'club', gameId: '', title: 'Current', body: '', reason: 'membership-approved', createdAt: now, expiresAt: '2026-08-09T00:00:00.000Z' },
        { id: 'expired', clubId: 'club', gameId: '', title: 'Expired', body: '', reason: 'membership-approved', createdAt: now, expiresAt: '2026-08-08T19:00:00.000Z' }
      ]
    });
    const snapshot = structuredClone(source);
    const result = approveMembershipRequest(source, requested, context, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.profiles[0]).toMatchObject({
      membershipStatus: 'Approved',
      membershipStartDate: '',
      membershipExpirationDate: '',
      membershipExpiresAt: undefined
    });
    expect(result.state.revenueTransactions).toEqual([]);
    expect(result.state.inAppNotifications.map((notification) => notification.id)).toEqual(['created-1', 'current']);
    expect(result.state.inAppNotifications[0]).toEqual({
      id: 'created-1',
      clubId: context.accountKey,
      gameId: '',
      title: 'Membership approved',
      body: "Command Club approved your application. Bring your ID and pay the club's fee at the front desk to activate it.",
      reason: 'membership-approved',
      createdAt: now,
      expiresAt: '2026-08-15T20:00:00.000Z',
      targetPlayerIds: [requested.id],
      targetPlayerNames: [requested.name]
    });
    expect(source).toEqual(snapshot);
  });

  it('returns an unchanged failure for non-requested approvals', () => {
    const active = profile({ membershipStatus: 'Active' });
    expect(approveMembershipRequest(state(active), active, context, dependencies())).toEqual({
      ok: false,
      state: state(active)
    });
  });

  it('activates approved profiles and records exact authoritative membership revenue', () => {
    const approved = profile({
      membershipStatus: 'Approved',
      membershipDurationDays: 30,
      membershipPriceLabel: '$49.00/mo'
    });
    const source = state(approved);
    const snapshot = structuredClone(source);
    const result = activateInPersonMembership(source, approved, context, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.profiles[0]).toMatchObject({
      membershipStartDate: '2026-08-08',
      membershipExpirationDate: '2026-09-07',
      membershipExpiresAt: '2026-09-07T20:00:00.000Z',
      membershipPaymentMethod: 'in-person',
      membershipStatus: 'Active'
    });
    expect(result.state.revenueTransactions).toEqual([{
      id: 'created-2',
      type: 'membership',
      amountCents: 4900,
      occurredAt: now,
      paymentStatus: 'paid',
      source: 'manual',
      playerId: approved.id,
      playerName: approved.name,
      membershipPlan: 'monthly'
    }]);
    expect(result.state.inAppNotifications[0]).toMatchObject({
      id: 'created-1',
      title: 'Membership active',
      reason: 'membership-activated',
      expiresAt: '2026-08-15T20:00:00.000Z',
      targetPlayerIds: [approved.id]
    });
    expect(source).toEqual(snapshot);
  });

  it('keeps zero-price activation revenue-free and rejects unapproved profiles explicitly', () => {
    const approved = profile({ membershipStatus: 'Approved', membershipPlan: 'day', membershipPriceLabel: '' });
    const activated = activateInPersonMembership(state(approved), approved, context, dependencies());
    expect(activated.ok).toBe(true);
    if (activated.ok) {
      expect(activated.state.revenueTransactions).toEqual([]);
      expect(activated.state.profiles[0].membershipExpirationDate).toBe('2026-08-09');
    }

    const requested = profile({ membershipStatus: 'Requested' });
    expect(activateInPersonMembership(state(requested), requested, context, dependencies())).toMatchObject({
      ok: false,
      message: "Approve Member Player's application before activating the membership."
    });
  });
});
