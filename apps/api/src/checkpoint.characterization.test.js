import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import express from 'express';
import { describe, expect, it } from 'vitest';
const require = createRequire(__filename);
const stateStore = require('./db/state.js');
const connection = require('./db/connection.js');

describe('pre-checkpoint transport characterization', () => {
  it('cannot transport an ordinary accounting action over retained non-telemetry history although storage accepts it', async () => {
    await connection.resetDatabaseForTests();
    const state = {
      games: [], sessions: [], playerSessions: [], profiles: [],
      playerLedger: [{ id: 'retained', amount: 25, note: '♠'.repeat(750_000) }, { id: 'ordinary-action', amount: 10 }],
      settings: { pilotAccess: { licenseId: 'checkpoint-characterization' } }
    };
    const source = JSON.stringify(state);
    const envelope = JSON.stringify({ state, expectedRevision: 0, mutationId: 'ordinary-accounting' });
    expect(Buffer.byteLength(source)).toBeGreaterThan(2_000_000);
    expect(Buffer.byteLength(envelope)).toBeGreaterThan(Buffer.byteLength(source));
    expect(Buffer.byteLength(envelope)).toBeGreaterThan(envelope.length);
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.post('/state', (_request, response) => response.json({ ok: true }));
    app.use((error, _request, response, _next) => response.status(error.status || 500).json({ ok: false }));
    const server = createServer(app).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('An isolated listening address is required.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/state`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: envelope
      });
      expect(response.status).toBe(413);
      await expect(stateStore.saveState(state, { expectedRevision: 0, mutationId: 'direct-storage' }))
        .resolves.toMatchObject({ revision: 1, publication: { status: 'pending' } });
      expect((await stateStore.loadState('checkpoint-characterization')).state.playerLedger).toEqual(state.playerLedger);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
