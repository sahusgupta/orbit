function initializeSchema(database) {
  database.exec(`
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
      state_json TEXT NOT NULL,
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
  `);
}

module.exports = { initializeSchema };
