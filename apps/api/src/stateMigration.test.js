import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import database from './database.js';

const databasePath = path.join(os.tmpdir(), `orbit-state-migration-${process.pid}-${Date.now()}.sqlite3`);
process.env.DATABASE_URL = `file:${databasePath}`;

const legacyState = {
  games: [{ id: 'holdem', name: 'Holdem', maxSeats: 9 }],
  sessions: [],
  playerSessions: [],
  profiles: [{ id: 'legacy-player', name: 'Legacy Player' }],
  settings: { clubAccount: { clubName: 'Legacy Club', email: 'legacy@example.com' } }
};

const legacyDatabase = new DatabaseSync(databasePath);
legacyDatabase.exec(`
  CREATE TABLE account_state (
    account_key TEXT PRIMARY KEY,
    venue_name TEXT,
    schema_version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE account_profiles (
    account_key TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_key, id)
  );
`);
legacyDatabase.prepare(`
  INSERT INTO account_state (account_key, venue_name, schema_version, saved_at, state_json, updated_at)
  VALUES (?, ?, 1, ?, ?, ?)
`).run('legacy-example.com', 'Legacy Club', '2026-08-01T00:00:00.000Z', JSON.stringify(legacyState), '2026-08-01T00:00:00.000Z');
legacyDatabase.prepare(`
  INSERT INTO account_profiles (account_key, id, name, raw_json, updated_at) VALUES (?, ?, ?, ?, ?)
`).run('legacy-example.com', 'legacy-player', 'Legacy Player', JSON.stringify(legacyState.profiles[0]), '2026-08-01T00:00:00.000Z');
legacyDatabase.close();

afterAll(async () => {
  await database.closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
});

describe('legacy authoritative-state migration', () => {
  it('reads the legacy checkpoint before converting it safely on revision-zero migration', async () => {
    await expect(database.loadState('legacy-example.com')).resolves.toMatchObject({
      schemaVersion: 1,
      revision: 0,
      state: legacyState
    });

    await expect(database.saveState(legacyState, {
      expectedRevision: 0,
      mutationId: 'legacy-cache-import',
      mutationType: 'cache-migration'
    })).resolves.toMatchObject({ revision: 1, changedEntityCount: 2 });

    await expect(database.loadState('legacy-example.com')).resolves.toMatchObject({
      schemaVersion: 2,
      revision: 1,
      state: legacyState
    });
  });
});
