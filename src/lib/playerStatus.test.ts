import { describe, expect, it } from 'vitest';
import {
  formatPassCountdown,
  getPlayerGameStatusLabel,
  getWaitlistAheadText,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry
} from '../../player-app/src/domain/playerSync';

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

  it('preserves player-facing waitlist wording', () => {
    const confirmed = { id: 'wait-1', clubId: 'club-1', gameId: 'game-1', playerName: 'Alex', status: 'Confirmed Coming' as const, position: 2, requestedAt: '2026-05-20T12:00:00.000Z' };
    expect(getWaitlistAheadText(confirmed)).toBe('Confirmed coming - Core has your RSVP.');
    expect(getPlayerGameStatusLabel(confirmed)).toBe('Confirmed coming');
  });
});
