import { createMembershipWindow, parseMembershipPrice } from '../../lib/membership';
import type { AppState, PlayerInAppNotification, PlayerProfile } from '../../domain/types';

const notificationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export type MembershipCommandContext = {
  accountKey: string;
  clubDisplayName: string;
  staffId?: string;
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

const identityRequirementSatisfied = (profile: PlayerProfile) =>
  profile.identityReviewStatus === 'Approved' || profile.identityReviewStatus === 'Not required' || !profile.identityReviewStatus;

const paymentRequirementSatisfied = (profile: PlayerProfile) =>
  profile.membershipPaymentStatus === 'Paid' || profile.membershipPaymentStatus === 'Not required' || !profile.membershipPaymentStatus;

const deterministicManualTransactionId = (profile: PlayerProfile) =>
  `membership:${profile.id}:${profile.membershipRequestedAt || 'legacy'}:in-person`;

function activateMembershipWhenReady(
  state: AppState,
  profileId: string,
  context: MembershipCommandContext,
  dependencies: Pick<MembershipCommandDependencies, 'createId' | 'nowDate'>
): { state: AppState; activated: boolean } {
  const profile = state.profiles.find((candidate) => candidate.id === profileId);
  if (!profile || profile.membershipStatus === 'Active') return { state, activated: false };
  if (!identityRequirementSatisfied(profile) || !paymentRequirementSatisfied(profile)) return { state, activated: false };
  const plan = profile.membershipPlan || 'monthly';
  const membership = createMembershipWindow(plan, dependencies.nowDate(), profile.membershipDurationDays);
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
    activated: true,
    state: {
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id
        ? {
            ...candidate,
            membershipStartDate: membership.startDate,
            membershipExpirationDate: membership.expirationDate,
            membershipExpiresAt: membership.expiresAt.toISOString(),
            membershipStatus: 'Active' as const
          }
        : candidate),
      inAppNotifications: prependNotification(state, notification, activatedAt)
    }
  };
}

export function approvePlayerIdentity(
  state: AppState,
  profile: PlayerProfile,
  context: MembershipCommandContext,
  dependencies: Pick<MembershipCommandDependencies, 'createId' | 'nowDate'>
): MembershipCommandFailure | { ok: true; state: AppState; message: string } {
  if (profile.identityReviewStatus !== 'Pending') {
    return { ok: false, state, message: `${profile.name}'s ID is not awaiting review.` };
  }
  const reviewedAt = dependencies.nowDate().toISOString();
  const reviewedState: AppState = {
    ...state,
    profiles: state.profiles.map((candidate) => candidate.id === profile.id
      ? {
          ...candidate,
          identityReviewStatus: 'Approved',
          identityReviewedAt: reviewedAt,
          identityReviewedByStaffId: context.staffId
        }
      : candidate)
  };
  const activation = activateMembershipWhenReady(reviewedState, profile.id, context, dependencies);
  return {
    ok: true,
    state: activation.state,
    message: activation.activated
      ? `${profile.name}'s ID is approved and membership is active.`
      : `${profile.name}'s ID is approved. Payment is still required.`
  };
}

export function markMembershipPaidInPerson(
  state: AppState,
  profile: PlayerProfile,
  context: MembershipCommandContext,
  dependencies: Pick<MembershipCommandDependencies, 'createId' | 'nowDate'>
): MembershipCommandFailure | { ok: true; state: AppState; message: string } {
  if (profile.membershipPaymentStatus === 'Paid') {
    return { ok: true, state, message: `${profile.name}'s membership payment was already recorded.` };
  }
  if (profile.membershipPaymentStatus === 'Not required') {
    const activation = activateMembershipWhenReady(state, profile.id, context, dependencies);
    return {
      ok: true,
      state: activation.state,
      message: activation.activated
        ? `${profile.name}'s no-fee membership is active.`
        : `${profile.name}'s membership has no fee. ID approval is still required.`
    };
  }
  if (profile.membershipPaymentMethod === 'app') {
    return { ok: false, state, message: `${profile.name} selected online payment and cannot be charged manually.` };
  }
  const amountCents = profile.membershipPaymentAmountCents ?? Math.round(parseMembershipPrice(profile.membershipPriceLabel) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return {
      ok: false,
      state,
      message: `A valid membership amount is required before marking ${profile.name} paid.`
    };
  }
  const transactionId = profile.membershipPaymentTransactionId || deterministicManualTransactionId(profile);
  const paidAt = dependencies.nowDate().toISOString();
  const hasTransaction = state.revenueTransactions.some((transaction) => transaction.id === transactionId);
  const paidState: AppState = {
    ...state,
    profiles: state.profiles.map((candidate) => candidate.id === profile.id
      ? {
          ...candidate,
          membershipPaymentMethod: 'in-person',
          membershipPaymentStatus: 'Paid',
          membershipPaymentTransactionId: transactionId,
          membershipPaymentAmountCents: amountCents
        }
      : candidate),
    revenueTransactions: amountCents > 0 && !hasTransaction
      ? [
          ...state.revenueTransactions,
          {
            id: transactionId,
            type: 'membership',
            amountCents,
            occurredAt: paidAt,
            paymentStatus: 'paid',
            source: 'manual',
            playerId: profile.id,
            playerName: profile.name,
            membershipPlan: profile.membershipPlan || 'monthly'
          }
        ]
      : state.revenueTransactions
  };
  const activation = activateMembershipWhenReady(paidState, profile.id, context, dependencies);
  return {
    ok: true,
    state: activation.state,
    message: activation.activated
      ? `${profile.name}'s payment is recorded and membership is active.`
      : `${profile.name}'s payment is recorded. ID approval is still required.`
  };
}

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
    return { ok: false, state, message: `Approve ${profile.name}'s application before recording payment.` };
  }
  return markMembershipPaidInPerson(state, profile, context, dependencies);
}
