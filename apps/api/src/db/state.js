const crypto = require('crypto');
const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('../orbitCore');
const { getDatabase } = require('./connection');

const entityFormat = 'entity-v1';

class StateConflictError extends Error {
  constructor(accountKey, expectedRevision, currentRevision) {
    super(`State revision conflict for ${accountKey}. Expected ${expectedRevision}; current revision is ${currentRevision}.`);
    this.name = 'StateConflictError';
    this.code = 'STATE_REVISION_CONFLICT';
    this.accountKey = accountKey;
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function serializeStateEntities(state) {
  const root = {};
  const arrayKeys = [];
  const entities = [];
  for (const [collectionName, value] of Object.entries(state)) {
    if (!Array.isArray(value)) {
      root[collectionName] = value;
      continue;
    }
    root[collectionName] = [];
    arrayKeys.push(collectionName);
    const usedIds = new Set();
    value.forEach((entity, position) => {
      const contentHash = hashJson(entity);
      const candidateId = entity && typeof entity === 'object' && !Array.isArray(entity)
        ? String(entity.id || '').trim()
        : '';
      let entityId = candidateId || `_item_${contentHash.slice(0, 24)}`;
      if (usedIds.has(entityId)) entityId = `${entityId}_${position}`;
      usedIds.add(entityId);
      entities.push({
        collectionName,
        entityId,
        position,
        contentHash,
        entityJson: JSON.stringify(entity)
      });
    });
  }
  return {
    metaJson: JSON.stringify({ format: entityFormat, root, arrayKeys }),
    entities
  };
}

function deserializeState(row, entityRows) {
  let meta;
  try {
    meta = JSON.parse(row.state_meta_json || '{}');
  } catch {
    meta = null;
  }
  if (meta?.format !== entityFormat || !meta.root || !Array.isArray(meta.arrayKeys)) {
    return JSON.parse(row.state_json || '{}');
  }
  const state = { ...meta.root };
  for (const arrayKey of meta.arrayKeys) state[arrayKey] = [];
  for (const entityRow of entityRows) {
    if (!Array.isArray(state[entityRow.collection_name])) state[entityRow.collection_name] = [];
    state[entityRow.collection_name].push(JSON.parse(entityRow.entity_json));
  }
  return state;
}

function mapPublication(row) {
  if (!row) return { status: 'not-queued', attempts: 0, error: '' };
  return {
    status: row.status,
    attempts: Number(row.attempts || 0),
    error: row.last_error || '',
    publishedAt: row.published_at || null,
    nextAttemptAt: row.next_attempt_at || null
  };
}

async function bulkUpsertEntities(transaction, accountKey, entities, revision, savedAt) {
  const chunkSize = 100;
  for (let offset = 0; offset < entities.length; offset += chunkSize) {
    const chunk = entities.slice(offset, offset + chunkSize);
    const params = [];
    const values = chunk.map((entity) => {
      const start = params.length + 1;
      params.push(
        accountKey,
        entity.collectionName,
        entity.entityId,
        entity.position,
        entity.contentHash,
        entity.entityJson,
        revision,
        savedAt
      );
      return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4}, $${start + 5}, $${start + 6}, $${start + 7})`;
    });
    await transaction.run(`
      INSERT INTO account_state_entities (
        account_key, collection_name, entity_id, position, content_hash, entity_json, revision, updated_at
      ) VALUES ${values.join(', ')}
      ON CONFLICT(account_key, collection_name, entity_id) DO UPDATE SET
        position = excluded.position,
        content_hash = excluded.content_hash,
        entity_json = excluded.entity_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `, params);
  }
}

async function bulkDeleteEntities(transaction, accountKey, entities) {
  const chunkSize = 200;
  for (let offset = 0; offset < entities.length; offset += chunkSize) {
    const chunk = entities.slice(offset, offset + chunkSize);
    const params = [accountKey];
    const matches = chunk.map((entity) => {
      const start = params.length + 1;
      params.push(entity.collection_name, entity.entity_id);
      return `(collection_name = $${start} AND entity_id = $${start + 1})`;
    });
    await transaction.run(
      `DELETE FROM account_state_entities WHERE account_key = $1 AND (${matches.join(' OR ')})`,
      params
    );
  }
}

async function getPublicationStatus(accountKey, revision) {
  const db = await getDatabase();
  const normalized = sanitizeAccountKey(accountKey);
  const row = await db.get(
    `SELECT status, attempts, last_error, published_at, next_attempt_at
     FROM publication_outbox WHERE account_key = $1 AND revision = $2`,
    [normalized, Number(revision)]
  );
  return mapPublication(row);
}

async function saveState(state, options = {}) {
  validateStatePayload(state);
  const db = await getDatabase();
  const accountKey = getAccountKeyFromState(state);
  const savedAt = new Date().toISOString();
  const venueName = state.settings?.clubAccount?.clubName || '';
  const mutationId = String(options.mutationId || crypto.randomUUID()).trim().slice(0, 180);
  const mutationType = String(options.mutationType || 'state-replace').trim().slice(0, 80);
  const expectedRevision = Number(options.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('A non-negative expectedRevision is required for state mutations.');
  }
  if (!mutationId) throw new Error('A stable mutationId is required for state mutations.');

  return db.transaction(async (transaction) => {
    if (transaction.engine === 'postgresql') {
      await transaction.get('SELECT pg_advisory_xact_lock(hashtext($1)) AS locked', [accountKey]);
    }
    const existingMutation = await transaction.get(
      'SELECT revision, created_at FROM state_mutations WHERE account_key = $1 AND mutation_id = $2',
      [accountKey, mutationId]
    );
    if (existingMutation) {
      const revision = Number(existingMutation.revision);
      return {
        accountKey,
        savedAt: existingMutation.created_at,
        revision,
        mutationId,
        duplicate: true,
        publication: await getPublicationStatusWithin(transaction, accountKey, revision)
      };
    }

    const current = await transaction.get(
      `SELECT revision FROM account_state WHERE account_key = $1${transaction.engine === 'postgresql' ? ' FOR UPDATE' : ''}`,
      [accountKey]
    );
    const currentRevision = Number(current?.revision || 0);
    if (currentRevision !== expectedRevision) {
      throw new StateConflictError(accountKey, expectedRevision, currentRevision);
    }
    const revision = currentRevision + 1;
    const serialized = serializeStateEntities(state);

    await transaction.run(`
      INSERT INTO account_state (
        account_key, venue_name, schema_version, saved_at, state_json, state_meta_json, revision, updated_at
      ) VALUES ($1, $2, 2, $3, '{}', $4, $5, $3)
      ON CONFLICT(account_key) DO UPDATE SET
        venue_name = excluded.venue_name,
        schema_version = excluded.schema_version,
        saved_at = excluded.saved_at,
        state_json = excluded.state_json,
        state_meta_json = excluded.state_meta_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `, [accountKey, venueName, savedAt, serialized.metaJson, revision]);

    const existingEntities = await transaction.all(
      `SELECT collection_name, entity_id, position, content_hash
       FROM account_state_entities WHERE account_key = $1`,
      [accountKey]
    );
    const existingByKey = new Map(existingEntities.map((entity) => [
      `${entity.collection_name}\u0000${entity.entity_id}`,
      entity
    ]));
    const nextKeys = new Set();
    const changedEntities = [];

    for (const entity of serialized.entities) {
      const key = `${entity.collectionName}\u0000${entity.entityId}`;
      nextKeys.add(key);
      const previous = existingByKey.get(key);
      if (previous && previous.content_hash === entity.contentHash && Number(previous.position) === entity.position) continue;
      changedEntities.push(entity);
    }

    const deletedEntities = existingEntities.filter((previous) => {
      const key = `${previous.collection_name}\u0000${previous.entity_id}`;
      return !nextKeys.has(key);
    });
    await bulkUpsertEntities(transaction, accountKey, changedEntities, revision, savedAt);
    await bulkDeleteEntities(transaction, accountKey, deletedEntities);
    const changedEntityCount = changedEntities.length + deletedEntities.length;

    await transaction.run('DELETE FROM account_profiles WHERE account_key = $1', [accountKey]);
    await transaction.run(`
      INSERT INTO state_mutations (account_key, mutation_id, revision, mutation_type, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [accountKey, mutationId, revision, mutationType, savedAt]);
    await transaction.run(`
      INSERT INTO publication_outbox (
        account_key, revision, payload_json, status, attempts, next_attempt_at,
        last_error, created_at, updated_at, published_at
      ) VALUES ($1, $2, $3, 'pending', 0, $4, '', $4, $4, NULL)
    `, [accountKey, revision, JSON.stringify(state), savedAt]);

    return {
      accountKey,
      savedAt,
      revision,
      mutationId,
      duplicate: false,
      changedEntityCount,
      publication: { status: 'pending', attempts: 0, error: '', publishedAt: null, nextAttemptAt: savedAt }
    };
  });
}

async function getPublicationStatusWithin(database, accountKey, revision) {
  const row = await database.get(
    `SELECT status, attempts, last_error, published_at, next_attempt_at
     FROM publication_outbox WHERE account_key = $1 AND revision = $2`,
    [accountKey, revision]
  );
  return mapPublication(row);
}

async function mapStateRow(db, row) {
  if (!row) return null;
  const entityRows = await db.all(
    `SELECT collection_name, entity_json FROM account_state_entities
     WHERE account_key = $1 ORDER BY collection_name ASC, position ASC`,
    [row.account_key]
  );
  const revision = Number(row.revision || 0);
  return {
    accountKey: row.account_key,
    venueName: row.venue_name || '',
    schemaVersion: Number(row.schema_version),
    savedAt: row.saved_at,
    revision,
    publication: revision > 0 ? await getPublicationStatusWithin(db, row.account_key, revision) : mapPublication(null),
    state: deserializeState(row, entityRows)
  };
}

async function loadState(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  const db = await getDatabase();
  const row = await db.get(
    `SELECT account_key, venue_name, schema_version, saved_at, state_json, state_meta_json, revision
     FROM account_state WHERE account_key = $1`,
    [normalized]
  );
  return mapStateRow(db, row);
}

async function loadLatestState() {
  const db = await getDatabase();
  const row = await db.get(`
    SELECT account_key, venue_name, schema_version, saved_at, state_json, state_meta_json, revision
    FROM account_state ORDER BY saved_at DESC LIMIT 1
  `);
  return mapStateRow(db, row);
}

async function listStatePage(options = {}) {
  const database = await getDatabase();
  const limit = Math.min(Math.max(Number(options.limit || 25), 1), 50);
  const afterAccountKey = sanitizeAccountKey(options.afterAccountKey || '');
  const params = [];
  const where = afterAccountKey ? 'WHERE account_state.account_key > $1' : '';
  if (afterAccountKey) params.push(afterAccountKey);
  const rows = await database.all(`
    SELECT
      account_state.account_key,
      account_state.venue_name,
      account_state.schema_version,
      account_state.saved_at,
      account_state.state_json,
      account_state.state_meta_json,
      account_state.revision,
      publication_outbox.status,
      publication_outbox.attempts,
      publication_outbox.last_error,
      publication_outbox.published_at,
      publication_outbox.next_attempt_at
    FROM account_state
    LEFT JOIN publication_outbox
      ON publication_outbox.account_key = account_state.account_key
      AND publication_outbox.revision = account_state.revision
    ${where}
    ORDER BY account_state.account_key ASC
    LIMIT ${limit + 1}
  `, params);
  const pageRows = rows.slice(0, limit);
  if (!pageRows.length) return { records: [], hasMore: false, nextCursor: null, queryCount: 1 };

  const placeholders = pageRows.map((_, index) => `$${index + 1}`).join(', ');
  const accountKeys = pageRows.map((row) => row.account_key);
  const entityRows = await database.all(`
    SELECT account_key, collection_name, entity_json
    FROM account_state_entities
    WHERE account_key IN (${placeholders})
    ORDER BY account_key ASC, collection_name ASC, position ASC
  `, accountKeys);
  const entitiesByAccount = new Map();
  for (const entity of entityRows) {
    const entries = entitiesByAccount.get(entity.account_key) || [];
    entries.push(entity);
    entitiesByAccount.set(entity.account_key, entries);
  }
  return {
    records: pageRows.map((row) => ({
      accountKey: row.account_key,
      venueName: row.venue_name || '',
      schemaVersion: Number(row.schema_version),
      savedAt: row.saved_at,
      revision: Number(row.revision || 0),
      publication: mapPublication(row.status ? row : null),
      state: deserializeState(row, entitiesByAccount.get(row.account_key) || [])
    })),
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? pageRows.at(-1).account_key : null,
    queryCount: 2
  };
}

async function listVenues(filters = {}) {
  const db = await getDatabase();
  const params = [];
  let cursorClause = '';
  if (filters.beforeSavedAt) {
    cursorClause = 'WHERE (account_state.saved_at < $1 OR (account_state.saved_at = $2 AND account_state.account_key > $3))';
    params.push(String(filters.beforeSavedAt), String(filters.beforeSavedAt), String(filters.beforeVenueId || ''));
  }
  const limit = Math.min(Math.max(Number(filters.limit || 100), 1), 251);
  const rows = await db.all(`
    SELECT
      account_state.account_key AS venue_id,
      account_state.venue_name AS venue_name,
      account_state.saved_at AS saved_at,
      account_state.revision AS revision,
      COUNT(DISTINCT clients.device_id) AS client_count
    FROM account_state
    LEFT JOIN clients ON clients.venue_id = account_state.account_key
    ${cursorClause}
    GROUP BY account_state.account_key, account_state.venue_name, account_state.saved_at, account_state.revision
    ORDER BY account_state.saved_at DESC, account_state.account_key ASC
    LIMIT ${limit}
  `, params);
  return rows.map((row) => ({
    venueId: row.venue_id,
    venueName: row.venue_name || '',
    savedAt: row.saved_at,
    revision: Number(row.revision || 0),
    clientCount: Number(row.client_count || 0)
  }));
}

module.exports = {
  StateConflictError,
  deserializeState,
  getPublicationStatus,
  listVenues,
  listStatePage,
  loadLatestState,
  loadState,
  saveState,
  serializeStateEntities
};
