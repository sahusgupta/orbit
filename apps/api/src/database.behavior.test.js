import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import database from './database.js';

const databasePath = path.join(os.tmpdir(), `orbit-database-${process.pid}-${Date.now()}.sqlite3`);
process.env.DATABASE_URL = `file:${databasePath}`;

const {
  closeDatabase,
  getClient,
  getDatabasePath,
  getDatabaseStatus,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listStatePage,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordUpdateEvent,
  saveState,
  storeAnalyticalReport,
  upsertClient
} = database;

function makeState(overrides = {}) {
  return {
    games: [],
    sessions: [],
    playerSessions: [],
    profiles: [{ id: 'profile-1', name: 'Ada Lovelace', membershipStatus: 'Active' }],
    settings: {
      clubAccount: {
        clubName: 'Character Club',
        email: 'Owner@Example.com'
      }
    },
    ...overrides
  };
}

const clientPayload = {
  deviceId: 'device-1',
  venueId: 'Character Club',
  venueName: 'Character Club',
  deviceName: 'Front Desk',
  appVersion: '1.2.3',
  platform: 'win32',
  environment: 'test',
  lastSeenAt: '2026-08-07T12:00:00.000Z',
  updateStatus: 'ready',
  updateEvent: 'update-ready',
  currentUser: { id: 'staff-1', name: 'Grace' }
};

afterAll(async () => {
  await closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('API database facade behavior', () => {
  it('resolves local file URLs and identifies Postgres as a non-filesystem database', () => {
    expect(getDatabasePath()).toBe(path.resolve(databasePath));

    const configured = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://database.example/orbit';
    expect(getDatabasePath()).toBeNull();
    process.env.DATABASE_URL = configured;

    const nodeEnvironment = process.env.NODE_ENV;
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'production';
    expect(() => getDatabaseStatus()).toThrow('DATABASE_URL must point to durable PostgreSQL storage');
    process.env.DATABASE_URL = configured;
    if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvironment;
  });

  it('upserts and queries complete client records while retaining non-empty update fields', async () => {
    const inserted = await upsertClient(clientPayload);
    expect(inserted).toMatchObject({
      deviceId: 'device-1',
      venueId: 'character-club',
      venueName: 'Character Club',
      deviceName: 'Front Desk',
      appVersion: '1.2.3',
      platform: 'win32',
      environment: 'test',
      updateStatus: 'ready',
      updateEvent: 'update-ready',
      lastError: '',
      currentUser: null
    });

    const updated = await upsertClient({
      ...clientPayload,
      venueId: 'Second Room',
      venueName: 'Second Room',
      appVersion: '1.2.4',
      updateStatus: '',
      updateEvent: '',
      currentUser: null,
      lastSeenAt: '2026-08-07T13:00:00.000Z'
    });

    expect(updated).toMatchObject({
      venueId: 'second-room',
      venueName: 'Second Room',
      appVersion: '1.2.4',
      updateStatus: 'ready',
      updateEvent: 'update-ready',
      currentUser: null,
      lastSeenAt: '2026-08-07T13:00:00.000Z'
    });
    expect(updated.firstSeenAt).toBe(inserted.firstSeenAt);
    expect(await getClient('device-1')).toEqual(updated);
    expect(await listClients({ venueId: 'Second Room' })).toEqual([updated]);
  });

  it('records update, usage, and error history with current filtering and summary behavior', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    const updateClient = await recordUpdateEvent({
      ...clientPayload,
      updateEvent: 'downloaded',
      updateStatus: 'complete',
      occurredAt: '2026-08-07T14:00:00.000Z',
      details: { version: '1.2.4' }
    });
    const usageEvent = await recordTelemetryEvent({
      ...clientPayload,
      event: 'table-started',
      category: 'operations',
      route: 'floor',
      occurredAt: '2026-08-07T15:00:00.000Z',
      details: { tableId: 'table-1' }
    });
    const error = await recordClientError({
      ...clientPayload,
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: 'example stack',
      occurredAt: '2026-08-07T16:00:00.000Z',
      details: { recoverable: true }
    });

    expect(updateClient.updateStatus).toBe('complete');
    expect(await listClientUpdateEvents('device-1')).toEqual([
      expect.objectContaining({
        deviceId: 'device-1',
        venueId: 'character-club',
        event: 'downloaded',
        status: 'complete',
        details: { version: '1.2.4' },
        occurredAt: '2026-08-07T14:00:00.000Z'
      })
    ]);
    expect(usageEvent).toMatchObject({
      deviceId: 'device-1',
      event: 'table-started',
      category: 'operations',
      route: 'floor',
      details: { tableId: 'table-1' }
    });
    expect((await listTelemetryEvents({ deviceId: 'device-1', limit: 10 })).map((event) => event.event)).toEqual([
      'table-started',
      'downloaded'
    ]);
    expect(error).toMatchObject({
      deviceId: 'device-1',
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: expect.stringMatching(/^fingerprint:[a-f0-9]{16}$/),
      details: { recoverable: true }
    });
    expect(await listClientErrors({ venueId: 'Character Club' })).toEqual([error]);
    expect((await getClient('device-1'))?.lastError).toBe('Renderer failed');
    expect(await getTelemetrySummary()).toMatchObject({ clients: 1, events: 2, errors: 1, tableStarts24h: 1 });
  });

  it('round-trips normalized revisioned state, venue joins, reports, and close/reopen persistence', async () => {
    const state = makeState();
    const saved = await saveState(state, { expectedRevision: 0, mutationId: 'initial-state' });

    expect(saved.accountKey).toBe('owner-example.com');
    expect(await loadState('Owner@Example.com')).toMatchObject({
      accountKey: 'owner-example.com',
      venueName: 'Character Club',
      schemaVersion: 2,
      revision: 1,
      state
    });
    expect(await loadLatestState()).toMatchObject({ accountKey: 'owner-example.com', revision: 1, state });
    expect(await listStatePage({ limit: 25 })).toMatchObject({
      records: [expect.objectContaining({ accountKey: 'owner-example.com', revision: 1, state })],
      hasMore: false,
      nextCursor: null,
      queryCount: 2
    });
    expect(await listVenues()).toEqual([
      expect.objectContaining({
        venueId: 'owner-example.com',
        venueName: 'Character Club',
        clientCount: 0
      })
    ]);
    await expect(saveState({ ...state, games: null }, { expectedRevision: 1, mutationId: 'invalid' })).rejects.toThrow('State payload is missing games.');
    expect((await loadState('owner-example.com'))?.state).toEqual(state);

    const report = await storeAnalyticalReport({
      account: { accountKey: 'Owner@Example.com' },
      summary: { tables: 3 }
    });
    expect(report).toMatchObject({
      ok: true,
      accountKey: 'owner-example.com',
      deliveryStatus: 'stored'
    });
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/i);

    await closeDatabase();
    expect((await loadState('owner-example.com'))?.state).toEqual(state);
  });
});
