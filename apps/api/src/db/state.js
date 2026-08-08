const { getAccountKeyFromState, sanitizeAccountKey, validateStatePayload } = require('../orbitCore');
const { getDatabase } = require('./connection');

function saveState(state) {
  validateStatePayload(state);
  const db = getDatabase();
  const accountKey = getAccountKeyFromState(state);
  const savedAt = new Date().toISOString();
  const venueName = state.settings?.clubAccount?.clubName || '';
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO account_state (account_key, venue_name, schema_version, saved_at, state_json, updated_at)
      VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(account_key) DO UPDATE SET
        venue_name = excluded.venue_name,
        schema_version = excluded.schema_version,
        saved_at = excluded.saved_at,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(accountKey, venueName, savedAt, JSON.stringify(state), savedAt);
    db.prepare('DELETE FROM account_profiles WHERE account_key = ?').run(accountKey);
    const insertProfile = db.prepare(`
      INSERT INTO account_profiles (account_key, id, name, raw_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const profile of state.profiles || []) {
      insertProfile.run(accountKey, profile.id, profile.name || '', JSON.stringify(profile), savedAt);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { accountKey, savedAt };
}

function loadState(accountKey) {
  const normalized = sanitizeAccountKey(accountKey);
  const row = getDatabase()
    .prepare('SELECT account_key, venue_name, schema_version, saved_at, state_json FROM account_state WHERE account_key = ?')
    .get(normalized);
  if (!row) return null;
  return {
    accountKey: row.account_key,
    venueName: row.venue_name || '',
    schemaVersion: row.schema_version,
    savedAt: row.saved_at,
    state: JSON.parse(row.state_json)
  };
}

function loadLatestState() {
  const row = getDatabase()
    .prepare('SELECT account_key, venue_name, schema_version, saved_at, state_json FROM account_state ORDER BY saved_at DESC LIMIT 1')
    .get();
  if (!row) return null;
  return {
    accountKey: row.account_key,
    venueName: row.venue_name || '',
    schemaVersion: row.schema_version,
    savedAt: row.saved_at,
    state: JSON.parse(row.state_json)
  };
}

function listVenues() {
  return getDatabase()
    .prepare(`
      SELECT
        account_state.account_key AS venue_id,
        account_state.venue_name AS venue_name,
        account_state.saved_at AS saved_at,
        COUNT(DISTINCT clients.device_id) AS client_count
      FROM account_state
      LEFT JOIN clients ON clients.venue_id = account_state.account_key
      GROUP BY account_state.account_key
      ORDER BY account_state.saved_at DESC
    `)
    .all()
    .map((row) => ({
      venueId: row.venue_id,
      venueName: row.venue_name || '',
      savedAt: row.saved_at,
      clientCount: Number(row.client_count || 0)
    }));
}

module.exports = {
  listVenues,
  loadLatestState,
  loadState,
  saveState
};
