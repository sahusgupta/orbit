const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { initializePostgresSchema, initializeSqliteSchema } = require('./schema');

let databasePromise;

function getConfiguredDatabaseUrl() {
  const configured = String(process.env.DATABASE_URL || '').trim();
  if (configured) {
    if (
      !isPostgresUrl(configured) &&
      (process.env.VERCEL || process.env.NODE_ENV === 'production') &&
      process.env.ORBIT_ALLOW_LOCAL_SQLITE !== 'true'
    ) {
      throw new Error('Hosted production requires durable PostgreSQL. SQLite is allowed only for explicit isolated local verification.');
    }
    return configured;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must point to durable PostgreSQL storage in hosted production. Ephemeral SQLite is disabled.');
  }
  return 'file:./data/orbit-api.sqlite3';
}

function isPostgresUrl(value) {
  return /^postgres(?:ql)?:\/\//i.test(value);
}

function getDatabasePath() {
  const configured = getConfiguredDatabaseUrl();
  if (isPostgresUrl(configured)) return null;
  const rawPath = configured.startsWith('file:') ? configured.slice('file:'.length) : configured;
  return path.resolve(process.cwd(), rawPath);
}

function getDatabaseStatus() {
  const configured = getConfiguredDatabaseUrl();
  return {
    engine: isPostgresUrl(configured) ? 'postgresql' : 'sqlite',
    durable: isPostgresUrl(configured)
  };
}

function sqliteStatement(sql, params) {
  const ordered = [];
  const rewritten = sql.replace(/\$(\d+)/g, (_match, index) => {
    ordered.push(params[Number(index) - 1]);
    return '?';
  });
  return { ordered, rewritten };
}

function createSqliteAdapter(rawDatabase) {
  const adapter = {
    engine: 'sqlite',
    async exec(sql) {
      rawDatabase.exec(sql);
    },
    async run(sql, params = []) {
      const query = sqliteStatement(sql, params);
      const result = rawDatabase.prepare(query.rewritten).run(...query.ordered);
      return { changes: Number(result.changes || 0), lastInsertRowid: result.lastInsertRowid };
    },
    async get(sql, params = []) {
      const query = sqliteStatement(sql, params);
      return rawDatabase.prepare(query.rewritten).get(...query.ordered);
    },
    async all(sql, params = []) {
      const query = sqliteStatement(sql, params);
      return rawDatabase.prepare(query.rewritten).all(...query.ordered);
    },
    async transaction(operation) {
      rawDatabase.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation(adapter);
        rawDatabase.exec('COMMIT');
        return result;
      } catch (error) {
        rawDatabase.exec('ROLLBACK');
        throw error;
      }
    },
    async close() {
      rawDatabase.close();
    }
  };
  return adapter;
}

function createPostgresAdapter(pool) {
  const fromQueryTarget = (target, release = async () => undefined) => {
    const adapter = {
      engine: 'postgresql',
      async exec(sql) {
        await target.query(sql);
      },
      async run(sql, params = []) {
        const result = await target.query(sql, params);
        return { changes: Number(result.rowCount || 0) };
      },
      async get(sql, params = []) {
        const result = await target.query(sql, params);
        return result.rows[0];
      },
      async all(sql, params = []) {
        const result = await target.query(sql, params);
        return result.rows;
      },
      async close() {
        await release();
      }
    };
    return adapter;
  };
  const adapter = fromQueryTarget(pool, () => pool.end());
  adapter.transaction = async (operation) => {
    const client = await pool.connect();
    const transaction = fromQueryTarget(client, () => client.release());
    transaction.transaction = adapter.transaction;
    try {
      await client.query('BEGIN');
      const result = await operation(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  return adapter;
}

async function createDatabase() {
  const configured = getConfiguredDatabaseUrl();
  if (isPostgresUrl(configured)) {
    const pool = new Pool({
      connectionString: configured,
      max: Math.min(Math.max(Number(process.env.DATABASE_POOL_MAX || 10), 1), 30),
      connectionTimeoutMillis: Math.min(Math.max(Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000), 500), 30000),
      idleTimeoutMillis: Math.min(Math.max(Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000), 1000), 120000)
    });
    const adapter = createPostgresAdapter(pool);
    await initializePostgresSchema(adapter);
    return adapter;
  }

  const filePath = getDatabasePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const rawDatabase = new DatabaseSync(filePath);
  initializeSqliteSchema(rawDatabase);
  return createSqliteAdapter(rawDatabase);
}

function getDatabase() {
  if (!databasePromise) databasePromise = createDatabase();
  return databasePromise;
}

async function closeDatabase() {
  if (!databasePromise) return;
  const database = await databasePromise;
  databasePromise = undefined;
  await database.close();
}

module.exports = {
  closeDatabase,
  getDatabase,
  getDatabasePath,
  getDatabaseStatus,
  getConfiguredDatabaseUrl,
  isPostgresUrl
};
