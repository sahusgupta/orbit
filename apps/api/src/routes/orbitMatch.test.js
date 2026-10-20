import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const require = createRequire(resolve(process.cwd(), 'apps/api/src/routes/orbitMatch.test.js'));
const { registerOrbitMatchRoutes } = require('./orbitMatch.js');
const { requireFirebasePlayer } = require('../paymentService.js');
const { requirePlayerAppCheck } = require('../appCheckService.js');
const { requireActivePlayerAccount } = require('../playerDeletionGuard.js');

describe('Orbit Match route authorization', () => {
  it('uses the existing verified account, App Check, and deletion boundary for both routes', () => {
    const routes = [];
    const app = { get(path, ...handlers) { routes.push({ method: 'GET', path, handlers }); },
      post(path, ...handlers) { routes.push({ method: 'POST', path, handlers }); } };
    registerOrbitMatchRoutes(app);
    expect(routes.map(({ method, path }) => `${method} ${path}`)).toEqual(['GET /player/match', 'POST /player/match/operations']);
    routes.forEach(({ handlers }) => expect(handlers.slice(0, 3)).toEqual([requirePlayerAppCheck, requireFirebasePlayer, requireActivePlayerAccount]));
  });

  it('commits owner-only read rules, backend-only receipt rules, and exact-document index exemptions', () => {
    const rules = readFileSync(resolve(process.cwd(), 'player-app/firestore.rules'), 'utf8');
    const matchBlock = rules.slice(rules.indexOf('match /orbitMatch/{matchDocumentId}'), rules.indexOf('match /games/{rootDocument}'));
    expect(matchBlock).toContain("matchDocumentId == 'state' && isSelf(playerId)");
    expect(matchBlock).toContain('(hasEmail() || hasPhone()) && !playerDeletionBlocked(playerId)');
    expect(matchBlock).toContain('allow create, update, delete: if false;');
    expect(matchBlock).toContain('match /receipts/{mutationId}');
    expect(matchBlock).toContain('allow read, write: if false;');
    const indexes = JSON.parse(readFileSync(resolve(process.cwd(), 'player-app/firestore.indexes.json'), 'utf8'));
    expect(indexes.fieldOverrides.filter((entry) => entry.collectionGroup === 'orbitMatch')).toEqual(
      ['preferences', 'decisions', 'undo', 'events', 'recentMutationIds'].map((fieldPath) => ({ collectionGroup: 'orbitMatch', fieldPath, indexes: [] }))
    );
  });
});
