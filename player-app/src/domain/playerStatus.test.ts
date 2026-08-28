import { describe, expect, it } from 'vitest';
import {
  formatPassCountdown,
  getApprovedMembershipActivationCopy,
  getPlayerGameStatusLabel,
  getWaitlistAheadText,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry
} from './playerSync';

const player = { id: 'player-1', name: 'Alex', email: 'alex@example.com', preferredGameIds: [] };

describe('player membership and waitlist status', () => {
  it('matches memberships and waitlist entries by stable player identity', () => {
    const membership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'PLAYER-1', playerName: 'Someone Else', status: 'Active' as const,
      joinedAt: '2026-05-20T12:00:00.000Z', loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 }, preferredGameIds: []
    };
    const entry = { id: 'wait-1', clubId: 'club-1', gameId: 'game-1', playerName: 'alex', status: 'Interested' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z' };
    expect(isPlayerMembership(membership, player)).toBe(true);
    expect(isPlayerWaitlistEntry(entry, player)).toBe(true);
  });

  it('does not use a same-name fallback when a record belongs to another stable player ID', () => {
    const foreignMembership = {
      id: 'membership-2', clubId: 'club-1', playerId: 'player-2', playerName: 'Alex', status: 'Active' as const,
      joinedAt: '2026-05-20T12:00:00.000Z', loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 }, preferredGameIds: []
    };
    const foreignWaitlist = {
      id: 'wait-2', clubId: 'club-1', gameId: 'game-1', playerId: 'player-2', playerName: 'Alex',
      status: 'Interested' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z'
    };
    const legacyMembership = { ...foreignMembership, id: 'membership-legacy', playerId: '' };
    const legacyWaitlist = { ...foreignWaitlist, id: 'wait-legacy', playerId: undefined };

    expect(isPlayerMembership(foreignMembership, player)).toBe(false);
    expect(isPlayerWaitlistEntry(foreignWaitlist, player)).toBe(false);
    expect(isPlayerMembership(legacyMembership, player)).toBe(true);
    expect(isPlayerWaitlistEntry(legacyWaitlist, player)).toBe(true);
  });

  it('preserves active and expired pass behavior and countdown labels', () => {
    const membership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Active' as const,
      joinedAt: '2026-05-20T12:00:00.000Z', expiresAt: '2026-05-21T14:30:00.000Z', loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 }, preferredGameIds: []
    };
    const now = Date.parse('2026-05-20T12:00:00.000Z');
    expect(isMembershipCurrentlyActive(membership, now)).toBe(true);
    expect(formatPassCountdown(membership.expiresAt, now)).toBe('1d 2h 30m remaining');
    expect(isMembershipCurrentlyActive(membership, Date.parse('2026-05-22T12:00:00.000Z'))).toBe(false);
  });

  it('describes approved membership gates from authoritative payment and ID status', () => {
    const baseMembership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Approved' as const,
      joinedAt: '2026-05-20', loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 }, preferredGameIds: []
    };

    expect(getApprovedMembershipActivationCopy({
      ...baseMembership,
      paymentMethod: 'app',
      paymentStatus: 'Paid',
      identityReviewStatus: 'Pending'
    })).toEqual({
      title: 'Payment received · ID review needed',
      body: 'Bring your physical ID to the front desk. Staff will activate your access after approving it.'
    });
    expect(getApprovedMembershipActivationCopy({
      ...baseMembership,
      paymentMethod: 'in-person',
      paymentStatus: 'Pending',
      identityReviewStatus: 'Pending'
    })).toEqual({
      title: 'Bring your ID and pay in person',
      body: 'Staff must approve your physical ID and confirm payment before activating your access.'
    });
  });

  it('preserves player-facing waitlist wording', () => {
    const confirmed = { id: 'wait-1', clubId: 'club-1', gameId: 'game-1', playerName: 'Alex', status: 'Confirmed Coming' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z' };
    expect(getWaitlistAheadText(confirmed)).toBe('Confirmed coming - Core has your RSVP.');
    expect(getPlayerGameStatusLabel(confirmed)).toBe('Confirmed coming');
  });
});
