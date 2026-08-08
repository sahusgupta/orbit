const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { initializeSchema } = require('./schema');

let database;

function getDatabasePath() {
  const defaultDatabaseUrl = process.env.VERCEL ? 'file:/tmp/orbit-api.sqlite3' : 'file:./data/orbit-api.sqlite3';
  const configured = process.env.DATABASE_URL || defaultDatabaseUrl;
  if (configured.startsWith('file:')) {
    return path.resolve(process.cwd(), configured.slice('file:'.length));
  }
  if (/^postgres(?:ql)?:\/\//i.test(configured)) {
    throw new Error('Postgres DATABASE_URL is reserved for a future adapter. Use file:./data/orbit-api.sqlite3 for local SQLite.');
  }
  return path.resolve(process.cwd(), configured);
}

function getDatabase() {
  if (database) return database;
  const filePath = getDatabasePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  database = new DatabaseSync(filePath);
  initializeSchema(database);
  return database;
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = {
  closeDatabase,
  getDatabase,
  getDatabasePath
};
