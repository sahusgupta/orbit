import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { accountKey, testKey, createMutationState } from './management-mutation-state.mjs';

if (process.env.NODE_ENV !== 'test' || process.env.ORBIT_FIRESTORE_MEMORY !== 'true' || process.env.VERCEL) throw new Error('Only an isolated memory-test API is permitted.');
const require = createRequire(import.meta.url);
const { createApp } = require('../../../apps/api/src/app.js');
const database = require('../../../apps/api/src/database.js');
if (database.getDatabaseStatus().mode !== 'memory-test') throw new Error('Refusing a durable datastore.');
await database.saveState(createMutationState(), { expectedRevision: 0, mutationId: 'focus-seed' });
let reads = 0;
let notifications = 0;
const watchers = new Set();
const notifyWatchers = async () => {
  await Promise.all([...watchers].map(watch => watch()));
};
const app = createApp({ clientRoutes: { managementStateEvents: {
  watchStateHeader: (account, changed, failed) => {
    let active = true;
    const watch = async () => {
      try {
        const record = await database.loadState(account);
        if (active) {
          notifications += 1;
          changed({ revision: record?.revision ?? 0 });
        }
      } catch { if (active) failed(); }
    };
    watchers.add(watch);
    void watch();
    return () => { active = false; watchers.delete(watch); };
  }
} } });
const server = createServer(async (request, response) => {
  if (request.url?.startsWith('/__focus/')) {
    if (request.headers['x-orbit-api-key'] !== testKey) { response.writeHead(401).end(); return; }
    const record = await database.loadState(accountKey);
    if (request.url === '/__focus/unrelated' || request.url === '/__focus/no-op') {
      const state = request.url === '/__focus/unrelated'
        ? { ...record.state, profiles: record.state.profiles.map(profile => ({ ...profile, notes: 'Synthetic unrelated push update ' + record.revision })) }
        : record.state;
      await database.saveState(state, { expectedRevision: record.revision, mutationId: 'focus-push-' + record.revision });
      await notifyWatchers();
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ reads, notifications, watchers: watchers.size, record: await database.loadState(accountKey) }));
    return;
  }
  if (request.method === 'GET' && request.url === `/state/${accountKey}`) response.on('finish', () => { reads += 1; });
  if (request.method === 'POST' && request.url === '/state') response.on('finish', () => {
    if (response.statusCode >= 200 && response.statusCode < 300) void notifyWatchers();
  });
  app(request, response);
});
server.listen(4185, '127.0.0.1', () => console.log('Isolated focus API ready: real routes, memory-test datastore, synthetic authentication.'));
