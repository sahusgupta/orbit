import fs from 'node:fs';
import vm from 'node:vm';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);
const accountKey = 'legacy-atomic-state';
const state = () => ({
  games: [], sessions: [], playerSessions: [], profiles: [], playerLedger: [],
  settings: { pilotAccess: { licenseId: accountKey } }
});
const response = () => ({
  statusCode: 200, body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; }
});

afterEach(() => vi.unstubAllEnvs());

describe('legacy full-state atomic server protection', () => {
  it('uses commit-time server fields and privacy tombstones when a future expected revision matches an interleaved write', async () => {
    const secret = 'synthetic-legacy-privacy-pseudonym-secret';
    vi.stubEnv('ORBIT_DELETION_PSEUDONYM_SECRET', secret);
    vi.stubEnv('ORBIT_ACCOUNT_DELETION_POLICY_JSON', JSON.stringify({ financialRecords: 'anonymize', auditRecords: 'anonymize', providerRecords: 'retain' }));
    const tombstone = `deleted_${createHmac('sha256', secret).update('deleted-profile').digest('hex').slice(0, 24)}`;
    const previous = {
      ...state(), selfCheckIn: { capabilityGeneration: 'revision-1' },
      membershipQrTokens: [{ id: 'revision-1-token' }], tournamentInterests: [{ id: 'revision-1-interest' }]
    };
    const concurrent = {
      ...state(), selfCheckIn: { capabilityGeneration: 'revision-2' },
      membershipQrTokens: [{ id: 'revision-2-token' }], tournamentInterests: [{ id: 'revision-2-interest' }],
      playerPrivacyTombstones: [tombstone]
    };
    const incoming = { ...previous, profiles: [{ id: 'deleted-profile', name: 'Synthetic Private Name' }], playerPrivacyTombstones: [] };
    const loadState = vi.fn(async () => ({ revision: 1, state: previous }));
    const logStateChanges = vi.fn();
    let committed;
    const saveState = vi.fn(async (nextState, options) => {
      if (committed) return { accountKey, revision: 3, duplicate: true };
      // Another writer has committed revision 2 after a possible stale route
      // preload. Its revision matches the incoming request's future expectation.
      // Only the transaction callback may select protected server values.
      expect(options.expectedRevision).toBe(2);
      const transformed = await options.transactionPrecondition({ currentState: concurrent, nextState });
      committed = transformed.nextState;
      return { accountKey, revision: 3, duplicate: false };
    });
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./client.js'), 'utf8'), {
      module, Buffer, Date,
      require(name) {
        if (name === '../database') return { loadState, saveState, schedulePublicationDrain: async () => [] };
        if (name === '../http/domainEvents') return { logStateChanges, logDomainChange: vi.fn() };
        return require(name);
      }
    });
    const routes = new Map();
    module.exports.registerClientRoutes({
      use() {}, get() {},
      post(path, ...handlers) { routes.set(path, handlers.at(-1)); }
    }, { broadcast() {} });
    const handler = routes.get('/state');
    const request = {
      orbitAuth: { accountKey }, body: { state: incoming, expectedRevision: 2, mutationId: 'legacy-interleaved-save' },
      get() { return ''; }
    };
    const first = response();
    await handler(request, first, (error) => { throw error; });
    expect(first).toMatchObject({ statusCode: 201, body: { ok: true, revision: 3, duplicate: false } });
    expect(committed).toMatchObject({
      selfCheckIn: concurrent.selfCheckIn, membershipQrTokens: concurrent.membershipQrTokens,
      tournamentInterests: concurrent.tournamentInterests, playerPrivacyTombstones: [tombstone], profiles: []
    });
    expect(loadState).not.toHaveBeenCalled();
    expect(logStateChanges).toHaveBeenCalledExactlyOnceWith(concurrent, committed, accountKey);
    const duplicate = response();
    await handler(request, duplicate, (error) => { throw error; });
    expect(duplicate).toMatchObject({ statusCode: 200, body: { ok: true, revision: 3, duplicate: true } });
    expect(logStateChanges).toHaveBeenCalledTimes(1);
    expect(first.body).not.toHaveProperty('state');
    expect(first.body).not.toHaveProperty('transactionResult');
  });
});
