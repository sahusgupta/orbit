import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import database from './database.js';

const {
  closeDatabase,
  getOperationalQueryPlans,
  listClientErrors,
  listClients,
  listTelemetryEvents,
  recordClientError,
  recordTelemetryEvent,
  upsertClient
} = database;

describe('telemetry event history pagination', () => {
  beforeAll(async () => {
    for (let index = 0; index < 205; index += 1) {
      await recordTelemetryEvent({
        deviceId: 'history-test-device',
        venueId: 'history-test-venue',
        venueName: 'History Test Venue',
        deviceName: 'History Test Device',
        appVersion: '1.0.0',
        platform: 'win32',
        environment: 'test',
        event: `event-${index}`,
        category: 'test',
        occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await upsertClient({
        deviceId: `page-device-${String(index).padStart(2, '0')}`,
        venueId: 'pagination-client-venue',
        venueName: 'Pagination Venue',
        deviceName: `Device ${index}`,
        appVersion: '1.0.0',
        platform: 'win32',
        environment: 'test',
        lastSeenAt: '2026-01-02T00:00:00.000Z'
      });
      await recordClientError({
        deviceId: `page-device-${String(index).padStart(2, '0')}`,
        venueId: 'pagination-client-venue',
        venueName: 'Pagination Venue',
        deviceName: `Device ${index}`,
        appVersion: '1.0.0',
        platform: 'win32',
        environment: 'test',
        message: `page-error-${index}`,
        occurredAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString()
      });
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('walks backward through every event without gaps or duplicates', async () => {
    const collected = [];
    let page = await listTelemetryEvents({ limit: 100 });

    while (page.length) {
      collected.push(...page);
      const oldest = page[page.length - 1];
      page = await listTelemetryEvents({
        limit: 100,
        beforeOccurredAt: oldest.occurredAt,
        beforeId: oldest.id
      });
    }

    expect(collected).toHaveLength(205);
    expect(new Set(collected.map((event) => event.id)).size).toBe(205);
    expect(collected[0].event).toBe('event-204');
    expect(collected[204].event).toBe('event-0');
  });

  it('uses stable cursors for clients and errors without gaps or duplicates', async () => {
    const clients = [];
    let clientPage = await listClients({ venueId: 'pagination-client-venue', limit: 6 });
    while (clientPage.length) {
      clients.push(...clientPage);
      const last = clientPage.at(-1);
      clientPage = await listClients({
        venueId: 'pagination-client-venue',
        limit: 6,
        beforeLastSeenAt: last.lastSeenAt,
        beforeDeviceId: last.deviceId
      });
    }
    expect(clients).toHaveLength(15);
    expect(new Set(clients.map((client) => client.deviceId)).size).toBe(15);

    const errors = [];
    let errorPage = await listClientErrors({ venueId: 'pagination-client-venue', limit: 6 });
    while (errorPage.length) {
      errors.push(...errorPage);
      const last = errorPage.at(-1);
      errorPage = await listClientErrors({
        venueId: 'pagination-client-venue',
        limit: 6,
        beforeOccurredAt: last.occurredAt,
        beforeId: last.id
      });
    }
    expect(errors).toHaveLength(15);
    expect(new Set(errors.map((error) => error.id)).size).toBe(15);
  });

  it('declares the matching Firestore composite indexes for operational history', async () => {
    const plans = await getOperationalQueryPlans();
    expect(plans).toMatchObject({ engine: 'firestore' });
    expect(plans.indexes.join(' ')).toContain('orbitTelemetryEvents');
    expect(plans.indexes.join(' ')).toContain('orbitClients');
  });
});
