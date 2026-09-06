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

  it('never attributes sessions to a profile by a colliding display name', () => {
    const [player] = publisher.buildCanonicalPlayerDocs({
      ...state,
      profiles: [{ id: 'target-profile', name: 'Same Name', totalTimePlayedHours: 0 }],
      games: [{ id: 'holdem', name: 'Holdem' }],
      playerSessions: [{
        id: 'unlinked-session', playerName: 'Same Name', gameId: 'holdem', tableId: 'table-one',
        seatedAt: '2026-09-04T10:00:00.000Z', leftAt: '2026-09-04T12:00:00.000Z'
      }]
    }, 'club-one', '2026-09-04T13:00:00.000Z');

    expect(player.totalHoursPlayed).toBe(0);
    expect(player.gamesPlayed).toEqual([]);
    expect(player.dateJoined).toBe('');
  });

  it('publishes only factual tournament fields and preserves explicit zero values', () => {
    const tournaments = publisher.buildPlayerTournamentDocs({
      tournaments: [{
        id: 'event-zero',
        name: 'No-cost interest event',
        status: 'Draft',
        scheduledAt: '2026-10-01T18:00:00.000Z',
        registrationOpensAt: '2026-09-01T18:00:00.000Z',
        registrationClosesAt: '2026-10-01T17:00:00.000Z',
        registrationStatus: 'unexpected-status',
        buyIn: 0,
        startingStack: 0,
        rebuysAllowed: true,
        rebuyPrice: 0,
        rebuyStack: 0,
        unlimitedRebuys: false,
        addOnsAllowed: true,
        addOnPrice: 0,
        addOnStack: 0,
        levels: [{ durationMinutes: 0 }],
        players: []
      }]
    }, 'club-one', '2026-09-01T12:00:00.000Z', Date.parse('2026-09-01T12:00:00.000Z'));
    expect(tournaments).toEqual([expect.objectContaining({
      id: 'event-zero',
      buyIn: 0,
      buyInPublished: true,
      startingStack: 0,
      levelMinutes: 0,
      rebuysAllowed: true,
      rebuyPrice: 0,
      rebuyStack: 0,
      unlimitedRebuys: false,
      addOnsAllowed: true,
      addOnPrice: 0,
      addOnStack: 0,
      interestStatus: 'closed'
    })]);
    expect(tournaments[0]).not.toHaveProperty('prizePoolLabel');
  });

  it('omits malformed tournaments and never infers rebuy/add-on facts from prices', () => {
    const base = {
      id: 'event-one',
      name: 'Published event',
      status: 'Draft',
      scheduledAt: '2026-10-01T18:00:00.000Z',
      registrationOpensAt: '2026-09-01T18:00:00.000Z',
      registrationClosesAt: '2026-10-01T17:00:00.000Z',
      buyIn: 100,
      startingStack: 20_000,
      rebuyPrice: 100,
      addOnPrice: 50,
      players: []
    };
    const tournaments = publisher.buildPlayerTournamentDocs({
      tournaments: [
        base,
        { ...base, id: 'missing-start', scheduledAt: undefined },
        { ...base, id: 'null-buy-in', buyIn: null },
        { ...base, id: 'empty-buy-in', buyIn: '' },
        { ...base, id: 'null-stack', startingStack: null },
        { ...base, id: 'close-after-start', registrationClosesAt: '2026-10-01T19:00:00.000Z' }
      ]
    }, 'club-one', '2026-09-01T12:00:00.000Z', Date.parse('2026-09-01T12:00:00.000Z'));
    expect(tournaments).toHaveLength(1);
    expect(tournaments[0]).toMatchObject({ rebuysAllowed: false, addOnsAllowed: false, unlimitedRebuys: false });
    expect(tournaments[0]).not.toHaveProperty('rebuyPrice');
    expect(tournaments[0]).not.toHaveProperty('addOnPrice');
  });

  it('does not coerce missing optional tournament numbers to published zero', () => {
    const [tournament] = publisher.buildPlayerTournamentDocs({ tournaments: [{
      id: 'event-one', name: 'Published event', status: 'Draft', scheduledAt: '2026-10-01T18:00:00.000Z',
      registrationOpensAt: '2026-09-01T18:00:00.000Z', registrationClosesAt: '2026-10-01T17:00:00.000Z',
      buyIn: 0, startingStack: 0, rebuysAllowed: true, rebuyPrice: null, rebuyStack: '',
      addOnsAllowed: true, addOnPrice: null, addOnStack: '', levels: [{ durationMinutes: null }],
      players: [{ id: 'entrant-one', rebuys: null, addOns: '' }]
    }] }, 'club-one', '2026-09-01T12:00:00.000Z', Date.parse('2026-09-01T12:00:00.000Z'));
    expect(tournament).toMatchObject({ buyIn: 0, startingStack: 0, rebuysAllowed: true, addOnsAllowed: true });
    for (const field of ['rebuyPrice', 'rebuyStack', 'addOnPrice', 'addOnStack', 'levelMinutes', 'totalRebuys', 'totalAddOns', 'prizePoolLabel']) {
      expect(tournament).not.toHaveProperty(field);
    }
  });

  it('publishes only upcoming Draft tournaments and preserves operator intent across clock boundaries', () => {
    const base = {
      name: 'Published event', status: 'Draft', registrationStatus: 'open',
      scheduledAt: '2026-09-10T18:00:00.000Z',
      registrationOpensAt: '2026-09-01T18:00:00.000Z',
      registrationClosesAt: '2026-09-09T18:00:00.000Z',
      buyIn: 100, startingStack: 20_000, players: []
    };
    const tournaments = publisher.buildPlayerTournamentDocs({ tournaments: [
      { ...base, id: 'draft-open' },
      { ...base, id: 'future-not-open', registrationOpensAt: '2026-09-05T18:00:00.000Z' },
      { ...base, id: 'expired', registrationClosesAt: '2026-09-03T18:00:00.000Z' },
      { ...base, id: 'running', status: 'Running' },
      { ...base, id: 'paused', status: 'Paused' },
      { ...base, id: 'finished', status: 'Finished' },
      { ...base, id: 'past-draft', scheduledAt: '2026-09-03T18:00:00.000Z' }
    ] }, 'club-one', '2026-09-04T18:00:00.000Z', Date.parse('2026-09-04T18:00:00.000Z'));

    expect(tournaments.map(({ id, interestStatus }) => ({ id, interestStatus }))).toEqual([
      { id: 'draft-open', interestStatus: 'open' },
      { id: 'future-not-open', interestStatus: 'open' },
      { id: 'expired', interestStatus: 'open' }
    ]);

    const beforeWindow = publisher.buildPlayerTournamentDocs(
      { tournaments: [{ ...base, id: 'operator-open' }] },
      'club-one',
      '2026-08-01T00:00:00.000Z',
      Date.parse('2026-08-01T00:00:00.000Z')
    );
    const insideWindow = publisher.buildPlayerTournamentDocs(
      { tournaments: [{ ...base, id: 'operator-open' }] },
      'club-one',
      '2026-09-04T18:00:00.000Z',
      Date.parse('2026-09-04T18:00:00.000Z')
    );
    expect(beforeWindow[0].interestStatus).toBe('open');
    expect(insideWindow[0].interestStatus).toBe('open');
  });

  it('omits tournament interests with invented or malformed activity timestamps', () => {
    const valid = {
      id: 'interest-one', clubId: 'club-one', tournamentId: 'event-one', playerId: 'player-one',
      status: 'interested', createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z'
    };
    expect(publisher.buildTournamentInterestDocs({
      tournamentInterests: [valid, { ...valid, id: 'missing-created', createdAt: '' }, { ...valid, id: 'bad-updated', updatedAt: 'bad' }]
    }, 'club-one', '2099-01-01T00:00:00.000Z')).toEqual([valid]);
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

  it('never invents a public club name when the venue has not published one', () => {
    const club = publisher.buildCanonicalClubDoc(
      { ...state, settings: { ...state.settings, clubAccount: {} } },
      'club-one',
      { club: { name: '' } },
      [],
      '2026-09-04T00:00:00.000Z'
    );
    expect(club).not.toHaveProperty('name');
    expect(JSON.stringify(club)).not.toContain('Local Poker Club');
  });

  it('publishes only an explicit supported minimum age on the canonical club document', () => {
    const adultClub = publisher.buildCanonicalClubDoc(
      state,
      'club-one',
      { club: { name: 'Orbit Test Club', minimumAge: 18 } },
      [],
      '2026-09-04T00:00:00.000Z'
    );
    const malformedClub = publisher.buildCanonicalClubDoc(
      state,
      'club-one',
      { club: { name: 'Orbit Test Club', minimumAge: 19 } },
      [],
      '2026-09-04T00:00:00.000Z'
    );
    expect(adultClub.minimumAge).toBe(18);
    expect(malformedClub).not.toHaveProperty('minimumAge');
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
        },
        {
          id: 'shared-private',
          title: 'Shared alert',
          body: 'Would expose another recipient.',
          reason: 'legacy-shared',
          createdAt: '2026-08-11T00:00:00.000Z',
          targetPlayerIds: ['player-1', 'player-2'],
          targetPlayerNames: ['Alex Private', 'Other Private']
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

  it('never exposes Firebase response bodies or document paths in publication errors', async () => {
    const sensitiveBody = [
      'private.player@example.test',
      '+15551234567',
      'legacy-private-player-slug',
      `omq1_${'A'.repeat(43)}`
    ].join(' ');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn(async () => sensitiveBody)
    });
    vi.stubGlobal('fetch', fetchMock);

    let batchError;
    try {
      await publisher.batchWriteDocuments('private-project', 'private-token', [{ delete: 'private/path' }]);
    } catch (error) {
      batchError = error;
    }
    expect(batchError).toMatchObject({
      name: 'FirebasePublicationError',
      code: 'FIREBASE_PUBLICATION_FAILED',
      category: 'batch-write',
      status: 403,
      pathRef: expect.stringMatching(/^[a-f0-9]{16}$/),
      responseRef: expect.stringMatching(/^[a-f0-9]{16}$/)
    });
    expect(batchError.message).toMatch(/^Firebase publication provider failure \(category=batch-write status=403 /);

    let documentError;
    try {
      await publisher.patchDocument(
        'private-project',
        'private-token',
        'clubs/private.player@example.test/players/legacy-private-player-slug',
        { ok: true }
      );
    } catch (error) {
      documentError = error;
    }
    expect(documentError).toMatchObject({
      category: 'document-write',
      status: 403,
      pathRef: expect.stringMatching(/^[a-f0-9]{16}$/),
      responseRef: expect.stringMatching(/^[a-f0-9]{16}$/)
    });

    const serialized = JSON.stringify({ batchError, documentError, messages: [batchError.message, documentError.message] });
    for (const forbidden of [
      'private.player@example.test',
      '+15551234567',
      'legacy-private-player-slug',
      'private/path',
      'private-token',
      'omq1_'
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('removes absent API-owned projection children through paginated bounded writes', async () => {
    const resourceName = (collectionName, id) =>
      `projects/project-1/databases/(default)/documents/clubs/club-1/${collectionName}/${id}`;
    const apiDocument = (collectionName, id, syncSource = 'orbit-api') => ({
      name: resourceName(collectionName, id),
      fields: { syncSource: { stringValue: syncSource } }
    });
    const firstGamePage = [
      apiDocument('games', 'active-game'),
      apiDocument('games', 'foreign-game', 'orbit-desktop'),
      ...Array.from({ length: 498 }, (_value, index) => apiDocument('games', `stale-${index}`))
    ];
    const finalGamePage = Array.from(
      { length: 3 },
      (_value, index) => apiDocument('games', `stale-${index + 498}`)
    );
    const staleSession = apiDocument('gameSessions', 'stale-session');
    const activeSession = apiDocument('gameSessions', 'active-session');
    const staleInterest = apiDocument('tournamentInterests', 'stale-interest');
    const activeInterest = apiDocument('tournamentInterests', 'active-interest');
    const deletionBatches = [];
    const listedCollections = [];
    const fetchMock = vi.fn(async (input, init = {}) => {
      const url = String(input);
      if (url.includes(':batchWrite')) {
        deletionBatches.push(JSON.parse(init.body).writes);
        return { ok: true };
      }
      const endpoint = new URL(url);
      const collectionName = endpoint.pathname.split('/').at(-1);
      listedCollections.push(collectionName);
      if (collectionName === 'games' && endpoint.searchParams.get('pageToken') === 'next-games') {
        return { ok: true, json: async () => ({ documents: finalGamePage }) };
      }
      if (collectionName === 'games') {
        return { ok: true, json: async () => ({ documents: firstGamePage, nextPageToken: 'next-games' }) };
      }
      if (collectionName === 'gameSessions') {
        return { ok: true, json: async () => ({ documents: [activeSession, staleSession] }) };
      }
      if (collectionName === 'tournamentInterests') {
        return { ok: true, json: async () => ({ documents: [activeInterest, staleInterest] }) };
      }
      return { ok: true, json: async () => ({ documents: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(publisher.deleteStaleOwnedProjectionDocuments(
      'project-1',
      'token',
      'club-1',
      {
        games: new Set(['active-game']),
        gameSessions: new Set(['active-session']),
        tournamentInterests: new Set(['active-interest'])
      }
    )).resolves.toBe(503);

    expect(deletionBatches.map((writes) => writes.length)).toEqual([250, 250, 3]);
    const deletedNames = deletionBatches.flat().map((write) => write.delete);
    expect(deletedNames).toContain(resourceName('games', 'stale-500'));
    expect(deletedNames).not.toContain(resourceName('games', 'active-game'));
    expect(deletedNames).not.toContain(resourceName('games', 'foreign-game'));
    expect(deletedNames).toContain(resourceName('gameSessions', 'stale-session'));
    expect(deletedNames).not.toContain(resourceName('gameSessions', 'active-session'));
    expect(deletedNames).toContain(resourceName('tournamentInterests', 'stale-interest'));
    expect(deletedNames).not.toContain(resourceName('tournamentInterests', 'active-interest'));
    expect(listedCollections).toEqual([
      'players', 'games', 'games', 'gameSessions', 'memberships', 'waitlists', 'notifications', 'tournaments',
      'tournamentInterests'
    ]);
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
        openTables: [
          { id: 'table-1', status: 'Running', availableSeats: 2 },
          { id: 'table-forming', status: 'Forming', availableSeats: 7 },
          { id: 'table-paused', status: 'Paused', availableSeats: 4 }
        ],
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
    expect(games[0].openTables).toHaveLength(3);
    expect(games[0]).not.toHaveProperty('buyins');
  });
});
