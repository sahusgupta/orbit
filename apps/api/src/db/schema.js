const baseSqliteSchema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS clients (
    device_id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    venue_name TEXT,
    device_name TEXT,
    app_version TEXT NOT NULL,
    platform TEXT NOT NULL,
    environment TEXT NOT NULL,
    update_status TEXT,
    update_event TEXT,
    last_seen_at TEXT NOT NULL,
    last_error TEXT,
    current_user_json TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS clients_venue_id_idx ON clients (venue_id);
  CREATE INDEX IF NOT EXISTS clients_last_seen_at_idx ON clients (last_seen_at);

  CREATE TABLE IF NOT EXISTS client_update_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT,
    app_version TEXT,
    details_json TEXT,
    error TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (device_id) REFERENCES clients(device_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_telemetry_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    event TEXT NOT NULL,
    category TEXT NOT NULL,
    route TEXT,
    app_version TEXT,
    platform TEXT,
    details_json TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS client_telemetry_events_occurred_at_idx ON client_telemetry_events (occurred_at);
  CREATE INDEX IF NOT EXISTS client_telemetry_events_venue_id_idx ON client_telemetry_events (venue_id);

  CREATE TABLE IF NOT EXISTS client_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT,
    route TEXT,
    stack TEXT,
    app_version TEXT,
    platform TEXT,
    details_json TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS client_errors_occurred_at_idx ON client_errors (occurred_at);
  CREATE INDEX IF NOT EXISTS client_errors_venue_id_idx ON client_errors (venue_id);

  CREATE TABLE IF NOT EXISTS account_state (
    account_key TEXT PRIMARY KEY,
    venue_name TEXT,
    schema_version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS account_profiles (
    account_key TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_key, id),
    FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analytical_reports (
    id TEXT PRIMARY KEY,
    account_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    report_json TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'stored',
    delivery_error TEXT
  );
`;

const authoritativeSqliteSchema = `
  CREATE TABLE IF NOT EXISTS account_state_entities (
    account_key TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    entity_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_key, collection_name, entity_id),
    FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS account_state_entities_revision_idx
    ON account_state_entities (account_key, revision);

  CREATE TABLE IF NOT EXISTS state_mutations (
    account_key TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    mutation_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (account_key, mutation_id),
    FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS publication_outbox (
    account_key TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    PRIMARY KEY (account_key, revision),
    FOREIGN KEY (account_key) REFERENCES account_state(account_key) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS publication_outbox_pending_idx
    ON publication_outbox (status, next_attempt_at, created_at);
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS clients (
    device_id TEXT PRIMARY KEY,
    venue_id TEXT NOT NULL,
    venue_name TEXT,
    device_name TEXT,
    app_version TEXT NOT NULL,
    platform TEXT NOT NULL,
    environment TEXT NOT NULL,
    update_status TEXT,
    update_event TEXT,
    last_seen_at TEXT NOT NULL,
    last_error TEXT,
    current_user_json TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS clients_venue_id_idx ON clients (venue_id);
  CREATE INDEX IF NOT EXISTS clients_last_seen_at_idx ON clients (last_seen_at);

  CREATE TABLE IF NOT EXISTS client_update_events (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES clients(device_id) ON DELETE CASCADE,
    venue_id TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT,
    app_version TEXT,
    details_json TEXT,
    error TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_telemetry_events (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    event TEXT NOT NULL,
    category TEXT NOT NULL,
    route TEXT,
    app_version TEXT,
    platform TEXT,
    details_json TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS client_telemetry_events_occurred_at_idx ON client_telemetry_events (occurred_at);
  CREATE INDEX IF NOT EXISTS client_telemetry_events_venue_id_idx ON client_telemetry_events (venue_id);

  CREATE TABLE IF NOT EXISTS client_errors (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    venue_id TEXT NOT NULL,
    message TEXT NOT NULL,
    source TEXT,
    route TEXT,
    stack TEXT,
    app_version TEXT,
    platform TEXT,
    details_json TEXT,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS client_errors_occurred_at_idx ON client_errors (occurred_at);
  CREATE INDEX IF NOT EXISTS client_errors_venue_id_idx ON client_errors (venue_id);

  CREATE TABLE IF NOT EXISTS account_state (
    account_key TEXT PRIMARY KEY,
    venue_name TEXT,
    schema_version INTEGER NOT NULL,
    saved_at TEXT NOT NULL,
    state_json TEXT NOT NULL DEFAULT '{}',
    state_meta_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS account_state_entities (
    account_key TEXT NOT NULL REFERENCES account_state(account_key) ON DELETE CASCADE,
    collection_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    entity_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_key, collection_name, entity_id)
  );
  CREATE INDEX IF NOT EXISTS account_state_entities_revision_idx ON account_state_entities (account_key, revision);

  CREATE TABLE IF NOT EXISTS state_mutations (
    account_key TEXT NOT NULL REFERENCES account_state(account_key) ON DELETE CASCADE,
    mutation_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    mutation_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (account_key, mutation_id)
  );

  CREATE TABLE IF NOT EXISTS publication_outbox (
    account_key TEXT NOT NULL REFERENCES account_state(account_key) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    PRIMARY KEY (account_key, revision)
  );
  CREATE INDEX IF NOT EXISTS publication_outbox_pending_idx ON publication_outbox (status, next_attempt_at, created_at);

  CREATE TABLE IF NOT EXISTS account_profiles (
    account_key TEXT NOT NULL REFERENCES account_state(account_key) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_key, id)
  );

  CREATE TABLE IF NOT EXISTS analytical_reports (
    id TEXT PRIMARY KEY,
    account_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    report_json TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'stored',
    delivery_error TEXT
  );
`;

function addSqliteColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initializeSqliteSchema(database) {
  database.exec(baseSqliteSchema);
  addSqliteColumn(database, 'account_state', 'state_meta_json', "TEXT NOT NULL DEFAULT '{}'");
  addSqliteColumn(database, 'account_state', 'revision', 'INTEGER NOT NULL DEFAULT 0');
  database.exec(authoritativeSqliteSchema);
}

async function initializePostgresSchema(database) {
  await database.exec(postgresSchema);
  await database.exec("ALTER TABLE account_state ADD COLUMN IF NOT EXISTS state_meta_json TEXT NOT NULL DEFAULT '{}'");
  await database.exec('ALTER TABLE account_state ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0');
}

module.exports = {
  initializePostgresSchema,
  initializeSqliteSchema
};
