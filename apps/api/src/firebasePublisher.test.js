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

  it('publishes a strict public club projection without credentials or internal contacts', () => {
    const privateState = {
      ...state,
      settings: {
        ...state.settings,
        clubAccount: {
          clubName: 'Orbit Test Club',
          accountName: 'Private Account',
          contactName: 'Private Contact',
          email: 'private@example.com',
          phone: '+15551112222',
          address: '100 Public Table Way'
        },
        pilotAccess: {
          authorizationCode: 'TT-PILOT-1234567890ABCDEF12345678',
          licenseId: '',
          expiresAt: '2099-01-01'
        }
      }
    };
    const club = publisher.buildCanonicalClubDoc(
      privateState,
      'club-1',
      { club: { name: 'Orbit Test Club', membershipOptions: [] } },
      [],
      '2026-08-11T00:00:00.000Z'
    );

    expect(club).toMatchObject({ id: 'club-1', name: 'Orbit Test Club', address: '100 Public Table Way' });
    for (const privateField of [
      'licenseIdentifier',
      'accountName',
      'contactName',
      'phoneNumber',
      'emailAddress',
      'membershipStartedAt',
      'membershipRenewalDate',
      'membershipTier',
      'lastSessionSnapshot',
      'snapshotDownloadPath'
    ]) {
      expect(club).not.toHaveProperty(privateField);
    }
    expect(JSON.stringify(club)).not.toContain('TT-PILOT-');
  });

  it('publishes only ID-targeted notifications and removes player names', () => {
    const notifications = publisher.buildPrivatePlayerNotificationDocs({
      notifications: [
        {
          id: 'private-1',
          clubId: 'club-1',
          title: 'Seat ready',
          body: 'Your seat is ready.',
          reason: 'seat-opened',
          createdAt: '2026-08-11T00:00:00.000Z',
          targetPlayerIds: ['player-1'],
          targetPlayerNames: ['Alex Private']
        },
        {
          id: 'name-only',
          title: 'Private by name',
          body: 'Should not publish.',
          targetPlayerNames: ['Alex Private']
        }
      ]
    }, 'club-1');

    expect(notifications).toEqual([expect.objectContaining({
      id: 'private-1',
      clubId: 'club-1',
      targetPlayerIds: ['player-1']
    })]);
    expect(notifications[0]).not.toHaveProperty('targetPlayerNames');
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
