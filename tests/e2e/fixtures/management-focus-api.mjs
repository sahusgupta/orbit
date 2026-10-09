import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { accountKey, testKey, createMutationState } from './management-mutation-state.mjs';

if (process.env.NODE_ENV !== 'test' || process.env.ORBIT_FIRESTORE_MEMORY !== 'true' || process.env.VERCEL) throw new Error('Only an isolated memory-test API is permitted.');
const require = createRequire(import.meta.url);
const app = require('../../../apps/api/src/app.js');
const database = require('../../../apps/api/src/database.js');
if (database.getDatabaseStatus().mode !== 'memory-test') throw new Error('Refusing a durable datastore.');
await database.saveState(createMutationState(), { expectedRevision: 0, mutationId: 'focus-seed' });
let reads = 0;
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/__focus/')) {
    if (request.headers['x-orbit-api-key'] !== testKey) { response.writeHead(401).end(); return; }
    const record = await database.loadState(accountKey);
    if (request.url === '/__focus/unrelated') {
      await database.saveState({ ...record.state, profiles: record.state.profiles.map(profile => ({ ...profile, notes: 'Synthetic unrelated poll update ' + record.revision })) }, { expectedRevision: record.revision, mutationId: 'focus-unrelated-' + record.revision });
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ reads, record: await database.loadState(accountKey) }));
    return;
  }
  if (request.method === 'GET' && request.url?.startsWith('/state/')) response.on('finish', () => { reads += 1; });
  app(request, response);
});
server.listen(4185, '127.0.0.1', () => console.log('Isolated focus API ready: real routes, memory-test datastore, synthetic authentication.'));
