const fs = require('fs');

const projectId = 'tabletalk-s';
const confirmationToken = 'DELETE_STRESS_CLUBS';

function hasFlag(name) {
  return process.argv.includes(name);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? '' : String(process.argv[index + 1] || '');
}

function isStressClubName(value) {
  return String(value || '').toLocaleLowerCase().includes('stress');
}

function selectStressClubs(documents) {
  return documents
    .map((document) => ({
      id: document.id,
      name: String(document.data()?.name || '').trim()
    }))
    .filter((club) => club.id && isStressClubName(club.name))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim());
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  throw new Error(
    'Firebase Admin credentials are required. Set FIREBASE_SERVICE_ACCOUNT_JSON, ' +
    'FIREBASE_SERVICE_ACCOUNT_BASE64, or GOOGLE_APPLICATION_CREDENTIALS.'
  );
}

function getFirestore() {
  const admin = require('firebase-admin');
  const serviceAccount = loadServiceAccount();
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || projectId
      });
  return admin.firestore(app);
}

async function recursivelyDeleteIfPresent(database, reference) {
  const snapshot = await reference.get();
  if (!snapshot.exists) return false;
  await database.recursiveDelete(reference);
  return true;
}

async function main() {
  const execute = hasFlag('--execute');
  const suppliedConfirmation = getArg('--confirm');
  if (execute && suppliedConfirmation !== confirmationToken) {
    throw new Error(`Execution requires --confirm ${confirmationToken}.`);
  }

  const database = getFirestore();
  const clubsSnapshot = await database.collection('clubs').get();
  const matches = selectStressClubs(clubsSnapshot.docs);

  if (!matches.length) {
    console.log('No clubs with "stress" in the name were found. Nothing to remove.');
    return;
  }

  console.log(`${execute ? 'Removing' : 'Dry run: found'} ${matches.length} stress club${matches.length === 1 ? '' : 's'}:`);
  matches.forEach((club) => console.log(`- clubs/${club.id} (${club.name})`));

  if (!execute) {
    console.log('');
    console.log(`No data changed. Re-run with --execute --confirm ${confirmationToken} to remove only the clubs listed above.`);
    return;
  }

  for (const club of matches) {
    const clubReference = database.collection('clubs').doc(club.id);
    const currentClub = await clubReference.get();
    const currentName = String(currentClub.data()?.name || '').trim();
    if (!currentClub.exists || !isStressClubName(currentName)) {
      throw new Error(`Safety check failed for clubs/${club.id}; its current name no longer contains "stress".`);
    }

    await database.recursiveDelete(clubReference);
    const removedSavedState = await recursivelyDeleteIfPresent(
      database,
      database.collection('clubStates').doc(club.id)
    );
    console.log(`Removed clubs/${club.id}${removedSavedState ? ` and clubStates/${club.id}` : ''}.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = {
  confirmationToken,
  isStressClubName,
  selectStressClubs
};
