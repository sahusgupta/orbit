import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import database from './database.js';

const databasePath = path.join(os.tmpdir(), `orbit-history-${process.pid}-${Date.now()}.sqlite3`);
process.env.DATABASE_URL = `file:${databasePath}`;

const { closeDatabase, listTelemetryEvents, recordTelemetryEvent } = database;

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
  });

  afterAll(async () => {
    await closeDatabase();
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
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
});
