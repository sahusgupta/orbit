import { createMembershipWindow, parseMembershipPrice } from '../../lib/membership';
import type { AppState, PlayerInAppNotification, PlayerProfile } from '../../domain/types';

const notificationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type MembershipCommandContext = {
  accountKey: string;
  clubDisplayName: string;
};

export type MembershipCommandDependencies = {
  createId: () => string;
  nowDate: () => Date;
  nowIso: () => string;
  nowMs: () => number;
};

export type MembershipCommandFailure = {
  ok: false;
  state: AppState;
  message?: string;
};

const prependNotification = (
  state: AppState,
  notification: PlayerInAppNotification,
  cutoff: string
) => [
  notification,
  ...state.inAppNotifications
    .filter((candidate) => !candidate.expiresAt || candidate.expiresAt > cutoff)
    .slice(0, 200)
];

export function approveMembershipRequest(
  state: AppState,
  profile: PlayerProfile,
  context: MembershipCommandContext,
  dependencies: Pick<MembershipCommandDependencies, 'createId' | 'nowIso' | 'nowMs'>
): MembershipCommandFailure | { ok: true; state: AppState; message: string } {
  if (profile.membershipStatus !== 'Requested') return { ok: false, state };
  const approvedAt = dependencies.nowIso();
  const notification: PlayerInAppNotification = {
    id: dependencies.createId(),
    clubId: context.accountKey,
    gameId: '',
    title: 'Membership approved',
    body: `${context.clubDisplayName} approved your application. Bring your ID and pay the club's fee at the front desk to activate it.`,
    reason: 'membership-approved',
    createdAt: approvedAt,
    expiresAt: new Date(dependencies.nowMs() + notificationLifetimeMs).toISOString(),
    targetPlayerIds: [profile.id],
    targetPlayerNames: [profile.name]
  };
  return {
    ok: true,
    message: `${profile.name} is approved. Verify ID and payment at the front desk to activate.`,
    state: {
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id
        ? {
            ...candidate,
            membershipStatus: 'Approved',
            membershipStartDate: '',
            membershipExpirationDate: '',
            membershipExpiresAt: undefined
          }
        : candidate),
      inAppNotifications: prependNotification(state, notification, approvedAt)
    }
  };
}

export function activateInPersonMembership(
  state: AppState,
  profile: PlayerProfile,
  context: MembershipCommandContext,
  dependencies: Pick<MembershipCommandDependencies, 'createId' | 'nowDate'>
): MembershipCommandFailure | { ok: true; state: AppState; message: string } {
  if (profile.membershipStatus !== 'Approved') {
    return {
      ok: false,
      state,
      message: `Approve ${profile.name}'s application before activating the membership.`
    };
  }
  const plan = profile.membershipPlan || 'monthly';
  const membership = createMembershipWindow(plan, dependencies.nowDate(), profile.membershipDurationDays);
  const amount = parseMembershipPrice(profile.membershipPriceLabel);
  const activatedAt = membership.startedAt.toISOString();
  const notification: PlayerInAppNotification = {
    id: dependencies.createId(),
    clubId: context.accountKey,
    gameId: '',
    title: 'Membership active',
    body: `Your membership at ${context.clubDisplayName} is active. You can now request seats from the player app.`,
    reason: 'membership-activated',
    createdAt: activatedAt,
    expiresAt: new Date(membership.startedAt.getTime() + notificationLifetimeMs).toISOString(),
    targetPlayerIds: [profile.id],
    targetPlayerNames: [profile.name]
  };
  return {
    ok: true,
    message: `${profile.name}'s ${profile.membershipPlan === 'day' ? 'day pass' : 'monthly membership'} is active.`,
    state: {
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id
        ? {
            ...candidate,
            membershipStartDate: membership.startDate,
            membershipExpirationDate: membership.expirationDate,
            membershipExpiresAt: membership.expiresAt.toISOString(),
            membershipPaymentMethod: 'in-person',
            membershipStatus: 'Active'
          }
        : candidate),
      revenueTransactions: amount > 0
        ? [
            ...state.revenueTransactions,
            {
              id: dependencies.createId(),
              type: 'membership',
              amountCents: Math.round(amount * 100),
              occurredAt: activatedAt,
              paymentStatus: 'paid',
              source: 'manual',
              playerId: profile.id,
              playerName: profile.name,
              membershipPlan: plan
            }
          ]
        : state.revenueTransactions,
      inAppNotifications: prependNotification(state, notification, activatedAt)
    }
  };
}
