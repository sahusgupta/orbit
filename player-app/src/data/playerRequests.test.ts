import { describe, expect, it } from 'vitest';
import type { PlayerClubSnapshot, PlayerMembershipRequest } from '../domain/playerSync';
import { applyMembershipRequest } from './playerRequests';

const snapshot: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Club One' },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-08-28T00:00:00.000Z'
};

function request(overrides: Partial<PlayerMembershipRequest> = {}): PlayerMembershipRequest {
  return {
    id: 'membership-request-1',
    type: 'membership-request',
    clubId: 'club-1',
    player: {
      id: 'player-1',
      name: 'Alex Rivera',
      email: 'alex@example.test',
      preferredGameIds: []
    },
    plan: 'monthly',
    paymentMethod: 'app',
    priceLabel: '$50',
    requestedAt: '2026-08-28T00:01:00.000Z',
    ...overrides
  };
}

describe('offline membership request projection', () => {
  it('never treats an unconfirmed app payment or unreviewed ID as active', () => {
    const membership = applyMembershipRequest(snapshot, request()).memberships[0];

    expect(membership).toMatchObject({
      status: 'Approved',
      paymentMethod: 'app',
      paymentStatus: 'Pending',
      identityReviewStatus: 'Pending'
    });
    expect(membership.expiresAt).toBeUndefined();
  });

  it('records a free plan as payment-not-required while keeping ID review pending', () => {
    const membership = applyMembershipRequest(snapshot, request({ priceLabel: 'Free' })).memberships[0];

    expect(membership).toMatchObject({
      status: 'Approved',
      paymentStatus: 'Not required',
      identityReviewStatus: 'Pending'
    });
    expect(membership.expiresAt).toBeUndefined();
  });
});
