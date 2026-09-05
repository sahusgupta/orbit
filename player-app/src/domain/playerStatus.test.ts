import { describe, expect, it } from 'vitest';
import {
  formatPassCountdown,
  getApprovedMembershipActivationCopy,
  getPlayerSeatRequestAccess,
  getPlayerGameStatusLabel,
  getPublishedMembershipPlanLabel,
  getWaitlistAheadText,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  isTournamentInterestOpen
} from './playerSync';

const player = { id: 'player-1', name: 'Alex', email: 'alex@example.com', preferredGameIds: [] };
const loyalty = { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New' as const, nextTierAtHours: 12 };

describe('player membership and waitlist status', () => {
  it('matches memberships and waitlist entries only by stable player identity', () => {
    const membership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'PLAYER-1', playerName: 'Someone Else', status: 'Active' as const,
      joinedAt: '2026-05-20T12:00:00.000Z', loyalty, preferredGameIds: []
    };
    const entry = {
      id: 'wait-1', clubId: 'club-1', gameId: 'game-1', playerId: 'PLAYER-1', playerName: 'Someone Else',
      status: 'Interested' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z'
    };
    expect(isPlayerMembership(membership, player)).toBe(true);
    expect(isPlayerWaitlistEntry(entry, player)).toBe(true);
    expect(isPlayerMembership({ ...membership, id: 'foreign', playerId: 'player-2', playerName: 'Alex' }, player)).toBe(false);
    expect(isPlayerWaitlistEntry({ ...entry, id: 'foreign', playerId: 'player-2', playerName: 'Alex' }, player)).toBe(false);
    expect(isPlayerMembership({ ...membership, id: 'legacy', playerId: '' }, player)).toBe(false);
    expect(isPlayerWaitlistEntry({ ...entry, id: 'legacy', playerId: undefined }, player)).toBe(false);
  });

  it('preserves active and expired pass behavior and countdown labels', () => {
    const membership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Active' as const,
      joinedAt: '2026-05-20T12:00:00.000Z', expiresAt: '2026-05-21T14:30:00.000Z', loyalty, preferredGameIds: []
    };
    const now = Date.parse('2026-05-20T12:00:00.000Z');
    expect(isMembershipCurrentlyActive(membership, now)).toBe(true);
    expect(formatPassCountdown(membership.expiresAt, now)).toBe('1d 2h 30m remaining');
    expect(isMembershipCurrentlyActive(membership, Date.parse('2026-05-22T12:00:00.000Z'))).toBe(false);
  });

  it('classifies new seat-request access from the same active, unexpired membership boundary', () => {
    const baseMembership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex',
      joinedAt: '2026-05-20T12:00:00.000Z', loyalty, preferredGameIds: []
    };
    const now = Date.parse('2026-05-20T12:00:00.000Z');
    const access = (membership?: typeof baseMembership & {
      status: 'Requested' | 'Approved' | 'Active' | 'Expired';
      expiresAt?: string;
    }) => getPlayerSeatRequestAccess({ memberships: membership ? [membership] : [] }, player, now);

    expect(access({ ...baseMembership, status: 'Requested' })).toBe('pending');
    expect(access({ ...baseMembership, status: 'Approved' })).toBe('pending');
    expect(access({ ...baseMembership, status: 'Active', expiresAt: '2026-05-21T12:00:00.000Z' })).toBe('active');
    expect(access({ ...baseMembership, status: 'Active', expiresAt: '2026-05-20T12:00:00.000Z' })).toBe('renewal');
    expect(access({ ...baseMembership, status: 'Expired' })).toBe('renewal');
    expect(access()).toBe('missing');
  });

  it('uses only venue/staff language for approved legacy payment states', () => {
    const baseMembership = {
      id: 'membership-1', clubId: 'club-1', playerId: 'player-1', playerName: 'Alex', status: 'Approved' as const,
      joinedAt: '2026-05-20', loyalty, preferredGameIds: []
    };
    expect(getApprovedMembershipActivationCopy({ ...baseMembership, paymentMethod: 'app', paymentStatus: 'Paid', identityReviewStatus: 'Pending' }))
      .toEqual({
        title: 'Physical ID review needed',
        body: 'Bring your physical ID. Venue staff will confirm any fee in person and publish your access status.'
      });
    const neutral = getApprovedMembershipActivationCopy({ ...baseMembership, paymentMethod: 'app', paymentStatus: 'Pending' });
    expect(neutral).toEqual({
      title: 'Confirm access with venue staff',
      body: 'Venue staff will confirm any fee in person and publish the membership status shown here.'
    });
    expect(JSON.stringify(neutral)).not.toMatch(/stripe|online payment/i);
  });

  it('renders only a venue-published membership plan name', () => {
    expect(getPublishedMembershipPlanLabel({ planName: 'Seven-day summer access' })).toBe('Seven-day summer access');
    expect(getPublishedMembershipPlanLabel({})).toBe('Membership access');
  });

  it('preserves player-facing waitlist wording', () => {
    const confirmed = {
      id: 'wait-1', clubId: 'club-1', gameId: 'game-1', playerId: 'player-1', playerName: 'Alex',
      status: 'Confirmed Coming' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z'
    };
    expect(getWaitlistAheadText(confirmed)).toBe('Confirmed coming - Core has your RSVP.');
    expect(getPlayerGameStatusLabel(confirmed)).toBe('Confirmed coming');
  });

  it('treats tournament interest as open only during the operator-enabled pre-start window', () => {
    const event = {
      id: 'event-1', clubId: 'club-1', name: 'Event', startsAt: '2026-05-21T18:00:00.000Z',
      interestOpensAt: '2026-05-20T10:00:00.000Z', interestClosesAt: '2026-05-21T17:00:00.000Z',
      interestStatus: 'open' as const, rebuysAllowed: false, addOnsAllowed: false, rules: [], withdrawalAllowed: true
    };
    expect(isTournamentInterestOpen(event, Date.parse('2026-05-20T09:59:59.000Z'))).toBe(false);
    expect(isTournamentInterestOpen(event, Date.parse('2026-05-20T10:00:00.000Z'))).toBe(true);
    expect(isTournamentInterestOpen(event, Date.parse('2026-05-21T17:00:00.000Z'))).toBe(false);
    expect(isTournamentInterestOpen({ ...event, interestStatus: 'closed' }, Date.parse('2026-05-20T12:00:00.000Z'))).toBe(false);
    expect(isTournamentInterestOpen({ ...event, startsAt: '2026-05-20T11:00:00.000Z', interestClosesAt: '2026-05-22T00:00:00.000Z' }, Date.parse('2026-05-20T12:00:00.000Z'))).toBe(false);
  });
});
