import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import database from './database.js';

const databasePath = path.join(os.tmpdir(), `orbit-database-${process.pid}-${Date.now()}.sqlite3`);
process.env.DATABASE_URL = `file:${databasePath}`;

const {
  closeDatabase,
  getClient,
  getDatabasePath,
  getTelemetrySummary,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
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

afterAll(() => {
  closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});

describe('API database facade behavior', () => {
  it('resolves file URLs and rejects the reserved Postgres adapter', () => {
    expect(getDatabasePath()).toBe(path.resolve(databasePath));

    const configured = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://database.example/orbit';
    expect(() => getDatabasePath()).toThrow('Postgres DATABASE_URL is reserved for a future adapter.');
    process.env.DATABASE_URL = configured;
  });

  it('upserts and queries complete client records while retaining non-empty update fields', () => {
    const inserted = upsertClient(clientPayload);
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
      currentUser: { id: 'staff-1', name: 'Grace' }
    });

    const updated = upsertClient({
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
    expect(getClient('device-1')).toEqual(updated);
    expect(listClients({ venueId: 'Second Room' })).toEqual([updated]);
  });

  it('records update, usage, and error history with current filtering and summary behavior', () => {
    const updateClient = recordUpdateEvent({
      ...clientPayload,
      updateEvent: 'downloaded',
      updateStatus: 'complete',
      occurredAt: '2026-08-07T14:00:00.000Z',
      details: { version: '1.2.4' }
    });
    const usageEvent = recordTelemetryEvent({
      ...clientPayload,
      event: 'table-started',
      category: 'operations',
      route: 'floor',
      occurredAt: '2026-08-07T15:00:00.000Z',
      details: { tableId: 'table-1' }
    });
    const error = recordClientError({
      ...clientPayload,
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: 'example stack',
      occurredAt: '2026-08-07T16:00:00.000Z',
      details: { recoverable: true }
    });

    expect(updateClient.updateStatus).toBe('complete');
    expect(listClientUpdateEvents('device-1')).toEqual([
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
    expect(listTelemetryEvents({ deviceId: 'device-1', limit: 10 }).map((event) => event.event)).toEqual([
      'table-started',
      'downloaded'
    ]);
    expect(error).toMatchObject({
      deviceId: 'device-1',
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: 'example stack',
      details: { recoverable: true }
    });
    expect(listClientErrors({ venueId: 'Character Club' })).toEqual([error]);
    expect(getClient('device-1')?.lastError).toBe('Renderer failed');
    expect(getTelemetrySummary()).toMatchObject({ clients: 1, events: 2, errors: 1, tableStarts24h: 1 });
  });

  it('round-trips validated account state, venue joins, reports, and close/reopen persistence', () => {
    const state = makeState();
    const saved = saveState(state);

    expect(saved.accountKey).toBe('owner-example.com');
    expect(loadState('Owner@Example.com')).toMatchObject({
      accountKey: 'owner-example.com',
      venueName: 'Character Club',
      schemaVersion: 1,
      state
    });
    expect(loadLatestState()).toMatchObject({ accountKey: 'owner-example.com', state });
    expect(listVenues()).toEqual([
      expect.objectContaining({
        venueId: 'owner-example.com',
        venueName: 'Character Club',
        clientCount: 0
      })
    ]);
    expect(() => saveState({ ...state, games: null })).toThrow('State payload is missing games.');
    expect(loadState('owner-example.com')?.state).toEqual(state);

    const report = storeAnalyticalReport({
      account: { accountKey: 'Owner@Example.com' },
      summary: { tables: 3 }
    });
    expect(report).toMatchObject({
      ok: true,
      accountKey: 'owner-example.com',
      deliveryStatus: 'stored'
    });
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/i);

    closeDatabase();
    expect(loadState('owner-example.com')?.state).toEqual(state);
  });
});
