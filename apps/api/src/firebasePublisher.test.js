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

  it('builds a versioned mobile commit marker', () => {
    const metadata = publisher.buildSyncMetadata(
      '2026-07-25T00:00:00.000Z',
      'revision-123',
      { games: 2, memberships: 4 }
    );

    expect(metadata).toEqual({
      syncProtocolVersion: 2,
      syncRevision: 'revision-123',
      syncSource: 'orbit-api',
      publishedAt: '2026-07-25T00:00:00.000Z',
      entityCounts: { games: 2, memberships: 4 }
    });
  });

  it('publishes player-safe game state instead of session analytics', () => {
    const games = publisher.buildPlayerGameDocs({
      games: [{
        id: 'nlh',
        name: '1/2 NLH',
        maxSeats: 9,
        openTables: [{ id: 'table-1', availableSeats: 2 }],
        waitlistCount: 1,
        formingCount: 0,
        availableSeats: 2,
        knownPlayersCount: 3
      }]
    }, 'lic_test');

    expect(games).toEqual([expect.objectContaining({
      id: 'nlh',
      clubId: 'lic_test',
      name: '1/2 NLH',
      availableSeats: 2,
      waitlistCount: 1
    })]);
    expect(games[0]).not.toHaveProperty('buyins');
  });
});
