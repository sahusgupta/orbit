import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);
const { registerCheckpointRoutes } = require('./checkpoints.js');
const { requireClientAuth } = require('../http/auth.js');
const { handleApiError } = require('../http/middleware.js');
const connection = require('../db/connection.js');
const stateStore = require('../db/state.js');
const { checkpointLimits } = require('../db/checkpoints.js');
const credential = 'synthetic-checkpoint-http-key';
let server;
let baseUrl;

const request = (path, body, authenticated = true) => fetch(`${baseUrl}${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-orbit-api-key': credential } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

beforeEach(async () => {
  await connection.resetDatabaseForTests();
  vi.stubEnv('ORBIT_MACHINE_CREDENTIALS_JSON', JSON.stringify([{
    id: 'checkpoint-http', key: credential, accountKey: 'checkpoint-http', scopes: ['client:write'], expiresAt: '2099-01-01T00:00:00Z'
  }]));
  vi.stubEnv('ORBIT_ALLOW_INSECURE_LOOPBACK_AUTH', 'false');
  const app = express();
  app.use('/state/checkpoints', express.json({ limit: checkpointLimits.maximumEnvelopeBytes, inflate: false }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/state', requireClientAuth);
  registerCheckpointRoutes(app);
  app.use(handleApiError);
  server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('An isolated listening address is required.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('authenticated checkpoint HTTP boundary', () => {
  it('negotiates before the legacy preflight, transfers a large retained venue, and recovers it with bounded envelopes', async () => {
    const capabilities = await (await request('/state/capabilities')).json();
    expect(capabilities).toEqual({ ok: true, checkpoint: checkpointLimits });
    const state = {
      games: [], sessions: [{ id: 'session', status: 'Running' }], playerSessions: [], profiles: [],
      playerLedger: [{ id: 'historic', amount: 125, note: '♠'.repeat(710_000) }, { id: 'new-action', amount: 10 }],
      settings: { pilotAccess: { licenseId: 'checkpoint-http' } }
    };
    const source = Buffer.from(JSON.stringify(state));
    const manifest = {
      protocol: checkpointLimits.protocol, accountKey: 'checkpoint-http', mutationId: 'http-resume', expectedRevision: 0,
      sourceBytes: source.length, chunkCount: Math.ceil(source.length / checkpointLimits.chunkBytes),
      sha256: createHash('sha256').update(source).digest('hex')
    };
    const begin = await request('/state/checkpoints', manifest);
    expect(begin.status).toBe(201);
    const upload = await begin.json();
    if (!upload || typeof upload !== 'object' || !('id' in upload) || typeof upload.id !== 'string') throw new Error('An upload ID is required.');
    for (let index = manifest.chunkCount - 1; index >= 0; index -= 1) {
      const body = { accountKey: manifest.accountKey, data: source.subarray(index * checkpointLimits.chunkBytes, (index + 1) * checkpointLimits.chunkBytes).toString('base64') };
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(checkpointLimits.maximumEnvelopeBytes);
      expect((await request(`/state/checkpoints/${upload.id}/chunks/${index}`, body)).status).toBe(200);
    }
    const status = await (await request(`/state/checkpoints/${upload.id}`)).json();
    expect(status).toMatchObject({ received: Array.from({ length: manifest.chunkCount }, (_, index) => index) });
    const committed = await request(`/state/checkpoints/${upload.id}/finalize`, { accountKey: manifest.accountKey });
    expect(committed.status).toBe(201);
    expect(await committed.json()).toMatchObject({ ok: true, revision: 1, publication: { status: 'pending' } });
    expect((await stateStore.loadState(manifest.accountKey)).state.playerLedger).toEqual(state.playerLedger);
    const download = await (await request(`/state/checkpoint/${manifest.accountKey}`)).json();
    expect(download).toMatchObject({ sha256: manifest.sha256, sourceBytes: manifest.sourceBytes, revision: 1 });
    const unchanged = await request(`/state/checkpoint/${manifest.accountKey}?knownRevision=1`);
    expect(await unchanged.json()).toMatchObject({ notModified: true, revision: 1, sha256: manifest.sha256, publication: { status: 'pending' } });
    for (const query of ['-1', '1.0', 'NaN', '9007199254740992', '1&knownRevision=1']) {
      expect((await request(`/state/checkpoint/${manifest.accountKey}?knownRevision=${query}`)).status).toBe(400);
    }
    const first = await (await request(`/state/checkpoint/${manifest.accountKey}/1/chunks/0`)).json();
    if (!first || typeof first !== 'object' || !('data' in first) || typeof first.data !== 'string') throw new Error('A checkpoint chunk is required.');
    expect(Buffer.from(first.data, 'base64').length).toBe(checkpointLimits.chunkBytes);
    const duplicate = await request(`/state/checkpoints/${upload.id}/finalize`, { accountKey: manifest.accountKey });
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ revision: 1, duplicate: true });
  });

  it('requires authentication and tenant binding for capabilities, staging and recovery', async () => {
    expect((await request('/state/capabilities', undefined, false)).status).toBe(401);
    expect((await request('/state/checkpoints', { accountKey: 'another-tenant' })).status).toBe(403);
    expect((await request('/state/checkpoint/another-tenant')).status).toBe(403);
    expect((await request(`/state/checkpoints/${'a'.repeat(64)}?accountKey=another-tenant`)).status).toBe(403);
    expect((await request(`/state/checkpoints/${'a'.repeat(64)}/chunks/0`, { accountKey: 'another-tenant', data: 'e30=' })).status).toBe(403);
    expect((await request(`/state/checkpoints/${'a'.repeat(64)}/finalize`, { accountKey: 'another-tenant' })).status).toBe(403);
    const unsupported = await request('/state/checkpoints', { accountKey: 'checkpoint-http', protocol: 'unsupported' });
    expect(unsupported.status).toBe(426);
  });

  it('limits the full request envelope and rejects compressed transfer before allocating decompressed snapshots', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tooLarge = await request('/state/checkpoints', { marker: 'x'.repeat(checkpointLimits.maximumEnvelopeBytes) });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    const compressed = await fetch(`${baseUrl}/state/checkpoints`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'x-orbit-api-key': credential },
      body: gzipSync(Buffer.from('{"marker":"compressed"}'))
    });
    expect(compressed.status).toBe(415);
    expect(await compressed.json()).toMatchObject({ code: 'UNSUPPORTED_CONTENT_ENCODING' });
  });
});
