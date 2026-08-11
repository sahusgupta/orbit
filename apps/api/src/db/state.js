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
    let changedEntityCount = 0;

    for (const entity of serialized.entities) {
      const key = `${entity.collectionName}\u0000${entity.entityId}`;
      nextKeys.add(key);
      const previous = existingByKey.get(key);
      if (previous && previous.content_hash === entity.contentHash && Number(previous.position) === entity.position) continue;
      await transaction.run(`
        INSERT INTO account_state_entities (
          account_key, collection_name, entity_id, position, content_hash, entity_json, revision, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(account_key, collection_name, entity_id) DO UPDATE SET
          position = excluded.position,
          content_hash = excluded.content_hash,
          entity_json = excluded.entity_json,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `, [
        accountKey,
        entity.collectionName,
        entity.entityId,
        entity.position,
        entity.contentHash,
        entity.entityJson,
        revision,
        savedAt
      ]);
      changedEntityCount += 1;
    }

    for (const previous of existingEntities) {
      const key = `${previous.collection_name}\u0000${previous.entity_id}`;
      if (nextKeys.has(key)) continue;
      await transaction.run(
        'DELETE FROM account_state_entities WHERE account_key = $1 AND collection_name = $2 AND entity_id = $3',
        [accountKey, previous.collection_name, previous.entity_id]
      );
      changedEntityCount += 1;
    }

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

async function listVenues() {
  const db = await getDatabase();
  const rows = await db.all(`
    SELECT
      account_state.account_key AS venue_id,
      account_state.venue_name AS venue_name,
      account_state.saved_at AS saved_at,
      account_state.revision AS revision,
      COUNT(DISTINCT clients.device_id) AS client_count
    FROM account_state
    LEFT JOIN clients ON clients.venue_id = account_state.account_key
    GROUP BY account_state.account_key, account_state.venue_name, account_state.saved_at, account_state.revision
    ORDER BY account_state.saved_at DESC
  `);
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
  loadLatestState,
  loadState,
  saveState,
  serializeStateEntities
};
