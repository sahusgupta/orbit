const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { loadLatestState, loadState } = require('../apps/api/src/database');
const { publishStateToFirebase } = require('../apps/api/src/firebasePublisher');

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/publish-firestore-layout.cjs',
    '  node scripts/publish-firestore-layout.cjs --club <clubId>',
    '  node scripts/publish-firestore-layout.cjs --sqlite <tablemanager.sqlite3>',
    '  node scripts/publish-firestore-layout.cjs --state-file <state.json>',
    '',
    'Writes these Firestore paths:',
    '  clubs/{licenseKey}',
    '  players/{clubName}/members/{playerId}',
    '  games/clubs/{clubName}/{gameId}',
    '',
    'Requires FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.'
  ].join('\n'));
}

function readStateFromSqlite(sqlitePath, clubId = '') {
  if (!sqlitePath || !fs.existsSync(sqlitePath)) return null;
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = clubId
      ? db.prepare('SELECT state_json FROM account_state WHERE account_key = ?').get(clubId)
      : db.prepare('SELECT state_json FROM account_state ORDER BY saved_at DESC LIMIT 1').get();
    return row?.state_json ? JSON.parse(row.state_json) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function getDefaultDesktopSqlitePaths() {
  const appData = process.env.APPDATA || '';
  return [
    path.join(appData, 'table-manager', 'tablemanager.sqlite3'),
    path.join(appData, 'table_manager', 'tablemanager.sqlite3'),
    path.join(appData, 'Orbit', 'tablemanager.sqlite3')
  ];
}

async function readState() {
  const stateFile = getArg('--state-file');
  if (stateFile) {
    const resolved = path.resolve(process.cwd(), stateFile);
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }

  const clubId = getArg('--club');
  const sqlitePath = getArg('--sqlite');
  if (sqlitePath) {
    return readStateFromSqlite(path.resolve(process.cwd(), sqlitePath), clubId);
  }

  const record = clubId ? loadState(clubId) : loadLatestState();
  if (record?.state) return record.state;

  for (const candidate of getDefaultDesktopSqlitePaths()) {
    const state = readStateFromSqlite(candidate, clubId);
    if (state) return state;
  }

  return null;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
    return;
  }

  const state = await readState();
  if (!state) {
    console.error('No saved state found. Save from the app first, set DATABASE_URL, or pass --state-file.');
    process.exitCode = 1;
    return;
  }

  const result = await publishStateToFirebase(state);
  if (!result.ok) {
    console.error(`Firebase publish skipped: ${result.reason || 'unknown reason'}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Published Firestore layout for ${result.accountKey}: ${result.players} players, ${result.games} games at ${result.savedAt}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
