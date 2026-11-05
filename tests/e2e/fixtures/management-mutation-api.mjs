import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { accountKey, testKeyFor, mutationSmokeAccounts, createMutationState } from './management-mutation-state.mjs';

if (process.env.NODE_ENV !== 'test' || process.env.ORBIT_FIRESTORE_MEMORY !== 'true' || process.env.VERCEL) throw new Error('Only an isolated memory-test API is permitted.');
const require = createRequire(import.meta.url);
const app = require('../../../apps/api/src/app.js');
const database = require('../../../apps/api/src/database.js');
const checkpoints = require('../../../apps/api/src/db/checkpoints.js');
const connection = require('../../../apps/api/src/db/connection.js');
if (database.getDatabaseStatus().mode !== 'memory-test') throw new Error('Refusing a durable datastore.');
for (const venue of mutationSmokeAccounts) {
  const state = createMutationState(venue);
  if (venue === accountKey) state.profiles[0].notes = '♠'.repeat(710_000);
  await database.saveState(state, { expectedRevision: 0, mutationId: 'smoke-seed' });
}
const saves = [];
const controls = new Map(mutationSmokeAccounts.map(venue => [venue, { nextFailure: 0, conflictNext: false, holdChunks: false }]));
const server = createServer(async (request, response) => {
  const venue = mutationSmokeAccounts.find(value => request.headers['x-orbit-api-key'] === testKeyFor(value));
  const control = controls.get(venue);
  if (request.url?.startsWith('/__smoke/')) {
    if (!control) { response.writeHead(401).end(); return; }
    if (request.url === '/__smoke/conflict') control.conflictNext = true;
    if (request.url === '/__smoke/hold-chunks') control.holdChunks = true;
    if (request.url === '/__smoke/resume') control.holdChunks = false;
    if (request.url?.startsWith('/__smoke/fail/')) control.nextFailure = Number(request.url.split('/').at(-1));
    const record = await database.loadState(venue);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ saves: saves.filter(item => item.accountKey === venue), record }));
    return;
  }
  if (control?.holdChunks && request.method === 'POST' && /\/state\/checkpoints\/[a-f0-9]{64}\/chunks\/[2-9][0-9]*$/.test(request.url || '')) {
    response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '30' }).end(JSON.stringify({ ok: false, error: 'Synthetic interrupted checkpoint chunk' }));
    return;
  }
  if (control && request.method === 'POST' && (request.url === '/state' || /\/state\/checkpoints\/[a-f0-9]{64}\/finalize$/.test(request.url || ''))) {
    const checkpoint = request.url !== '/state'
      ? await (await connection.getDatabase()).getDocument(checkpoints.stagingPath(venue)) : null;
    const resultDetails = () => ({ accountKey: venue, expectedRevision: checkpoint?.expectedRevision ?? request.body?.expectedRevision,
      mutationId: checkpoint?.mutationId ?? request.body?.mutationId,
      payloadBytes: checkpoint?.sourceBytes ?? Buffer.byteLength(JSON.stringify(request.body?.state || {}), 'utf8'),
      protocol: checkpoint ? 'checkpoint-v1' : 'legacy' });
    if (control.conflictNext) {
      control.conflictNext = false;
      const record = await database.loadState(venue);
      await database.saveState({ ...record.state, profiles: record.state.profiles.map(profile => ({ ...profile, notes: 'server-N-plus-one' })) }, { expectedRevision: record.revision, mutationId: 'smoke-other-device-' + record.revision });
    }
    if (control.nextFailure) {
      const status = control.nextFailure;
      control.nextFailure = 0;
      saves.push({ ...resultDetails(), status });
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: 'Synthetic API rejection' }));
      return;
    }
    response.on('finish', () => {
      saves.push({ ...resultDetails(), status: response.statusCode });
    });
  }
  app(request, response);
});
server.listen(4185, '127.0.0.1', () => console.log('Isolated mutation API ready: real routes, memory-test datastore, scoped synthetic authentication.'));
