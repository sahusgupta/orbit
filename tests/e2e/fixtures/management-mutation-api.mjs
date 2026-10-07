import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { accountKey, testKey, createMutationState } from './management-mutation-state.mjs';

if (process.env.NODE_ENV !== 'test' || process.env.ORBIT_FIRESTORE_MEMORY !== 'true' || process.env.VERCEL) throw new Error('Only an isolated memory-test API is permitted.');
const require = createRequire(import.meta.url);
const app = require('../../../apps/api/src/app.js');
const database = require('../../../apps/api/src/database.js');
if (database.getDatabaseStatus().mode !== 'memory-test') throw new Error('Refusing a durable datastore.');
await database.saveState(createMutationState(), { expectedRevision: 0, mutationId: 'smoke-seed' });
const saves = [];
let nextFailure = 0;
let conflictNext = false;
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/__smoke/')) {
    if (request.headers['x-orbit-api-key'] !== testKey) { response.writeHead(401).end(); return; }
    if (request.url === '/__smoke/conflict') conflictNext = true;
    if (request.url?.startsWith('/__smoke/fail/')) nextFailure = Number(request.url.split('/').at(-1));
    const record = await database.loadState(accountKey);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ saves, record }));
    return;
  }
  if (request.method === 'POST' && request.url === '/state') {
    if (conflictNext) {
      conflictNext = false;
      const record = await database.loadState(accountKey);
      await database.saveState({ ...record.state, profiles: record.state.profiles.map(profile => ({ ...profile, notes: 'server-N-plus-one' })) }, { expectedRevision: record.revision, mutationId: 'smoke-other-device-' + record.revision });
    }
    if (nextFailure) {
      const status = nextFailure;
      nextFailure = 0;
      saves.push({ status });
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Synthetic API rejection' }));
      return;
    }
    response.on('finish', () => {
      const payload = request.body || {};
      saves.push({ status: response.statusCode, expectedRevision: payload.expectedRevision, mutationId: payload.mutationId, payloadBytes: Buffer.byteLength(JSON.stringify(payload.state || {}), 'utf8') });
    });
  }
  app(request, response);
});
server.listen(4185, '127.0.0.1', () => console.log('Isolated mutation API ready: real routes, memory-test datastore, scoped synthetic authentication.'));
