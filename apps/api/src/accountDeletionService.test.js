import { afterEach, describe, expect, it, vi } from 'vitest';
import deletionService from './accountDeletionService.js';

const { anonymizePlayerState, readDeletionPolicy, retainedCategories } = deletionService;

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
});
