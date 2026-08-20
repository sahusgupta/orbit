import { afterEach, describe, expect, it, vi } from 'vitest';
import publisher from './firebasePublisher.js';

afterEach(() => vi.unstubAllGlobals());

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

  it('uses the flat room time fee instead of a legacy per-game rate', () => {
    const players = publisher.buildCanonicalPlayerDocs({
      ...state,
      settings: {
        ...state.settings,
        defaultHourlyFee: 10,
        collectionProfiles: [{
          gameId: 'nlh',
          collectionMode: 'Time',
          hourlyFee: 99,
          estimatedDropPerSeatHour: 7
        }]
      },
      games: [{ id: 'nlh', name: '1/2 NLH' }],
      sessions: [{ id: 'table-1', gameId: 'nlh' }],
      playerSessions: [{
        id: 'session-1',
        profileId: 'player_123',
        playerName: 'Test Player',
        gameId: 'nlh',
        tableId: 'table-1',
        seatedAt: '2026-07-18T00:00:00.000Z',
        leftAt: '2026-07-18T00:30:00.000Z',
        timePurchasedMinutes: 30
      }]
    }, 'lic_test', '2026-07-18T01:00:00.000Z');

    expect(players[0].contribution).toMatchObject({
      timeFeeContribution: 5,
      estimatedDropContribution: 0,
      recordedDropContribution: 0
    });
  });

  it('preserves exact time purchases across rate changes without dropping the initial fee', () => {
    const players = publisher.buildCanonicalPlayerDocs({
      ...state,
      settings: {
        ...state.settings,
        defaultHourlyFee: 12,
        collectionProfiles: [{
          gameId: 'nlh',
          collectionMode: 'Time',
          hourlyFee: 99,
          estimatedDropPerSeatHour: 7
        }]
      },
      games: [{ id: 'nlh', name: '1/2 NLH' }],
      sessions: [{ id: 'table-1', gameId: 'nlh' }],
      playerSessions: [{
        id: 'session-1',
        profileId: 'player_123',
        playerName: 'Test Player',
        gameId: 'nlh',
        tableId: 'table-1',
        seatedAt: '2026-07-18T00:00:00.000Z',
        leftAt: '2026-07-18T01:30:00.000Z',
        timePurchasedMinutes: 90
      }],
      timeFeeLogs: [{
        id: 'initial-time',
        playerSessionId: 'session-1',
        tableId: 'table-1',
        gameId: 'nlh',
        playerName: 'Test Player',
        minutes: 60,
        amount: 10,
        timestamp: '2026-07-18T00:00:00.000Z'
      }, {
        id: 'added-time',
        playerSessionId: 'session-1',
        tableId: 'table-1',
        gameId: 'nlh',
        playerName: 'Test Player',
        minutes: 30,
        amount: 6,
        timestamp: '2026-07-18T00:45:00.000Z'
      }]
    }, 'lic_test', '2026-07-18T02:00:00.000Z');

    expect(players[0].contribution.timeFeeContribution).toBe(16);
  });

  it('migrates a missing room fee from one legacy time profile for every game', () => {
    const players = publisher.buildCanonicalPlayerDocs({
      ...state,
      settings: {
        ...state.settings,
        defaultHourlyFee: undefined,
        collectionProfiles: [
          { gameId: 'holdem', collectionMode: 'Time', hourlyFee: 12, estimatedDropPerSeatHour: 0 },
          { gameId: 'omaha', collectionMode: 'Time', hourlyFee: 99, estimatedDropPerSeatHour: 0 }
        ]
      },
      games: [{ id: 'omaha', name: '1/2 PLO' }],
      sessions: [{ id: 'table-1', gameId: 'omaha' }],
      playerSessions: [{
        id: 'session-1',
        profileId: 'player_123',
        playerName: 'Test Player',
        gameId: 'omaha',
        tableId: 'table-1',
        seatedAt: '2026-07-18T00:00:00.000Z',
        leftAt: '2026-07-18T00:30:00.000Z',
        timePurchasedMinutes: 30
      }]
    }, 'lic_test', '2026-07-18T01:00:00.000Z');

    expect(players[0].contribution.timeFeeContribution).toBe(6);
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

  it('builds projection writes without carrying authoritative state JSON', () => {
    const write = publisher.buildBatchUpdate('project-1', 'clubStates/club-1', {
      accountKey: 'club-1',
      schemaVersion: 5,
      deprecated: true
    });
    expect(write).toMatchObject({
      update: {
        name: 'projects/project-1/databases/(default)/documents/clubStates/club-1',
        fields: {
          accountKey: { stringValue: 'club-1' },
          schemaVersion: { integerValue: '5' },
          deprecated: { booleanValue: true }
        }
      }
    });
    expect(JSON.stringify(write)).not.toContain('state_json');
  });

  it('publishes projection documents in provider-bounded batches instead of one request per document', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const writes = Array.from({ length: 501 }, (_value, index) => ({ delete: `documents/${index}` }));

    await expect(publisher.batchWriteDocuments('project-1', 'token', writes)).resolves.toBe(501);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).writes.length)).toEqual([250, 250, 1]);
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
