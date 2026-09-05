import { describe, expect, it } from 'vitest';
import { createMembershipRequest, createOpaquePlayerId, createWaitlistRequest, type PlayerAccount } from './playerSync';

const player: PlayerAccount = {
  id: 'player-secret-source', name: 'Alex Rivera', email: 'alex.secret@example.test', preferredGameIds: []
};

describe('opaque Player identifiers', () => {
  it('creates unique allowed identifiers without embedding identity or entity keys', () => {
    const membership = createMembershipRequest(player, 'club-secret-source', '2026-08-09T12:00:00.000Z', {
      planId: 'annual-option', planName: 'Annual access', membershipDurationDays: 365
    });
    const waitlist = createWaitlistRequest(player, 'club-secret-source', 'game-secret-source', { requestedAt: '2026-08-09T12:00:00.000Z' });
    const ids = [membership.id, waitlist.id, createOpaquePlayerId(), createOpaquePlayerId(), createOpaquePlayerId('identity')];
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => {
      expect(id).toMatch(/^[A-Za-z0-9._:-]{8,180}$/);
      expect(id).not.toMatch(/alex|secret|example|club|game/i);
    });
  });
});
