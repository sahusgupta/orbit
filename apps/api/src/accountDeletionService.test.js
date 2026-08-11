import { afterEach, describe, expect, it, vi } from 'vitest';
import deletionService from './accountDeletionService.js';

const { anonymizePlayerState, readDeletionPolicy, retainedCategories, visitQueryPages } = deletionService;

const policy = {
  financialRecords: 'anonymize',
  auditRecords: 'anonymize',
  providerRecords: 'retain'
};

afterEach(() => vi.unstubAllEnvs());

describe('classification-aware player account deletion', () => {
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
    expect(result.buyIns[0]).toEqual({ id: 'buy-1', profileId: 'deleted_subject', playerName: 'Deleted player' });
    expect(result.timeFeeLogs[0]).toMatchObject({ playerName: 'Deleted player' });
    expect(result.revenueTransactions[0]).not.toHaveProperty('playerEmail');
    expect(result.correctionLog[0].note).toBe('deleted_subject');
  });

  it('requires explicit category dispositions instead of inventing a retention policy', () => {
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', '');
    expect(readDeletionPolicy()).toBeNull();
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify(policy));
    expect(readDeletionPolicy()).toEqual(policy);
    expect(retainedCategories(policy)).toEqual([
      'financial-records:anonymize',
      'audit-records:anonymize',
      'external-provider-records:retain'
    ]);
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
