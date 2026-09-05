import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(resolve(process.cwd(), 'apps/api/src/accountDeletionService.test.js'));
const deletionService = require('./accountDeletionService.js');
const connection = require('./db/connection.js');
const reportStore = require('./db/reports.js');
const stateStore = require('./db/state.js');

const {
  anonymizeAuthoritativeStates,
  anonymizePlayerState,
  cleanupFirebasePlayer,
  cleanupLegacyClubStateRequests,
  createDeletePlayerAccountHandler,
  deleteLinkedGameSessions,
  enforcePlayerPrivacyTombstones,
  finalizePlayerDataCleanup,
  finalizePendingDeletionJobs,
  inventoryFirebasePlayer,
  readDeletionPolicy,
  redactTelemetry,
  removeNotificationRecipient,
  resumeExpiredRunningDeletionJobs,
  retainedCategories,
  scheduleDeletionFinalizationDrain,
  updateJob,
  visitQueryPages
} = deletionService;
const { firestoreDocumentId, getDatabase, resetDatabaseForTests } = connection;
const deletionGuard = require('./playerDeletionGuard.js');
const { deleteAnalyticalReportsForAccounts, reportsCollection, storeAnalyticalReport } = reportStore;
const {
  accountPath,
  legacyMutationPath,
  listHistoricalStates,
  loadState,
  publicationCollection,
  publicationPath,
  saveState
} = stateStore;

const policy = {
  financialRecords: 'anonymize',
  auditRecords: 'anonymize',
  providerRecords: 'retain'
};
const noPendingIdentityCleanup = async () => ({
  identityProviderCleanupPending: 0,
  identityProviderCleanupCompleted: 0
});

beforeEach(async () => resetDatabaseForTests());
afterEach(() => vi.unstubAllEnvs());

describe('classification-aware player account deletion', () => {
  it('deletes analytical report parents and gzip chunks only for affected accounts', async () => {
    const targetProfileId = 'private-profile-id';
    const firstTarget = await storeAnalyticalReport({
      account: { accountKey: 'Affected Room' },
      usage: { recentEvents: [{ id: 'usage-one', profileId: targetProfileId }] }
    });
    const secondTarget = await storeAnalyticalReport({
      account: { accountKey: 'affected-room' },
      usage: { recentEvents: [{ id: 'usage-two', profileId: targetProfileId }] }
    });
    const unrelated = await storeAnalyticalReport({
      account: { accountKey: 'Unrelated Room' },
      usage: { recentEvents: [{ id: 'usage-other', profileId: 'other-profile' }] }
    });
    const database = await getDatabase();
    const targetPath = `${reportsCollection}/${firstTarget.id}`;
    const targetChunks = await database.queryCollection(`${targetPath}/chunks`, { limit: 100 });
    expect(targetChunks).toHaveLength(1);
    expect(JSON.parse(gunzipSync(Buffer.concat(targetChunks.map((chunk) => chunk.data.payload))).toString('utf8')))
      .toMatchObject({ usage: { recentEvents: [{ profileId: targetProfileId }] } });

    await expect(deleteAnalyticalReportsForAccounts(['Affected Room', 'affected-room'], { database }))
      .resolves.toEqual({ deletedAnalyticalReports: 2, deletedAnalyticalReportChunks: 2 });

    for (const report of [firstTarget, secondTarget]) {
      const reportPath = `${reportsCollection}/${report.id}`;
      expect(await database.getDocument(reportPath)).toBeNull();
      expect(await database.queryCollection(`${reportPath}/chunks`, { limit: 100 })).toEqual([]);
    }
    const unrelatedPath = `${reportsCollection}/${unrelated.id}`;
    expect(await database.getDocument(unrelatedPath)).toMatchObject({ accountKey: 'unrelated-room' });
    expect(await database.queryCollection(`${unrelatedPath}/chunks`, { limit: 100 })).toHaveLength(1);
    await expect(deleteAnalyticalReportsForAccounts(['Affected Room'], { database }))
      .resolves.toEqual({ deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0 });
  });

  it('deletes every page of analytical reports and their child chunks', async () => {
    const database = await getDatabase();
    for (let index = 0; index < 101; index += 1) {
      const id = `bulk-report-${String(index).padStart(3, '0')}`;
      const reportPath = `${reportsCollection}/${id}`;
      await database.setDocument(reportPath, {
        id,
        accountKey: 'bulk-affected-account',
        chunkCount: 1,
        encoding: 'gzip-json-chunks-v1'
      });
      await database.setDocument(`${reportPath}/chunks/0000`, {
        index: 0,
        encoding: 'gzip-json-chunks-v1',
        payload: Buffer.from(`private-${index}`)
      });
    }

    await expect(deleteAnalyticalReportsForAccounts(['bulk-affected-account'], { database }))
      .resolves.toEqual({ deletedAnalyticalReports: 101, deletedAnalyticalReportChunks: 101 });
    expect(await database.queryCollection(reportsCollection, {
      filters: [{ field: 'accountKey', op: '==', value: 'bulk-affected-account' }],
      limit: 200
    })).toEqual([]);
  });

  it('deletes private game-session projections only through exact immutable identifiers', async () => {
    const database = await getDatabase();
    for (let index = 0; index < 100; index += 1) {
      await database.setDocument(`clubs/club-one/gameSessions/page-${String(index).padStart(3, '0')}`, {
        players: [{ profileId: `other-${index}`, playerName: 'Same Name' }]
      });
    }
    await database.setDocument('clubs/club-one/gameSessions/zz-linked-player', {
      players: [{ profileId: 'p1', playerName: 'Same Name' }, { profileId: 'other', playerName: 'Other' }],
      waitlist: ['Same Name'],
      buyins: [{ profileId: 'p1', playerName: 'Same Name', amount: 20 }]
    });
    await database.setDocument('clubs/club-one/gameSessions/zzz-linked-cashout', {
      players: [],
      cashOuts: [{ playerId: 'p1', playerName: 'Same Name', amount: 30 }]
    });
    const unrelated = {
      players: [{ profileId: 'p123', playerName: 'Same Name' }],
      buyins: [{ profileId: 'other', playerName: 'Same Name', amount: 40 }]
    };
    await database.setDocument('clubs/club-one/gameSessions/unrelated-same-name', unrelated);

    await expect(deleteLinkedGameSessions(database, ['club-one'], ['p1']))
      .resolves.toEqual({ deletedGameSessions: 2, affectedClubIds: ['club-one'] });
    expect(await database.getDocument('clubs/club-one/gameSessions/zz-linked-player')).toBeNull();
    expect(await database.getDocument('clubs/club-one/gameSessions/zzz-linked-cashout')).toBeNull();
    expect(await database.getDocument('clubs/club-one/gameSessions/page-099'))
      .toMatchObject({ players: [{ profileId: 'other-99' }] });
    expect(await database.getDocument('clubs/club-one/gameSessions/unrelated-same-name')).toEqual(unrelated);
  });

  it('removes reports, game sessions, and failed-publication legacy state in the deletion workflow', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const legacyState = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{
        id: 'legacy-profile', orbitPlayerId: 'firebase-uid', name: 'Same Name', email: 'private@example.test'
      }],
      settings: { clubAccount: { clubName: 'Legacy Room', email: 'legacy-room@example.test' } }
    };
    const unrelatedLegacyState = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'unrelated-profile', orbitPlayerId: 'other-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Other Room', email: 'other-room@example.test' } }
    };
    await database.setDocument('clubStates/legacy-room-example.test', {
      accountKey: 'legacy-room-example.test',
      syncSource: 'orbit-desktop-electron',
      publicationStatus: 'failed',
      publicationError: 'The public projection was not written.',
      state: legacyState,
      snapshot: { memberships: [{ playerId: 'legacy-profile', playerName: 'Same Name' }] }
    });
    await database.setDocument('clubStates/other-room-example.test', {
      accountKey: 'other-room-example.test',
      syncSource: 'orbit-desktop-electron',
      state: unrelatedLegacyState
    });
    await database.setDocument('clubs/legacy-room-example.test', { id: 'legacy-room-example.test' });
    await database.setDocument('clubs/legacy-room-example.test/gameSessions/linked-session', {
      players: [{ profileId: 'legacy-profile', playerName: 'Same Name' }],
      buyins: [{ profileId: 'legacy-profile', playerName: 'Same Name', amount: 25 }]
    });
    const unrelatedGameSession = {
      players: [{ profileId: 'unrelated-profile', playerName: 'Same Name' }]
    };
    await database.setDocument(
      'clubs/legacy-room-example.test/gameSessions/unrelated-session',
      unrelatedGameSession
    );
    const linkedReport = await storeAnalyticalReport({
      account: { accountKey: 'legacy-room-example.test' },
      usage: { recentEvents: [{ profileId: 'legacy-profile' }] }
    });
    const unrelatedReport = await storeAnalyticalReport({
      account: { accountKey: 'other-room-example.test' },
      usage: { recentEvents: [{ profileId: 'unrelated-profile' }] }
    });
    const deleteUser = vi.fn(async () => undefined);
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_subject',
      getDatabase: async () => database,
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer: async () => 0,
      areRequiredPublicationsPublished: async () => true,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      nowMs: () => now
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };

    await handler({ orbitPlayer: { uid: 'firebase-uid', auth_time: now / 1000 } }, response);

    expect(response).toMatchObject({
      statusCode: 200,
      body: {
        ok: true,
        status: 'complete',
        deletedAnalyticalReports: 1,
        deletedAnalyticalReportChunks: 1,
        deletedGameSessions: 1,
        replacedLegacyClubStates: 1
      }
    });
    expect(await database.getDocument(`${reportsCollection}/${linkedReport.id}`)).toBeNull();
    expect(await database.getDocument(`${reportsCollection}/${unrelatedReport.id}`))
      .toMatchObject({ accountKey: 'other-room-example.test' });
    expect(await database.getDocument('clubs/legacy-room-example.test/gameSessions/linked-session')).toBeNull();
    expect(await database.getDocument('clubs/legacy-room-example.test/gameSessions/unrelated-session'))
      .toEqual(unrelatedGameSession);
    expect(await database.getDocument('clubStates/legacy-room-example.test')).toEqual({
      accountKey: 'legacy-room-example.test',
      deprecated: true,
      legacyStateRemovedForPlayerDeletion: true,
      syncSource: 'orbit-account-deletion',
      updatedAt: '2026-09-04T18:00:00.000Z'
    });
    expect(await database.getDocument('clubStates/other-room-example.test'))
      .toMatchObject({ state: unrelatedLegacyState });
    expect(deleteUser).toHaveBeenCalledWith('firebase-uid');
  });

  it('re-inventories unchanged authoritative state after analytical-report cleanup fails', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const state = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'legacy-report-profile', orbitPlayerId: 'report-retry-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Retry Room', email: 'retry-room@example.test' } }
    };
    const unrelatedState = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'unrelated-profile', orbitPlayerId: 'other-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Other Retry Room', email: 'other-retry@example.test' } }
    };
    await saveState(state, { expectedRevision: 0, mutationId: 'retry-report-create' });
    await saveState(unrelatedState, { expectedRevision: 0, mutationId: 'other-retry-create' });
    const linkedReport = await storeAnalyticalReport({
      account: { accountKey: 'retry-room-example.test' },
      usage: { recentEvents: [{ profileId: 'legacy-report-profile' }] }
    });
    const unrelatedReport = await storeAnalyticalReport({
      account: { accountKey: 'other-retry-example.test' },
      usage: { recentEvents: [{ profileId: 'unrelated-profile' }] }
    });
    let rejectReportCleanup = true;
    const deleteReports = vi.fn(async (...arguments_) => {
      if (rejectReportCleanup) {
        rejectReportCleanup = false;
        throw new Error('injected analytical report deletion failure');
      }
      return deleteAnalyticalReportsForAccounts(...arguments_);
    });
    const deleteUser = vi.fn(async () => undefined);
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_report_retry',
      getDatabase: async () => database,
      inventoryFirebasePlayer: async (_database, playerId, linkedPlayerIds) => ({
        affectedClubIds: [],
        clubIds: [],
        linkedPlayerIds: [playerId, ...linkedPlayerIds],
        sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteAnalyticalReportsForAccounts: deleteReports,
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer: async () => 0,
      areRequiredPublicationsPublished: async () => true,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      nowMs: () => now
    });
    const request = { orbitPlayer: { uid: 'report-retry-uid', auth_time: now / 1000 } };
    const makeResponse = () => ({
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    });

    await expect(handler(request, makeResponse())).rejects.toThrow('injected analytical report deletion failure');
    expect((await loadState('retry-room-example.test')).state.profiles).toEqual(state.profiles);
    expect(await database.getDocument(`${reportsCollection}/${linkedReport.id}`)).not.toBeNull();
    expect(deleteUser).not.toHaveBeenCalled();

    const response = makeResponse();
    await handler(request, response);
    expect(response).toMatchObject({ statusCode: 200, body: { ok: true, status: 'complete' } });
    expect(await database.getDocument(`${reportsCollection}/${linkedReport.id}`)).toBeNull();
    expect(await database.getDocument(`${reportsCollection}/${unrelatedReport.id}`))
      .toMatchObject({ accountKey: 'other-retry-example.test' });
    expect((await loadState('retry-room-example.test')).state.profiles).toEqual([]);
    expect((await loadState('other-retry-example.test')).state).toEqual(unrelatedState);
    const completed = await database.getDocument('orbitAccountDeletionJobs/deleted_report_retry');
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toContain('report-retry-uid');
  });

  it('finishes safely on retry after legacy cleanup succeeds but its result write fails', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const legacyState = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'legacy-boundary-profile', orbitPlayerId: 'legacy-boundary-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Boundary Room', email: 'boundary-room@example.test' } }
    };
    const unrelatedState = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'other-boundary-profile', orbitPlayerId: 'other-boundary-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Other Boundary', email: 'other-boundary@example.test' } }
    };
    await database.setDocument('clubStates/boundary-room-example.test', {
      accountKey: 'boundary-room-example.test', state: legacyState,
      snapshot: { memberships: [{ playerId: 'legacy-boundary-profile', playerName: 'Same Name' }] }
    });
    await database.setDocument('clubStates/other-boundary-example.test', {
      accountKey: 'other-boundary-example.test', state: unrelatedState
    });
    await database.setDocument('clubs/boundary-room-example.test', { id: 'boundary-room-example.test' });
    await database.setDocument('clubs/boundary-room-example.test/gameSessions/linked', {
      players: [{ profileId: 'legacy-boundary-profile', playerName: 'Same Name' }]
    });
    const unrelatedGameSession = {
      players: [{ profileId: 'other-boundary-profile', playerName: 'Same Name' }]
    };
    await database.setDocument('clubs/boundary-room-example.test/gameSessions/unrelated', unrelatedGameSession);
    const linkedReport = await storeAnalyticalReport({
      account: { accountKey: 'boundary-room-example.test' },
      usage: { recentEvents: [{ profileId: 'legacy-boundary-profile' }] }
    });
    let rejectLegacyResult = true;
    const replaceLegacyState = vi.fn(async (...arguments_) => {
      const result = await deletionService.replaceLinkedLegacyClubStates(...arguments_);
      if (rejectLegacyResult) {
        rejectLegacyResult = false;
        throw new Error('injected post-legacy cleanup failure');
      }
      return result;
    });
    const deleteUser = vi.fn(async () => undefined);
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_legacy_retry',
      getDatabase: async () => database,
      replaceLinkedLegacyClubStates: replaceLegacyState,
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer: async () => 0,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      nowMs: () => now
    });
    const request = { orbitPlayer: { uid: 'legacy-boundary-uid', auth_time: now / 1000 } };
    const makeResponse = () => ({
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    });

    await expect(handler(request, makeResponse())).rejects.toThrow('injected post-legacy cleanup failure');
    expect(await database.getDocument(`${reportsCollection}/${linkedReport.id}`)).toBeNull();
    expect(await database.getDocument('clubs/boundary-room-example.test/gameSessions/linked')).toBeNull();
    expect(await database.getDocument('clubStates/boundary-room-example.test'))
      .toMatchObject({ legacyStateRemovedForPlayerDeletion: true });
    expect(deleteUser).not.toHaveBeenCalled();

    const response = makeResponse();
    await handler(request, response);
    expect(response).toMatchObject({ statusCode: 200, body: { ok: true, status: 'complete' } });
    expect(await database.getDocument('clubs/boundary-room-example.test/gameSessions/unrelated'))
      .toEqual(unrelatedGameSession);
    expect(await database.getDocument('clubStates/other-boundary-example.test'))
      .toMatchObject({ state: unrelatedState });
    const completed = await database.getDocument('orbitAccountDeletionJobs/deleted_legacy_retry');
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toContain('legacy-boundary-uid');
    expect(deleteUser).toHaveBeenCalledOnce();
  });

  it('removes operational identity while anonymizing configured retained records', () => {
    const state = {
      profiles: [{ id: 'player-1', name: 'Alex Player', email: 'alex@example.com' }, { id: 'other', name: 'Other' }],
      interests: [{ id: 'interest-1', profileId: 'player-1', playerName: 'Alex Player' }],
      playerSessions: [{ id: 'session-1', profileId: 'player-1', playerName: 'Alex Player' }],
      sessions: [{ id: 'table-1', plannedPlayerIds: ['player-1', 'other'] }],
      tournaments: [{ id: 'event-1', players: [{ id: 'seat-1', profileId: 'player-1', name: 'Alex Player' }] }],
      inAppNotifications: [
        { id: 'only-player', targetPlayerIds: ['player-1'], targetPlayerNames: ['Alex Player'] },
        { id: 'shared', targetPlayerIds: ['player-1', 'other'], targetPlayerNames: [] }
      ],
      buyIns: [{ id: 'buy-1', profileId: 'player-1', playerName: 'Alex Player', note: 'cash desk' }],
      timeFeeLogs: [{ id: 'fee-1', playerSessionId: 'session-1', playerName: 'Alex Player' }],
      revenueTransactions: [{ id: 'payment-1', playerId: 'player-1', playerName: 'Alex Player', playerEmail: 'alex@example.com' }],
      playerLedger: [{ id: 'ledger-1', profileId: 'player-1', playerName: 'Alex Player' }],
      correctionLog: [{ id: 'audit-1', note: 'player-1' }],
      feedback: [], history: [], nightCloses: []
    };

    const result = anonymizePlayerState(state, 'player-1', 'deleted_subject', policy);
    expect(result.profiles).toEqual([{ id: 'other', name: 'Other' }]);
    expect(result.interests).toEqual([]);
    expect(result.playerSessions).toEqual([]);
    expect(result.sessions[0].plannedPlayerIds).toEqual(['other']);
    expect(result.tournaments[0].players).toEqual([]);
    expect(result.inAppNotifications).toEqual([{ id: 'shared', targetPlayerIds: ['other'], targetPlayerNames: [] }]);
    expect(result.buyIns[0]).toEqual({ id: 'buy-1', profileId: 'deleted_subject', playerName: 'Deleted player', note: 'cash desk' });
    expect(result.timeFeeLogs[0]).toMatchObject({ playerName: 'Deleted player' });
    expect(result.revenueTransactions[0]).not.toHaveProperty('playerEmail');
    expect(result.correctionLog[0].note).toBe('deleted_subject');
  });

  it('scrubs retained profile relationships and nested audit identity only through immutable target links', () => {
    const targetProfile = {
      id: 'target-profile', orbitPlayerId: 'target-uid', name: 'Shared Name', email: 'target@example.test'
    };
    const sameNamePeer = {
      id: 'same-name-peer', orbitPlayerId: 'peer-uid', name: 'Shared Name', email: 'peer@example.test'
    };
    const otherCompanion = { id: 'other-companion', name: 'Other Companion' };
    const state = {
      profiles: [
        targetProfile,
        sameNamePeer,
        otherCompanion,
        {
          id: 'exclusive-link', name: 'Exclusive Link',
          commonlyPlaysWithProfileIds: ['target-profile', 'other-companion'],
          usualCompanions: ['Shared Name', 'Other Companion']
        },
        {
          id: 'shared-name-link', name: 'Shared Name Link',
          commonlyPlaysWithProfileIds: ['target-profile', 'same-name-peer'],
          usualCompanions: ['Shared Name']
        },
        {
          id: 'unrelated-link', name: 'Unrelated Link',
          commonlyPlaysWithProfileIds: ['other-companion'],
          usualCompanions: ['Shared Name', 'Other Companion']
        }
      ],
      usageEvents: [
        {
          id: 'linked-usage', feature: 'Profiles', action: 'Viewed', route: 'profiles',
          timestamp: '2026-09-01T00:00:00.000Z', accountKey: 'room',
          metadata: {
            actor: {
              profileId: 'target-profile', playerName: 'Shared Name', email: 'target@example.test'
            },
            peer: {
              profileId: 'same-name-peer', playerName: 'Shared Name', email: 'peer@example.test'
            }
          }
        },
        {
          id: 'unrelated-usage', feature: 'Profiles', action: 'Viewed', route: 'profiles',
          timestamp: '2026-09-01T00:01:00.000Z', accountKey: 'room',
          metadata: { profileId: 'same-name-peer', playerName: 'Shared Name' }
        }
      ],
      tableEvents: [
        {
          id: 'linked-table', type: 'Merged', gameId: 'game', tableId: 'table',
          timestamp: '2026-09-01T00:02:00.000Z', playerCount: 2,
          profileId: 'target-profile', note: 'Shared Name moved tables'
        },
        {
          id: 'linked-note-table', type: 'Merged', gameId: 'game', tableId: 'table',
          timestamp: '2026-09-01T00:03:00.000Z', playerCount: 2,
          note: 'Moved target-profile for Shared Name'
        },
        {
          id: 'shared-name-table', type: 'Started', gameId: 'game', tableId: 'table',
          timestamp: '2026-09-01T00:03:30.000Z', playerCount: 2,
          profileIds: ['target-profile', 'same-name-peer'],
          note: 'Started with Shared Name, Shared Name'
        },
        {
          id: 'unrelated-table', type: 'Merged', gameId: 'game', tableId: 'table',
          timestamp: '2026-09-01T00:04:00.000Z', playerCount: 2,
          profileId: 'same-name-peer', note: 'Shared Name moved tables'
        },
        {
          id: 'legacy-name-only-table', type: 'Merged', gameId: 'game', tableId: 'table',
          timestamp: '2026-09-01T00:05:00.000Z', playerCount: 2,
          note: 'Shared Name moved tables'
        }
      ]
    };

    const result = anonymizePlayerState(state, 'target-uid', 'deleted_subject', policy);

    expect(result.profiles).toEqual([
      sameNamePeer,
      otherCompanion,
      {
        id: 'exclusive-link', name: 'Exclusive Link',
        commonlyPlaysWithProfileIds: ['other-companion'],
        usualCompanions: ['Other Companion']
      },
      {
        id: 'shared-name-link', name: 'Shared Name Link',
        commonlyPlaysWithProfileIds: ['same-name-peer'],
        usualCompanions: ['Shared Name']
      },
      {
        id: 'unrelated-link', name: 'Unrelated Link',
        commonlyPlaysWithProfileIds: ['other-companion'],
        usualCompanions: ['Shared Name', 'Other Companion']
      }
    ]);
    expect(result.usageEvents).toEqual([
      {
        ...state.usageEvents[0],
        metadata: {
          actor: { profileId: 'deleted_subject', playerName: 'Deleted player' },
          peer: {
            profileId: 'same-name-peer', playerName: 'Shared Name', email: 'peer@example.test'
          }
        }
      },
      state.usageEvents[1]
    ]);
    expect(result.tableEvents).toEqual([
      { ...state.tableEvents[0], profileId: 'deleted_subject', note: '[redacted] moved tables' },
      { ...state.tableEvents[1], note: 'Moved deleted_subject for [redacted]' },
      {
        ...state.tableEvents[2],
        profileIds: ['deleted_subject', 'same-name-peer'],
        note: 'Started with Shared Name, Shared Name'
      },
      state.tableEvents[3],
      state.tableEvents[4]
    ]);
  });

  it('deletes only immutably linked usage and table audit records under the delete disposition', () => {
    const deleteAuditPolicy = { ...policy, auditRecords: 'delete' };
    const state = {
      profiles: [
        { id: 'target-profile', orbitPlayerId: 'target-uid', name: 'Shared Name' },
        { id: 'same-name-peer', orbitPlayerId: 'peer-uid', name: 'Shared Name' }
      ],
      usageEvents: [
        { id: 'linked', metadata: { profileId: 'target-profile', name: 'Shared Name' } },
        { id: 'unrelated', metadata: { profileId: 'same-name-peer', name: 'Shared Name' } }
      ],
      tableEvents: [
        {
          id: 'linked', profileIds: ['target-profile', 'same-name-peer'],
          note: 'Shared Name and Shared Name moved tables'
        },
        { id: 'unrelated', profileId: 'same-name-peer', note: 'Shared Name moved tables' }
      ]
    };

    const result = anonymizePlayerState(state, 'target-uid', 'deleted_subject', deleteAuditPolicy);

    expect(result.usageEvents).toEqual([state.usageEvents[1]]);
    expect(result.tableEvents).toEqual([state.tableEvents[1]]);
  });

  it('redacts nested linked identity and paired notification names without name-based collisions', () => {
    const state = {
      profiles: [
        { id: 'legacy-one', orbitPlayerId: 'uid-one', name: 'Same Name', email: 'one@example.test', phone: '+15551234567', birthday: '1990-01-01', address: '1 Main St' },
        { id: 'other', orbitPlayerId: 'uid-other', name: 'Same Name', email: 'other@example.test' }
      ],
      inAppNotifications: [
        { id: 'shared', targetPlayerIds: ['legacy-one', 'other'], targetPlayerNames: ['Same Name', 'Same Name'] },
        { id: 'other-only', targetPlayerIds: ['other'], targetPlayerNames: ['Same Name'] }
      ],
      revenueTransactions: [
        { id: 'linked', profileId: 'legacy-one', details: { email: 'one@example.test', note: 'Same Name at 1 Main St / +15551234567' } },
        { id: 'unrelated', profileId: 'other', details: { note: 'Same Name' } }
      ]
    };
    const result = anonymizePlayerState(state, 'uid-one', 'deleted_subject', policy);
    expect(result.inAppNotifications).toEqual([
      { id: 'shared', targetPlayerIds: ['other'], targetPlayerNames: ['Same Name'] },
      { id: 'other-only', targetPlayerIds: ['other'], targetPlayerNames: ['Same Name'] }
    ]);
    expect(result.revenueTransactions[0]).toEqual({
      id: 'linked', profileId: 'deleted_subject', details: { note: '[redacted] at [redacted] / [redacted]' }
    });
    expect(result.revenueTransactions[1]).toEqual(state.revenueTransactions[1]);
    expect(removeNotificationRecipient(state.inAppNotifications[0], 'legacy-one')).toEqual({
      id: 'shared', targetPlayerIds: ['other'], targetPlayerNames: ['Same Name']
    });
    const firebaseNotification = removeNotificationRecipient(
      {
        id: 'firebase-shared', targetPlayerIds: ['uid-one', 'other'], targetPlayerNames: ['Same Name', 'Other'],
        body: 'legacy-one / one@example.test'
      },
      'uid-one',
      new Set(['Same Name', 'one@example.test']),
      'deleted_subject',
      new Set(['uid-one', 'legacy-one'])
    );
    expect(firebaseNotification).toMatchObject({
      targetPlayerIds: ['other'], targetPlayerNames: ['Other'], body: 'deleted_subject / [redacted]'
    });
  });

  it('preserves unrelated identities inside a matched multi-player financial aggregate', () => {
    const otherParticipant = {
      playerId: 'other-player',
      name: 'Same Name',
      email: 'other@example.test',
      details: { phone: '+15550009999', note: 'Same Name owns this note' }
    };
    const state = {
      profiles: [
        { id: 'legacy-one', orbitPlayerId: 'uid-one', name: 'Same Name', email: 'one@example.test' },
        { id: 'other-player', orbitPlayerId: 'uid-other', name: 'Same Name', email: 'other@example.test' }
      ],
      revenueTransactions: [{
        id: 'shared-settlement',
        profileId: 'legacy-one',
        participants: [
          { playerId: 'legacy-one', name: 'Same Name', email: 'one@example.test' },
          otherParticipant
        ]
      }]
    };

    const result = anonymizePlayerState(state, 'uid-one', 'deleted_subject', policy);
    expect(result.revenueTransactions[0].profileId).toBe('deleted_subject');
    expect(result.revenueTransactions[0].participants[0]).toEqual({
      playerId: 'deleted_subject', name: 'Deleted player'
    });
    expect(result.revenueTransactions[0].participants[1]).toEqual(otherParticipant);
  });

  it('removes alternate contact, address, birth, and name fields in an immutably linked record', () => {
    const otherParticipant = {
      playerId: 'other-player',
      displayName: 'Other Display',
      contact: { email: 'other@example.test', phone: '+15550001111' },
      homeLocation: 'Other City'
    };
    const state = {
      profiles: [{ id: 'target-profile', orbitPlayerId: 'target-uid', name: 'Known Name' }],
      revenueTransactions: [{
        id: 'linked-payment',
        profileId: 'target-profile',
        displayName: 'Alternate Unharvested Name',
        contactEmail: 'alternate@example.test',
        details: {
          fullName: 'Different Legal Name',
          dateOfBirth: '1982-03-04',
          mailingAddress: { line1: '900 Hidden Way' },
          homeLocation: 'Secret City'
        },
        participants: [
          { playerId: 'target-profile', legalName: 'Another Alias', phoneNumber: '+15559990000' },
          otherParticipant
        ]
      }]
    };

    const result = anonymizePlayerState(state, 'target-uid', 'deleted_subject', policy);
    expect(result.revenueTransactions[0]).toEqual({
      id: 'linked-payment',
      profileId: 'deleted_subject',
      displayName: 'Deleted player',
      details: { fullName: 'Deleted player' },
      participants: [
        { playerId: 'deleted_subject', legalName: 'Deleted player' },
        otherParticipant
      ]
    });
    expect(JSON.stringify(result.revenueTransactions[0])).not.toMatch(
      /alternate@example\.test|Different Legal Name|1982-03-04|900 Hidden Way|Secret City|\+15559990000/
    );
  });

  it('matches legacy free-text identifiers only as delimited tokens, never substrings', () => {
    const state = {
      profiles: [{ id: 'p1', name: 'Target Player' }, { id: 'p123', name: 'Other Player' }],
      correctionLog: [
        { id: 'linked-audit', note: 'Player p1, arrived.' },
        { id: 'collision-audit', profileId: 'p123', note: 'Player p123 arrived.' }
      ]
    };

    const result = anonymizePlayerState(state, 'p1', 'deleted_subject', policy);
    expect(result.correctionLog[0]).toEqual({ id: 'linked-audit', note: 'Player deleted_subject, arrived.' });
    expect(result.correctionLog[1]).toEqual(state.correctionLog[1]);
    expect(JSON.stringify(result.correctionLog[1])).toContain('p123');
  });

  it('never evicts an older deletion tombstone or permits stale profile resurrection', () => {
    const pseudonymSecret = 'test-only-pseudonym-secret-that-is-long-enough';
    vi.stubEnv('ORBIT_DELETION_PSEUDONYM_SECRET', pseudonymSecret);
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify(policy));
    const deletedUid = 'first-deleted-uid';
    const deletedSubject = `deleted_${createHmac('sha256', pseudonymSecret)
      .update(deletedUid)
      .digest('hex')
      .slice(0, 24)}`;
    const authoritativeState = {
      playerPrivacyTombstones: [
        deletedSubject,
        ...Array.from({ length: 500 }, (_value, index) => `deleted_existing_${index}`)
      ]
    };
    const staleIncomingState = {
      profiles: [{ id: deletedUid, name: 'Resurrected Name', email: 'resurrected@example.test' }],
      interests: [{ id: 'stale-interest', profileId: deletedUid }]
    };

    const result = enforcePlayerPrivacyTombstones(staleIncomingState, authoritativeState);

    expect(result.playerPrivacyTombstones).toHaveLength(501);
    expect(result.playerPrivacyTombstones[0]).toBe(deletedSubject);
    expect(result.profiles).toEqual([]);
    expect(result.interests).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/Resurrected Name|resurrected@example\.test/);
  });

  it('enforces a tombstone against stale linked records even when no profile is present', () => {
    const pseudonymSecret = 'test-only-pseudonym-secret-that-is-long-enough';
    vi.stubEnv('ORBIT_DELETION_PSEUDONYM_SECRET', pseudonymSecret);
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify(policy));
    const deletedUid = 'deleted-no-profile-uid';
    const deletedSubject = `deleted_${createHmac('sha256', pseudonymSecret)
      .update(deletedUid)
      .digest('hex')
      .slice(0, 24)}`;
    const incoming = {
      profiles: [],
      playerSessions: [{ id: 'session-one', profileId: deletedUid, playerName: 'Private Name' }],
      interests: [{ id: 'interest-one', profileId: deletedUid, playerName: 'Private Name' }],
      revenueTransactions: [{ id: 'payment-one', playerId: deletedUid, playerEmail: 'private@example.test' }],
      history: [{ id: 'audit-one', actorPlayerId: deletedUid, details: { email: 'alternate@example.test' } }],
      tournaments: [{ id: 'event-one', players: [{ id: 'seat-one', profileId: deletedUid, name: 'Private Name' }] }]
    };

    const result = enforcePlayerPrivacyTombstones(incoming, {
      playerPrivacyTombstones: [deletedSubject]
    });

    expect(result.playerSessions).toEqual([]);
    expect(result.interests).toEqual([]);
    expect(result.tournaments[0].players).toEqual([]);
    expect(result.revenueTransactions[0]).toMatchObject({ playerId: deletedSubject });
    expect(result.revenueTransactions[0]).not.toHaveProperty('playerEmail');
    expect(result.history[0]).toMatchObject({ actorPlayerId: deletedSubject });
    expect(JSON.stringify(result)).not.toMatch(/deleted-no-profile-uid|Private Name|example\.test/);
  });

  it('invalidates old state/outbox/legacy receipts on retry and never mutates an unrelated account', async () => {
    const affected = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'legacy-profile', orbitPlayerId: 'uid-sensitive', name: 'Private Name', email: 'private@example.test' }],
      history: [{ id: 'history-one', profileId: 'legacy-profile', details: { email: 'private@example.test' } }],
      settings: { clubAccount: { clubName: 'Affected', email: 'affected@example.test' } }
    };
    const unrelated = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{ id: 'other-profile', orbitPlayerId: 'other-uid', name: 'Same Name' }],
      settings: { clubAccount: { clubName: 'Unrelated', email: 'unrelated@example.test' } }
    };
    await saveState(affected, { expectedRevision: 0, mutationId: 'first-private@example.test' });
    await saveState({ ...affected, feedback: [{ id: 'feedback', uid: 'uid-sensitive' }] }, {
      expectedRevision: 1, mutationId: 'second-private@example.test'
    });
    await saveState(unrelated, { expectedRevision: 0, mutationId: 'unrelated-initial' });
    const database = await getDatabase();
    await database.setDocument(legacyMutationPath('affected-example.test', 'legacy-private@example.test'), {
      accountKey: 'affected-example.test', mutationId: 'legacy-private@example.test', revision: 1, createdAt: '2026-01-01T00:00:00.000Z'
    });
    const unrelatedBefore = await loadState('unrelated-example.test');
    const failOnce = vi.fn().mockRejectedValueOnce(new Error('injected invalidation failure'));
    await expect(anonymizeAuthoritativeStates('uid-sensitive', 'deleted_subject', policy, {
      invalidateAccountStateHistory: failOnce
    })).rejects.toThrow('injected invalidation failure');

    await expect(anonymizeAuthoritativeStates('uid-sensitive', 'deleted_subject', policy)).resolves.toMatchObject({
      changedAccounts: 0
    });
    const current = await loadState('affected-example.test');
    expect(JSON.stringify(current.state)).not.toMatch(/uid-sensitive|legacy-profile|private@example\.test|Private Name/);
    const inspectionDatabase = await getDatabase();
    const chunks = await inspectionDatabase.queryCollection(`${accountPath(current.accountKey)}/stateChunks`, { limit: 100 });
    expect(new Set(chunks.map((document) => document.data.revision))).toEqual(new Set([current.revision]));
    const outbox = await inspectionDatabase.queryCollection(publicationCollection, { limit: 100 });
    expect(outbox
      .filter((document) => document.data.accountKey === current.accountKey && document.data.revision < current.revision)
      .every((document) => document.data.status === 'cancelled')).toBe(true);
    const mutations = await inspectionDatabase.queryCollection(`${accountPath(current.accountKey)}/mutations`, { limit: 100 });
    expect(mutations.every((document) => /^m_[a-f0-9]{64}$/.test(document.id))).toBe(true);
    expect(JSON.stringify(mutations)).not.toMatch(/private@example\.test|uid-sensitive/);
    expect(await loadState('unrelated-example.test')).toEqual(unrelatedBefore);
  });

  it('discovers a linked profile that exists only in a historical revision and invalidates that history', async () => {
    const historicalObserver = {
      id: 'historical-observer', name: 'Observer',
      commonlyPlaysWithProfileIds: ['historical-profile', 'historical-other'],
      usualCompanions: ['Historical Name', 'Other Companion']
    };
    const historicalOther = { id: 'historical-other', name: 'Other Companion' };
    const historical = {
      games: [], sessions: [], playerSessions: [],
      profiles: [{
        id: 'historical-profile', orbitPlayerId: 'historical-uid', name: 'Historical Name',
        email: 'history@example.test', address: '100 Old St'
      }, historicalOther, historicalObserver],
      usageEvents: [{
        id: 'historical-usage', metadata: {
          subject: {
            profileId: 'historical-profile', name: 'Historical Name', email: 'history@example.test'
          }
        }
      }],
      tableEvents: [{
        id: 'historical-table', profileIds: ['historical-profile', 'historical-other'],
        note: 'Historical Name moved tables'
      }],
      settings: { clubAccount: { clubName: 'Historical Club', email: 'history-club@example.test' } }
    };
    const current = {
      ...historical,
      profiles: [historicalOther, historicalObserver],
      settings: { clubAccount: { clubName: 'Historical Club', email: 'history-club@example.test' } }
    };
    const immutableReferenceOnly = {
      games: [], sessions: [], playerSessions: [], profiles: [],
      revenueTransactions: [{
        id: 'historical-reference', profileId: 'historical-profile',
        details: { email: 'history@example.test', note: 'Historical Name at 100 Old St' }
      }],
      settings: { clubAccount: { clubName: 'A Reference Club', email: 'a-reference@example.test' } }
    };
    await saveState(immutableReferenceOnly, { expectedRevision: 0, mutationId: 'historical-reference-create' });
    await saveState(historical, { expectedRevision: 0, mutationId: 'historical-create' });
    await saveState(current, { expectedRevision: 1, mutationId: 'historical-remove' });
    expect((await loadState('history-club-example.test')).state.tableEvents[0].profileIds)
      .toEqual(['historical-profile', 'historical-other']);

    const inventory = await deletionService.inventoryAuthoritativePlayer('historical-uid', 'deleted_subject');
    expect(inventory).toMatchObject({
      affectedAccounts: 2,
      affectedAccountKeys: expect.arrayContaining([
        'a-reference-example.test',
        'history-club-example.test'
      ]),
      linkedPlayerIds: expect.arrayContaining(['historical-uid', 'historical-profile']),
      sensitiveValues: expect.arrayContaining(['Historical Name', 'history@example.test'])
    });

    await expect(anonymizeAuthoritativeStates('historical-uid', 'deleted_subject', policy)).resolves.toMatchObject({
      changedAccounts: 2,
      linkedPlayerIds: expect.arrayContaining(['historical-profile'])
    });
    const saved = await loadState('history-club-example.test');
    expect(saved.state.playerPrivacyTombstones).toContain('deleted_subject');
    expect(saved.state.profiles).toEqual([
      historicalOther,
      {
        ...historicalObserver,
        commonlyPlaysWithProfileIds: ['historical-other'],
        usualCompanions: ['Other Companion']
      }
    ]);
    expect(saved.state.usageEvents[0]).toEqual({
      id: 'historical-usage',
      metadata: { subject: { profileId: 'deleted_subject', name: 'Deleted player' } }
    });
    expect(saved.state.tableEvents[0]).toEqual({
      id: 'historical-table',
      profileIds: ['deleted_subject', 'historical-other'],
      note: '[redacted] moved tables'
    });
    expect(JSON.stringify(saved.state)).not.toMatch(/historical-uid|historical-profile|Historical Name|history@example\.test/);
    expect(await listHistoricalStates(saved.accountKey, saved.revision)).toEqual([]);
    const referenceOnly = await loadState('a-reference-example.test');
    expect(referenceOnly.state.revenueTransactions[0]).toMatchObject({ profileId: 'deleted_subject' });
    expect(JSON.stringify(referenceOnly.state)).not.toMatch(/historical-profile|Historical Name|history@example\.test|100 Old St/);
  });

  it('inventories exact Firebase profile documents and linked IDs without name matching', async () => {
    const database = await getDatabase();
    await database.setDocument('clubs/club-one', { id: 'club-one' });
    await database.setDocument('players/firebase-uid', {
      id: 'firebase-uid', homeLocation: 'Austin, TX'
    });
    await database.setDocument('players/firebase-uid/private/identity', {
      verifiedDetails: { fullName: 'Verified Same Name', address: '200 Main St' }
    });
    await database.setDocument('clubs/club-one/players/firebase-uid', {
      id: 'firebase-uid',
      sourceProfileId: 'legacy-profile',
      name: 'Same Name',
      emailAddress: 'exact@example.test',
      identity: { phoneNumber: '+15551234567' }
    });
    await database.setDocument('clubs/club-one/players/legacy-profile', {
      id: 'legacy-profile',
      orbitPlayerId: 'firebase-uid',
      dateOfBirth: '1990-01-02',
      address: '100 Main St'
    });
    await database.setDocument('clubs/club-one/players/second-legacy', {
      id: 'second-legacy',
      orbitPlayerId: 'legacy-profile',
      email: 'second-link@example.test'
    });
    await database.setDocument('clubs/club-one/players/unrelated', {
      id: 'unrelated',
      name: 'Same Name',
      emailAddress: 'unrelated@example.test'
    });

    const inventory = await inventoryFirebasePlayer(database, 'firebase-uid');
    expect(inventory).toEqual({
      affectedClubIds: ['club-one'],
      clubIds: ['club-one'],
      linkedPlayerIds: expect.arrayContaining(['firebase-uid', 'legacy-profile', 'second-legacy']),
      sensitiveValues: expect.arrayContaining([
        'Same Name', 'Verified Same Name', 'exact@example.test', '+15551234567',
        '1990-01-02', '100 Main St', '200 Main St', 'Austin, TX', 'second-link@example.test'
      ])
    });
    expect(inventory.linkedPlayerIds).not.toContain('unrelated');
    expect(inventory.sensitiveValues).not.toContain('unrelated@example.test');
  });

  it('recursively deletes every linked root Player profile while preserving an unrelated same-name profile', async () => {
    const deletedRootPaths = [];
    const references = new Map();
    const emptyQuery = () => {
      const query = {
        where: vi.fn(() => query),
        orderBy: vi.fn(() => query),
        limit: vi.fn(() => query),
        startAfter: vi.fn(() => query),
        get: vi.fn(async () => ({ docs: [] }))
      };
      return query;
    };
    const database = {
      collection: vi.fn(() => emptyQuery()),
      doc: vi.fn((path) => {
        if (!references.has(path)) references.set(path, { path, delete: vi.fn(async () => undefined) });
        return references.get(path);
      }),
      recursiveDelete: vi.fn(async (reference) => {
        deletedRootPaths.push(reference.path);
      })
    };
    const firestore = Object.assign(vi.fn(), {
      FieldPath: { documentId: () => '__name__' },
      FieldValue: {
        delete: () => Symbol('delete'),
        serverTimestamp: () => 'server-timestamp'
      }
    });
    const admin = { firestore };

    await expect(cleanupFirebasePlayer(
      'firebase-uid',
      ['legacy-profile'],
      'deleted_subject',
      policy,
      {
        linkedPlayerIds: ['firebase-uid', 'legacy-profile', 'second-legacy'],
        sensitiveValues: ['Same Name', 'exact@example.test']
      },
      { database, getAdminSdk: () => admin }
    )).resolves.toBe(0);

    expect(new Set(deletedRootPaths)).toEqual(new Set([
      'players/firebase-uid',
      'players/legacy-profile',
      'players/second-legacy'
    ]));
    expect(deletedRootPaths).not.toContain('players/unrelated');
    expect(database.recursiveDelete).toHaveBeenCalledTimes(3);
  });

  it('durably finalizes after Auth deletion when the first terminal marker write fails', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const analyticalReport = await storeAnalyticalReport({
      account: { accountKey: 'affected-account' },
      usage: { recentEvents: [{ profileId: 'legacy-one' }] }
    });
    const unrelatedReport = await storeAnalyticalReport({
      account: { accountKey: 'unrelated-account' },
      usage: { recentEvents: [{ profileId: 'other-player' }] }
    });
    const deleteUser = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: 'auth/user-not-found' });
    let rejectNextCompletion = true;
    const writeJob = vi.fn(async (...arguments_) => {
      if (arguments_[3] === 'complete' && rejectNextCompletion) {
        rejectNextCompletion = false;
        throw new Error('injected final write failure');
      }
      return updateJob(...arguments_);
    });
    const scrubTelemetry = vi.fn(async () => undefined);
    const deleteAnalyticalReports = vi.fn(deleteAnalyticalReportsForAccounts);
    const cleanupFirebasePlayer = vi.fn(async () => 4);
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 0 }));
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_subject',
      getDatabase: async () => database,
      updateJob: writeJob,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 1,
        affectedAccountKeys: ['affected-account'],
        linkedPlayerIds: ['uid-one', 'legacy-one'],
        sensitiveValues: ['Private Name']
      }),
      inventoryFirebasePlayer: async () => ({
        linkedPlayerIds: ['uid-one', 'firebase-profile'],
        sensitiveValues: ['exact@example.test']
      }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 1, linkedPlayerIds: ['uid-one', 'legacy-one'] }),
      redactTelemetry: scrubTelemetry,
      deleteAnalyticalReportsForAccounts: deleteAnalyticalReports,
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      nowMs: () => now
    });
    const request = { orbitPlayer: { uid: 'uid-one', auth_time: now / 1000 } };
    const makeResponse = () => ({
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    });
    const response = makeResponse();
    await handler(request, response);
    expect(response).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        jobFinalization: 'scheduled',
        changedAccounts: 1,
        deletedAnalyticalReports: 1,
        deletedAnalyticalReportChunks: 1
      }
    });
    expect(response.body.error).toContain('still recording');
    expect(deleteUser).toHaveBeenCalledOnce();
    expect(scrubTelemetry).toHaveBeenCalledWith(
      database,
      expect.arrayContaining(['uid-one', 'legacy-one', 'firebase-profile']),
      expect.arrayContaining(['Private Name', 'exact@example.test']),
      'deleted_subject'
    );
    expect(deleteAnalyticalReports).toHaveBeenCalledWith(['affected-account'], { database });
    expect(await database.getDocument(`${reportsCollection}/${analyticalReport.id}`)).toBeNull();
    expect(await database.queryCollection(`${reportsCollection}/${analyticalReport.id}/chunks`, { limit: 100 })).toEqual([]);
    expect(await database.getDocument(`${reportsCollection}/${unrelatedReport.id}`))
      .toMatchObject({ accountKey: 'unrelated-account' });
    expect(cleanupFirebasePlayer).toHaveBeenCalledWith(
      'uid-one',
      expect.arrayContaining(['uid-one', 'legacy-one', 'firebase-profile']),
      'deleted_subject',
      policy,
      expect.objectContaining({ sensitiveValues: ['exact@example.test'] })
    );
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
    const pending = await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('deleted_subject')}`);
    expect(pending).toMatchObject({
      status: 'finalizing',
      currentStep: 'projection-publication',
      pendingAuthUid: 'uid-one'
    });

    await expect(finalizePendingDeletionJobs({
      database,
      deletePlayerIdentityData: noPendingIdentityCleanup,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      readDeletionPolicy: () => policy,
      finalizePlayerDataCleanup: async () => ({}),
      updateJob
    })).resolves.toEqual({ finalized: 1, failed: 0, pagesVisited: 1 });
    const completed = await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('deleted_subject')}`);
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toContain('uid-one');
    expect(deleteUser).toHaveBeenCalledTimes(2);
  });

  it('returns pending without deleting Auth when final projection cleanup must be replayed by the server', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const deleteUser = vi.fn(async () => undefined);
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 1 }));
    const finalizePlayerDataCleanup = vi.fn(async () => {
      throw new Error('injected post-auth cleanup failure');
    });
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_cleanup_subject',
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 0,
        affectedAccountKeys: [],
        affectedLegacyStateDocumentIds: [],
        linkedPlayerIds: ['cleanup-uid'],
        sensitiveValues: []
      }),
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: [], clubIds: [], linkedPlayerIds: ['cleanup-uid'], sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteLinkedGameSessions: async () => ({ deletedGameSessions: 0, affectedClubIds: [] }),
      deleteAnalyticalReportsForAccounts: async () => ({
        deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0
      }),
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer: async () => 0,
      replaceLinkedLegacyClubStates: async () => ({ replacedLegacyStates: 0 }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0 }),
      finalizePlayerDataCleanup,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      nowMs: () => now
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };

    await handler({ orbitPlayer: { uid: 'cleanup-uid', auth_time: now / 1000 } }, response);

    expect(response).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        jobFinalization: 'scheduled'
      }
    });
    expect(response.body.error).toContain('Account access remains blocked');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(finalizePlayerDataCleanup).toHaveBeenCalledOnce();
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
    expect(await database.getDocument('orbitAccountDeletionJobs/deleted_cleanup_subject'))
      .toMatchObject({ status: 'finalizing', pendingAuthUid: 'cleanup-uid' });
  });

  it('keeps Auth and the deletion job pending until orphan Identity intents are cleaned', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const deleteUser = vi.fn(async () => undefined);
    const deleteIdentity = vi.fn()
      .mockResolvedValueOnce({
        redactionRequested: false,
        identityProviderCleanupPending: 1,
        identityProviderCleanupCompleted: 0
      })
      .mockResolvedValueOnce({
        redactionRequested: false,
        identityProviderCleanupPending: 0,
        identityProviderCleanupCompleted: 1
      });
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 1 }));
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_identity_intent_subject',
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 0, affectedAccountKeys: [], affectedLegacyStateDocumentIds: [],
        linkedPlayerIds: ['identity-intent-uid'], sensitiveValues: []
      }),
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: [], clubIds: [], linkedPlayerIds: ['identity-intent-uid'], sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteLinkedGameSessions: async () => ({ deletedGameSessions: 0, affectedClubIds: [] }),
      deleteAnalyticalReportsForAccounts: async () => ({
        deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0
      }),
      deletePlayerIdentityData: deleteIdentity,
      cleanupFirebasePlayer: async () => 0,
      replaceLinkedLegacyClubStates: async () => ({ replacedLegacyClubStates: 0 }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0 }),
      finalizePlayerDataCleanup: async () => ({}),
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      nowMs: () => now
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };

    await handler({ orbitPlayer: { uid: 'identity-intent-uid', auth_time: now / 1000 } }, response);

    expect(response).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        identityProviderCleanupPending: 1,
        jobFinalization: 'scheduled'
      }
    });
    expect(response.body.error).toContain('identity-provider cleanup');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
    expect(await database.getDocument('orbitAccountDeletionJobs/deleted_identity_intent_subject'))
      .toMatchObject({ status: 'finalizing', pendingAuthUid: 'identity-intent-uid' });

    await expect(finalizePendingDeletionJobs({
      database,
      deletePlayerIdentityData: deleteIdentity,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      readDeletionPolicy: () => policy,
      finalizePlayerDataCleanup: async () => ({}),
      updateJob
    })).resolves.toEqual({ finalized: 1, failed: 0, pagesVisited: 1 });

    expect(deleteUser).toHaveBeenCalledWith('identity-intent-uid');
    const completed = await database.getDocument('orbitAccountDeletionJobs/deleted_identity_intent_subject');
    expect(completed).toMatchObject({
      status: 'complete',
      result: { identityProviderCleanupPending: 0, identityProviderCleanupCompleted: 1 }
    });
    expect(JSON.stringify(completed)).not.toContain('identity-intent-uid');
  });

  it('keeps Auth until the exact sanitized revision publishes and then repeats projection cleanup before Auth', async () => {
    const now = Date.parse('2026-09-05T02:00:00.000Z');
    const database = await getDatabase();
    const requirement = { accountKey: 'fenced-account', revision: 2 };
    await database.setDocument(publicationPath(requirement.accountKey, requirement.revision), {
      ...requirement,
      status: 'pending',
      claimableAt: new Date(now).toISOString()
    });
    const callOrder = [];
    const deleteUser = vi.fn(async () => { callOrder.push('auth'); });
    const finalizeData = vi.fn(async () => {
      callOrder.push('cleanup');
      await database.deleteDocument('clubs/fenced-account/gameSessions/stale-session');
      await database.deleteDocument('clubs/fenced-account/tournamentInterests/stale-interest');
      return { requiredPublications: [requirement] };
    });
    const schedulePublications = vi.fn(async () => []);
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 1 }));
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_fenced_subject',
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 1,
        affectedAccountKeys: ['fenced-account'],
        affectedLegacyStateDocumentIds: [],
        linkedPlayerIds: ['fenced-uid', 'legacy-fenced-profile'],
        sensitiveValues: []
      }),
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: ['fenced-account'],
        clubIds: ['fenced-account'],
        linkedPlayerIds: ['fenced-uid', 'legacy-fenced-profile'],
        sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteLinkedGameSessions: async () => ({ deletedGameSessions: 0, affectedClubIds: ['fenced-account'] }),
      deleteAnalyticalReportsForAccounts: async () => ({
        deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0
      }),
      deletePlayerIdentityData: noPendingIdentityCleanup,
      cleanupFirebasePlayer: async () => 0,
      replaceLinkedLegacyClubStates: async () => ({ replacedLegacyStates: 0 }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 1, requiredPublications: [requirement] }),
      finalizePlayerDataCleanup: finalizeData,
      schedulePublicationDrain: schedulePublications,
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      nowMs: () => now
    });
    const response = {
      statusCode: 200,
      body: undefined,
      set: vi.fn(),
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    };

    await handler({ orbitPlayer: { uid: 'fenced-uid', auth_time: now / 1000 } }, response);
    expect(response).toMatchObject({
      statusCode: 202,
      body: { status: 'pending', code: 'DELETION_FINALIZATION_PENDING' }
    });
    expect(response.body.error).toContain('sanitized venue projection');
    expect(deleteUser).not.toHaveBeenCalled();
    expect(finalizeData).not.toHaveBeenCalled();
    expect(schedulePublications).toHaveBeenCalled();
    const pending = await database.getDocument('orbitAccountDeletionJobs/deleted_fenced_subject');
    expect(pending).toMatchObject({
      status: 'finalizing',
      result: {
        requiredPublications: [requirement],
        cleanupManifest: {
          linkedPlayerIds: expect.arrayContaining(['fenced-uid', 'legacy-fenced-profile']),
          affectedAccountKeys: ['fenced-account'],
          firebaseClubIds: ['fenced-account']
        }
      }
    });

    // Model the last writes of a pre-fence publisher. Publication completion is
    // not enough by itself: the final exact-ID scrub must run again before Auth.
    await database.setDocument('clubs/fenced-account/gameSessions/stale-session', {
      players: [{ profileId: 'legacy-fenced-profile', playerName: 'Private Name' }]
    });
    await database.setDocument('clubs/fenced-account/tournamentInterests/stale-interest', {
      playerId: 'fenced-uid', status: 'interested'
    });
    await database.setDocument(publicationPath(requirement.accountKey, requirement.revision), {
      ...requirement,
      status: 'published'
    });

    await expect(finalizePendingDeletionJobs({
      database,
      deletePlayerIdentityData: noPendingIdentityCleanup,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      readDeletionPolicy: () => policy,
      finalizePlayerDataCleanup: finalizeData,
      updateJob
    })).resolves.toEqual({ finalized: 1, failed: 0, pagesVisited: 1 });

    expect(callOrder).toEqual(['cleanup', 'auth', 'cleanup']);
    expect(await database.getDocument('clubs/fenced-account/gameSessions/stale-session')).toBeNull();
    expect(await database.getDocument('clubs/fenced-account/tournamentInterests/stale-interest')).toBeNull();
    const completed = await database.getDocument('orbitAccountDeletionJobs/deleted_fenced_subject');
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toMatch(/fenced-uid|legacy-fenced-profile|requiredPublications|cleanupManifest/);
  });

  it('rotates across bounded finalizer pages so early permanent failures do not starve later jobs', async () => {
    const database = await getDatabase();
    for (let index = 0; index < 30; index += 1) {
      const suffix = String(index).padStart(2, '0');
      await updateJob(
        database,
        `uid-${suffix}`,
        `subject-${suffix}`,
        'finalizing',
        'firebase-auth',
        [],
        { changedAccounts: 1 }
      );
    }
    const deleteUser = vi.fn(async (playerId) => {
      if (Number(playerId.slice(-2)) < 25) throw Object.assign(new Error('permanent failure'), { code: 'auth/internal-error' });
    });

    await expect(finalizePendingDeletionJobs({
      database,
      deletePlayerIdentityData: noPendingIdentityCleanup,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      readDeletionPolicy: () => policy,
      finalizePlayerDataCleanup: async () => ({}),
      updateJob
    })).resolves.toEqual({ finalized: 5, failed: 25, pagesVisited: 2 });

    expect(await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('subject-29')}`))
      .toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('subject-00')}`))
      .toMatchObject({ status: 'finalizing', pendingAuthUid: 'uid-00' });
    expect(await database.getDocument('orbitServiceCursors/accountDeletionFinalizer'))
      .toMatchObject({ afterJobId: 'subject-29' });
  });

  it('returns a stable pending contract when Auth finalization must be replayed server-side', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const deleteUser = vi.fn().mockRejectedValue({ code: 'auth/internal-error' });
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 1 }));
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_subject',
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 0, linkedPlayerIds: ['uid-one'], sensitiveValues: []
      }),
      inventoryFirebasePlayer: async () => ({ linkedPlayerIds: ['uid-one'], sensitiveValues: [] }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0, linkedPlayerIds: ['uid-one'] }),
      redactTelemetry: async () => undefined,
      deletePlayerIdentityData: async () => ({ identityDeleted: true }),
      cleanupFirebasePlayer: async () => 0,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      nowMs: () => now
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };

    await handler({ orbitPlayer: { uid: 'uid-one', auth_time: now / 1000 } }, response);

    expect(response).toMatchObject({
      statusCode: 202,
      body: {
        ok: true,
        status: 'pending',
        code: 'DELETION_FINALIZATION_PENDING',
        jobFinalization: 'scheduled'
      }
    });
    expect(response.body.error).toContain('still pending');
    expect(scheduleFinalization).toHaveBeenCalledWith({ force: true });
    expect(await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('deleted_subject')}`))
      .toMatchObject({ status: 'finalizing', pendingAuthUid: 'uid-one' });
  });

  it('blocks resurrection after a pending Auth deletion and re-cleans before terminal finalization', async () => {
    const now = Date.parse('2026-09-04T18:00:00.000Z');
    const database = await getDatabase();
    const deleteUser = vi.fn()
      .mockRejectedValueOnce({ code: 'auth/internal-error' })
      .mockResolvedValueOnce(undefined);
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => 'deleted_resurrection_subject',
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: async () => ({
        affectedAccounts: 0, affectedAccountKeys: [], affectedLegacyStateDocumentIds: [],
        linkedPlayerIds: ['resurrection-uid'], sensitiveValues: []
      }),
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: [], clubIds: [], linkedPlayerIds: ['resurrection-uid'], sensitiveValues: []
      }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0 }),
      redactTelemetry: async () => undefined,
      deletePlayerIdentityData: async () => ({ redactionRequested: false }),
      cleanupFirebasePlayer: async () => 0,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      scheduleDeletionFinalizationDrain: async () => ({ finalized: 0, failed: 1 }),
      nowMs: () => now
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };
    await handler({ orbitPlayer: { uid: 'resurrection-uid', auth_time: now / 1000 } }, response);
    expect(response).toMatchObject({ statusCode: 202, body: { code: 'DELETION_FINALIZATION_PENDING' } });

    const guardResponse = {
      statusCode: 200, body: undefined,
      status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };
    const next = vi.fn();
    await deletionGuard.createRequireActivePlayerAccount({ database })(
      { orbitPlayer: { uid: 'resurrection-uid' } },
      guardResponse,
      next
    );
    expect(guardResponse).toMatchObject({ statusCode: 410, body: { code: 'PLAYER_ACCOUNT_DELETION_IN_PROGRESS' } });
    expect(next).not.toHaveBeenCalled();

    // Simulate an already in-flight privileged identity write that commits after
    // the first cleanup. The finalizer must remove it after Auth is gone.
    await database.setDocument('players/resurrection-uid', { id: 'resurrection-uid', name: 'Private Name' });
    await database.setDocument('players/resurrection-uid/private/identity', {
      verifiedDetails: { fullName: 'Private Name', dateOfBirth: '1990-01-01' }
    });
    const finishCleanup = (playerId, subjectId, deletionPolicy, options) => finalizePlayerDataCleanup(
      playerId,
      subjectId,
      deletionPolicy,
      {
        ...options,
        inventoryAuthoritativePlayer: async () => ({
          affectedAccounts: 0, affectedAccountKeys: [], affectedLegacyStateDocumentIds: [],
          linkedPlayerIds: [playerId], sensitiveValues: []
        }),
        inventoryFirebasePlayer,
        cleanupFirebasePlayer: async (uid, linkedIds) => {
          for (const identifier of new Set([uid, ...linkedIds])) {
            await database.deleteDocument(`players/${identifier}/private/identity`);
            await database.deleteDocument(`players/${identifier}`);
          }
          return 2;
        },
        anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0 })
      }
    );
    await expect(finalizePendingDeletionJobs({
      database,
      deletePlayerIdentityData: noPendingIdentityCleanup,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      readDeletionPolicy: () => policy,
      finalizePlayerDataCleanup: finishCleanup
    })).resolves.toEqual({ finalized: 1, failed: 0, pagesVisited: 1 });

    expect(await database.getDocument('players/resurrection-uid')).toBeNull();
    expect(await database.getDocument('players/resurrection-uid/private/identity')).toBeNull();
    expect(await database.getDocument(deletionGuard.playerDeletionBlockPath('resurrection-uid')))
      .toMatchObject({ status: 'blocked' });
    expect(await database.getDocument(deletionGuard.playerDeletionMarkerPath('resurrection-uid')))
      .toMatchObject({ status: 'blocked' });
    const completed = await database.getDocument('orbitAccountDeletionJobs/deleted_resurrection_subject');
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toContain('resurrection-uid');
  });

  it('stores completed jobs only under the pseudonymous subject with no raw UID', async () => {
    const database = await getDatabase();
    await database.setDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('raw-uid')}`, { playerId: 'raw-uid' });
    await updateJob(database, 'raw-uid', 'deleted_subject', 'finalizing', 'firebase-auth', [], { changedAccounts: 1 });
    expect(await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('deleted_subject')}`))
      .toMatchObject({ pendingAuthUid: 'raw-uid', status: 'finalizing' });
    await updateJob(database, 'raw-uid', 'deleted_subject', 'complete', 'complete', [], { changedAccounts: 1 });
    expect(await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('raw-uid')}`)).toBeNull();
    const completed = await database.getDocument(`orbitAccountDeletionJobs/${firestoreDocumentId('deleted_subject')}`);
    expect(completed).toMatchObject({ subjectId: 'deleted_subject', status: 'complete', result: { changedAccounts: 1 } });
    expect(JSON.stringify(completed)).not.toContain('raw-uid');
  });

  it('keeps repeated deletion and stale writers from downgrading finalizing or complete jobs', async () => {
    const now = Date.parse('2026-09-05T02:00:00.000Z');
    const database = await getDatabase();
    const subjectId = 'deleted_monotonic_subject';
    const playerId = 'monotonic-uid';
    const cleanupManifest = { linkedPlayerIds: [playerId], affectedAccountKeys: ['club-one'] };
    await updateJob(database, playerId, subjectId, 'finalizing', 'projection-publication', [], {
      changedAccounts: 1,
      cleanupManifest,
      requiredPublications: [{ accountKey: 'club-one', revision: 2 }]
    });
    const inventory = vi.fn();
    const scheduleFinalization = vi.fn(async () => ({ finalized: 0, failed: 0 }));
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => subjectId,
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: inventory,
      scheduleDeletionFinalizationDrain: scheduleFinalization,
      nowMs: () => now
    });
    const makeResponse = () => ({
      statusCode: 200,
      body: undefined,
      set: vi.fn(),
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; }
    });

    const beforeAuth = makeResponse();
    await handler({ orbitPlayer: { uid: playerId, auth_time: now / 1000 } }, beforeAuth);
    expect(beforeAuth).toMatchObject({
      statusCode: 202,
      body: { code: 'DELETION_FINALIZATION_PENDING', changedAccounts: 1 }
    });
    expect(beforeAuth.body).not.toHaveProperty('cleanupManifest');
    expect(beforeAuth.body).not.toHaveProperty('requiredPublications');
    expect(inventory).not.toHaveBeenCalled();

    const staleFailure = await updateJob(
      database, playerId, subjectId, 'failed', 'firebase-data', [], {}, 'stale failure'
    );
    expect(staleFailure.applied).toBe(false);
    expect(await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`))
      .toMatchObject({ status: 'finalizing', pendingAuthUid: playerId, result: { cleanupManifest } });

    await updateJob(database, playerId, subjectId, 'complete', 'complete', [], { changedAccounts: 1 });
    const afterAuth = makeResponse();
    await handler({ orbitPlayer: { uid: playerId, auth_time: now / 1000 } }, afterAuth);
    expect(afterAuth).toMatchObject({
      statusCode: 200,
      body: { ok: true, status: 'complete', changedAccounts: 1 }
    });
    const staleRunning = await updateJob(
      database, playerId, subjectId, 'running', 'authoritative-inventory', [], {}
    );
    expect(staleRunning.applied).toBe(false);
    const completed = await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`);
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toContain(playerId);
  });

  it('reclaims an expired running deletion lease from its durable manifest without admitting the old worker', async () => {
    const database = await getDatabase();
    const playerId = 'lease-resume-uid';
    const subjectId = 'deleted_lease_resume_subject';
    const oldNow = Date.parse('2026-09-05T01:00:00.000Z');
    const resumeNow = oldNow + 10 * 60 * 1000;
    const oldLeaseId = 'delete_oldlease0001';
    await updateJob(
      database,
      playerId,
      subjectId,
      'running',
      'firebase-data',
      [],
      {
        cleanupManifest: {
          linkedPlayerIds: [playerId, 'legacy-resume-profile'],
          affectedAccountKeys: ['resume-club'],
          firebaseClubIds: ['resume-club'],
          affectedLegacyStateDocumentIds: ['legacy-resume-state']
        }
      },
      '',
      { leaseId: oldLeaseId, nowMs: () => oldNow }
    );

    /** @type {(value?: any) => void} */
    let releaseInventory = () => {};
    const inventoryPaused = new Promise((resolve) => { releaseInventory = resolve; });
    let inventoryStarted;
    const enteredInventory = new Promise((resolve) => { inventoryStarted = resolve; });
    const cleanupFirebasePlayer = vi.fn(async () => 0);
    const deleteLinkedGameSessions = vi.fn(async () => ({ deletedGameSessions: 0, affectedClubIds: [] }));
    const deleteUser = vi.fn(async () => undefined);
    const handler = createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => subjectId,
      getDatabase: async () => database,
      randomUUID: () => 'newlease0000000001',
      inventoryAuthoritativePlayer: vi.fn(async () => {
        inventoryStarted();
        await inventoryPaused;
        return {
          affectedAccounts: 0, affectedAccountKeys: [], affectedLegacyStateDocumentIds: [],
          linkedPlayerIds: [playerId], sensitiveValues: []
        };
      }),
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: [], clubIds: [], linkedPlayerIds: [playerId], sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteLinkedGameSessions,
      deleteAnalyticalReportsForAccounts: async () => ({
        deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0
      }),
      deletePlayerIdentityData: noPendingIdentityCleanup,
      cleanupFirebasePlayer,
      replaceLinkedLegacyClubStates: async () => ({ replacedLegacyStates: 0 }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0, requiredPublications: [] }),
      loadState: async () => ({
        accountKey: 'resume-club', revision: 4,
        state: { playerPrivacyTombstones: [subjectId] }
      }),
      areRequiredPublicationsPublished: async () => true,
      finalizePlayerDataCleanup: async () => ({}),
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      nowMs: () => resumeNow
    });
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };
    const handling = handler({ orbitPlayer: { uid: playerId, auth_time: resumeNow / 1000 } }, response);
    await enteredInventory;

    const staleWrite = await updateJob(
      database,
      playerId,
      subjectId,
      'running',
      'authoritative-state',
      [],
      {},
      '',
      { expectedLeaseId: oldLeaseId, leaseId: oldLeaseId, nowMs: () => resumeNow }
    );
    expect(staleWrite.applied).toBe(false);
    releaseInventory();
    await handling;

    expect(response).toMatchObject({ statusCode: 200, body: { ok: true, status: 'complete' } });
    expect(deleteLinkedGameSessions).toHaveBeenCalledWith(
      database,
      ['resume-club'],
      expect.arrayContaining([playerId, 'legacy-resume-profile'])
    );
    expect(cleanupFirebasePlayer).toHaveBeenCalledWith(
      playerId,
      expect.arrayContaining([playerId, 'legacy-resume-profile']),
      subjectId,
      policy,
      expect.any(Object)
    );
    expect(deleteUser).toHaveBeenCalledWith(playerId);
    const completed = await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`);
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toMatch(/lease-resume-uid|legacy-resume-profile|cleanupManifest|leaseId/);
  });

  it('does not duplicate a live running deletion lease', async () => {
    const database = await getDatabase();
    const now = Date.parse('2026-09-05T02:00:00.000Z');
    const playerId = 'live-lease-uid';
    const subjectId = 'deleted_live_lease_subject';
    await updateJob(
      database,
      playerId,
      subjectId,
      'running',
      'telemetry',
      [],
      { changedAccounts: 1 },
      '',
      { leaseId: 'delete_livelease001', nowMs: () => now }
    );
    const inventory = vi.fn();
    const response = {
      statusCode: 200, body: undefined,
      set: vi.fn(), status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }
    };
    await createDeletePlayerAccountHandler({
      readDeletionPolicy: () => policy,
      subjectPseudonym: () => subjectId,
      getDatabase: async () => database,
      inventoryAuthoritativePlayer: inventory,
      scheduleDeletionFinalizationDrain: vi.fn(async () => ({})),
      nowMs: () => now
    })({ orbitPlayer: { uid: playerId, auth_time: now / 1000 } }, response);

    expect(response).toMatchObject({
      statusCode: 202,
      body: { code: 'DELETION_FINALIZATION_PENDING', changedAccounts: 1 }
    });
    expect(inventory).not.toHaveBeenCalled();
    expect(await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`))
      .toMatchObject({ status: 'running', currentStep: 'telemetry', leaseId: 'delete_livelease001' });
  });

  it('server-resumes an expired running job and retries it after a transient worker failure', async () => {
    const database = await getDatabase();
    const playerId = 'server-resume-uid';
    const subjectId = 'deleted_server_resume_subject';
    const startedAt = Date.parse('2026-09-05T01:00:00.000Z');
    const firstResumeAt = startedAt + 10 * 60 * 1000;
    const secondResumeAt = firstResumeAt + 10 * 60 * 1000;
    await updateJob(
      database,
      playerId,
      subjectId,
      'running',
      'authoritative-inventory',
      [],
      { cleanupManifest: { linkedPlayerIds: [playerId] } },
      '',
      { leaseId: 'delete_abandoned001', nowMs: () => startedAt }
    );

    const inventory = vi.fn()
      .mockRejectedValueOnce(new Error('transient inventory failure'))
      .mockResolvedValue({
        affectedAccounts: 0,
        affectedAccountKeys: [],
        affectedLegacyStateDocumentIds: [],
        linkedPlayerIds: [playerId],
        sensitiveValues: []
      });
    const deleteUser = vi.fn(async () => undefined);
    const dependencies = {
      database,
      readDeletionPolicy: () => policy,
      inventoryAuthoritativePlayer: inventory,
      inventoryFirebasePlayer: async () => ({
        affectedClubIds: [], clubIds: [], linkedPlayerIds: [playerId], sensitiveValues: []
      }),
      redactTelemetry: async () => undefined,
      deleteLinkedGameSessions: async () => ({ deletedGameSessions: 0, affectedClubIds: [] }),
      deleteAnalyticalReportsForAccounts: async () => ({
        deletedAnalyticalReports: 0, deletedAnalyticalReportChunks: 0
      }),
      deletePlayerIdentityData: noPendingIdentityCleanup,
      cleanupFirebasePlayer: async () => 0,
      replaceLinkedLegacyClubStates: async () => ({ replacedLegacyStates: 0 }),
      anonymizeAuthoritativeStates: async () => ({ changedAccounts: 0, requiredPublications: [] }),
      areRequiredPublicationsPublished: async () => true,
      finalizePlayerDataCleanup: async () => ({}),
      loadState: async () => null,
      getAdminSdk: () => ({ auth: () => ({ deleteUser }) }),
      getAdminApp: () => ({}),
      randomUUID: vi.fn()
        .mockReturnValueOnce('serverresumelease001')
        .mockReturnValueOnce('serverresumelease002')
    };

    await expect(resumeExpiredRunningDeletionJobs({
      ...dependencies,
      nowMs: () => firstResumeAt
    })).resolves.toEqual({ resumed: 0, failed: 1, pagesVisited: 1 });
    expect(await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`)).toMatchObject({
      status: 'running',
      pendingAuthUid: playerId,
      lastError: 'Error'
    });

    await expect(resumeExpiredRunningDeletionJobs({
      ...dependencies,
      nowMs: () => secondResumeAt
    })).resolves.toEqual({ resumed: 1, failed: 0, pagesVisited: 1 });
    expect(deleteUser).toHaveBeenCalledWith(playerId);
    const completed = await database.getDocument(`orbitAccountDeletionJobs/${subjectId}`);
    expect(completed).toMatchObject({ status: 'complete', currentStep: 'complete' });
    expect(JSON.stringify(completed)).not.toMatch(/server-resume-uid|cleanupManifest|leaseId/);
  });

  it('registers initial and requested-again deletion drains with the serverless continuation', async () => {
    /** @type {(value: any[]) => void} */
    let releaseFirstPage = () => {};
    const firstPage = new Promise((resolvePage) => { releaseFirstPage = resolvePage; });
    const database = {
      getDocument: vi.fn(async () => null),
      queryCollection: vi.fn()
        .mockImplementationOnce(async () => firstPage)
        .mockResolvedValue([]),
      setDocument: vi.fn(async () => undefined)
    };
    const waitUntil = vi.fn();
    const dependencies = { database, pageSize: 1, maximumPages: 1 };

    const first = scheduleDeletionFinalizationDrain({ force: true, dependencies, waitUntil });
    const joined = scheduleDeletionFinalizationDrain({ force: true, dependencies, waitUntil });
    expect(joined).toBe(first);
    expect(waitUntil).toHaveBeenCalledWith(first);

    releaseFirstPage([]);
    await first;
    await vi.waitFor(() => expect(waitUntil).toHaveBeenCalledTimes(2));
    await waitUntil.mock.calls[1][0];
    expect(database.queryCollection).toHaveBeenCalledTimes(4);
  });

  it('redacts telemetry selected by linked immutable ID without selecting an unrelated same-name record', async () => {
    const database = await getDatabase();
    await database.setDocument('orbitTelemetryEvents/linked', {
      event: 'linked', details: { profileId: 'legacy-one', name: 'Same Name', email: 'private@example.test' }
    });
    await database.setDocument('orbitTelemetryEvents/unrelated', {
      event: 'unrelated', details: { profileId: 'other-one', name: 'Same Name' }
    });
    await database.setDocument('orbitClientErrors/contact-only', {
      message: 'Request failed', details: { nested: { email: 'private@example.test', name: 'Same Name' } }
    });
    await redactTelemetry(
      database,
      ['firebase-uid', 'legacy-one'],
      ['Same Name', 'private@example.test'],
      'deleted_subject'
    );
    const linked = await database.getDocument('orbitTelemetryEvents/linked');
    const unrelated = await database.getDocument('orbitTelemetryEvents/unrelated');
    const contactOnly = await database.getDocument('orbitClientErrors/contact-only');
    expect(linked).toMatchObject({ details: { redacted: true } });
    expect(JSON.stringify(linked)).not.toMatch(/legacy-one|Same Name|private@example\.test/);
    expect(unrelated).toEqual({ event: 'unrelated', details: { profileId: 'other-one', name: 'Same Name' } });
    expect(contactOnly).toEqual({
      message: 'Request failed', details: { nested: { name: 'Same Name' } }
    });
    expect(JSON.stringify(contactOnly)).not.toContain('private@example.test');
  });

  it('removes unharvested sensitive fields from immutable-ID-linked telemetry', async () => {
    const database = await getDatabase();
    await database.setDocument('orbitTelemetryEvents/alternate-sensitive', {
      event: 'linked',
      profileId: 'target-profile',
      displayName: 'Alternate Display',
      contact: { email: 'alternate@example.test' },
      homeLocation: 'Private City',
      details: { dateOfBirth: '1980-02-03', mailingAddress: '5 Hidden Rd' }
    });

    await redactTelemetry(database, ['target-profile'], ['Known Name'], 'deleted_subject');

    const redacted = await database.getDocument('orbitTelemetryEvents/alternate-sensitive');
    expect(redacted).toEqual({
      event: 'linked',
      profileId: 'deleted_subject',
      displayName: 'Deleted player',
      details: { redacted: true }
    });
    expect(JSON.stringify(redacted)).not.toMatch(/Alternate Display|alternate@example\.test|Private City|1980-02-03|5 Hidden Rd/);
  });

  it('does not select or rewrite a telemetry identifier that merely contains a shorter deleted ID', async () => {
    const database = await getDatabase();
    await database.setDocument('orbitTelemetryEvents/token-linked', {
      event: 'linked', details: { note: 'Failure for p1, during request.' }
    });
    await database.setDocument('orbitTelemetryEvents/substring-collision', {
      event: 'unrelated', details: { profileId: 'p123', note: 'Failure for p123 during request.' }
    });

    await redactTelemetry(database, ['p1'], [], 'deleted_subject');

    expect(await database.getDocument('orbitTelemetryEvents/token-linked')).toEqual({
      event: 'linked', details: { note: 'Failure for p1, during request.' }
    });
    expect(await database.getDocument('orbitTelemetryEvents/substring-collision')).toEqual({
      event: 'unrelated', details: { profileId: 'p123', note: 'Failure for p123 during request.' }
    });
  });

  it('sanitizes shared contact PII without claiming or destroying an unrelated telemetry event', async () => {
    const database = await getDatabase();
    await database.setDocument('orbitTelemetryEvents/shared-contact', {
      event: 'unrelated-check-in',
      category: 'operational',
      details: {
        outcome: 'declined',
        contactPhone: '+15551234567',
        participant: 'Unrelated Person'
      }
    });

    await redactTelemetry(database, ['deleted-player'], ['+15551234567'], 'deleted_subject');

    expect(await database.getDocument('orbitTelemetryEvents/shared-contact')).toEqual({
      event: 'unrelated-check-in',
      category: 'operational',
      details: { outcome: 'declined', participant: 'Unrelated Person' }
    });
  });

  it('deletes legacy clubStates request children by immutable player fields without deleting the parent', async () => {
    const membershipDelete = vi.fn(async () => undefined);
    const waitlistDelete = vi.fn(async () => undefined);
    const query = (documents) => {
      const value = {
        orderBy: vi.fn(() => value),
        limit: vi.fn(() => value),
        startAfter: vi.fn(() => value),
        get: vi.fn(async () => ({ docs: documents }))
      };
      return value;
    };
    const clubStateRef = {
      delete: vi.fn(),
      collection: vi.fn((collectionName) => ({
        where: vi.fn((field, _operator, identifier) => {
          if (identifier !== 'firebase-uid') return query([]);
          if (collectionName === 'membershipRequests' && field === 'player.id') {
            return query([{ id: 'membership-one', ref: { delete: membershipDelete } }]);
          }
          if (collectionName === 'waitlistRequests' && field === 'playerId') {
            return query([{ id: 'waitlist-one', ref: { delete: waitlistDelete } }]);
          }
          return query([]);
        })
      }))
    };
    const database = { collection: vi.fn(() => query([{ id: 'club-one', ref: clubStateRef }])) };
    const admin = { firestore: { FieldPath: { documentId: () => '__name__' } } };
    await expect(cleanupLegacyClubStateRequests(database, admin, new Set(['firebase-uid']))).resolves.toBe(2);
    expect(membershipDelete).toHaveBeenCalledOnce();
    expect(waitlistDelete).toHaveBeenCalledOnce();
    expect(clubStateRef.delete).not.toHaveBeenCalled();
  });

  it('requires explicit category dispositions instead of inventing a retention policy', () => {
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', '');
    expect(readDeletionPolicy()).toBeNull();
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify(policy));
    expect(readDeletionPolicy()).toEqual(policy);
    expect(retainedCategories(policy)).toEqual([
      'security-deletion-tombstone:retained',
      'financial-records:anonymize',
      'audit-records:anonymize',
      'external-provider-records:retain'
    ]);
    for (const repositoryCategory of ['financialRecords', 'auditRecords']) {
      vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify({
        ...policy,
        [repositoryCategory]: 'retain'
      }));
      expect(readDeletionPolicy()).toBeNull();
    }
  });

  it('walks growing Firebase cleanup queries in bounded document-id pages', async () => {
    const firstPage = Array.from({ length: 200 }, (_value, index) => ({ id: `doc-${index}` }));
    const finalPage = [{ id: 'doc-200' }];
    const snapshots = [{ docs: firstPage }, { docs: finalPage }];
    let pageIndex = 0;
    const query = {
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      startAfter: vi.fn(() => query),
      get: vi.fn(async () => snapshots[pageIndex++])
    };
    const pageLengths = [];
    /** @param {Array<{ id: string }>} documents */
    async function recordPage(documents) {
      pageLengths.push(documents.length);
    }
    const operation = vi.fn(recordPage);
    const admin = { firestore: { FieldPath: { documentId: vi.fn(() => '__name__') } } };

    await expect(visitQueryPages(query, admin, operation)).resolves.toBe(201);
    expect(pageLengths).toEqual([200, 1]);
    expect(query.limit).toHaveBeenCalledWith(200);
    expect(query.startAfter).toHaveBeenCalledWith(firstPage.at(-1));
  });
});
