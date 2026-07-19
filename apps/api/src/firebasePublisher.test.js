import { describe, expect, it } from 'vitest';
import publisher from './firebasePublisher.js';

describe('canonical Firestore club layout', () => {
  const state = {
    settings: {
      clubAccount: { clubName: 'Orbit Test Club', email: 'owner@example.com' },
      pilotAccess: { licenseId: 'lic_test', expiresAt: '2099-01-01' },
      collectionProfiles: []
    },
    profiles: [{
      id: 'player_123',
      name: 'Test Player',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2099-01-01',
      totalTimePlayedHours: 10
    }],
    games: [],
    sessions: [],
    playerSessions: [],
    buyIns: [],
    drops: []
  };

  it('uses the Orbit player id as the players subcollection document id', () => {
    const players = publisher.buildCanonicalPlayerDocs(state, 'lic_test', '2026-07-18T00:00:00.000Z');
    expect(players).toHaveLength(1);
    expect(players[0].id).toBe('player_123');
    expect(players[0].sourceProfileId).toBe('player_123');
  });

  it('does not duplicate membership players on the parent club document', () => {
    const players = publisher.buildCanonicalPlayerDocs(state, 'lic_test', '2026-07-18T00:00:00.000Z');
    const club = publisher.buildCanonicalClubDoc(
      state,
      'lic_test',
      { club: { name: 'Orbit Test Club' } },
      players,
      '2026-07-18T00:00:00.000Z'
    );
    expect(club).not.toHaveProperty('playersWithMemberships');
    expect(club.playerCount).toBe(1);
    expect(club.activeMembershipCount).toBe(1);
  });
});
