import { beforeEach, describe, expect, it, vi } from 'vitest';
import clientRoutes from './client.js';
import connection from '../db/connection.js';
import deletionGuard from '../playerDeletionGuard.js';

beforeEach(async () => connection.resetDatabaseForTests());

function responseHarness() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('management analytical report privacy boundary', () => {
  it('rejects a stale post-deletion report by immutable ID without name matching', async () => {
    const database = await connection.getDatabase();
    await deletionGuard.markPlayerDeletion(database, 'deleted-player');
    const storeAnalyticalReport = vi.fn(async () => ({ ok: true }));
    const handler = clientRoutes.createAnalyticalReportHandler({
      database,
      loadState: async () => ({ state: { playerPrivacyTombstones: [] } }),
      storeAnalyticalReport
    });
    const staleResponse = responseHarness();
    await handler({
      orbitAuth: { accountKey: 'club-one' },
      body: {
        account: { accountKey: 'club-one' },
        usage: { recentEvents: [{ profileId: 'deleted-player', playerName: 'Same Name' }] }
      }
    }, staleResponse);
    expect(staleResponse).toMatchObject({
      statusCode: 409,
      body: { ok: false, code: 'REPORT_CONTAINS_DELETED_PLAYER_DATA' }
    });
    expect(storeAnalyticalReport).not.toHaveBeenCalled();

    const unrelated = {
      account: { accountKey: 'club-one' },
      usage: { recentEvents: [{ profileId: 'other-player', playerName: 'Same Name' }] }
    };
    const acceptedResponse = responseHarness();
    await handler({ orbitAuth: { accountKey: 'club-one' }, body: unrelated }, acceptedResponse);
    expect(acceptedResponse.statusCode).toBe(201);
    expect(storeAnalyticalReport).toHaveBeenCalledWith(unrelated);
  });
});

describe('publication recovery boundary', () => {
  it('forwards only explicit terminated-runtime evidence, ignores caller clocks, and schedules compensation', async () => {
    const recoverAbandonedPublicationClaim = vi.fn(async () => ({ recovered: true }));
    const schedulePublicationDrain = vi.fn(async () => []);
    const handler = clientRoutes.createPublicationRecoveryHandler({
      recoverAbandonedPublicationClaim,
      schedulePublicationDrain
    });
    const response = responseHarness();
    await handler({
      body: {
        accountKey: 'club-one',
        revision: 4,
        claimId: 'opaque-claim',
        runtimeTerminated: true,
        evidenceRef: '0123456789abcdef',
        observedAt: '2999-09-05T02:00:00.000Z',
        ignored: 'not-forwarded'
      }
    }, response);

    expect(response).toMatchObject({ statusCode: 200, body: { ok: true, recovered: true } });
    expect(recoverAbandonedPublicationClaim).toHaveBeenCalledWith({
      accountKey: 'club-one',
      revision: 4,
      claimId: 'opaque-claim',
      runtimeTerminated: true,
      evidenceRef: '0123456789abcdef'
    });
    expect(schedulePublicationDrain).toHaveBeenCalledWith({ force: true });
  });
});
