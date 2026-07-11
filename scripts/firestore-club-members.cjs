const crypto = require('crypto');
const fs = require('fs');

const { initializeApp, getApps } = require('firebase/app');
const {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  serverTimestamp,
  setDoc
} = require('firebase/firestore');

const firebaseConfig = {
  apiKey: 'AIzaSyAdLo3z7aMkCV06uXU53RZOmn3UMxcjgsA',
  authDomain: 'tabletalk-s.firebaseapp.com',
  projectId: 'tabletalk-s',
  storageBucket: 'tabletalk-s.firebasestorage.app',
  messagingSenderId: '133175572500',
  appId: '1:133175572500:web:77d0d79a654f4becfd8f01',
  measurementId: 'G-BKK44RBCYK'
};

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/firestore-club-members.cjs --club <clubId>',
    '  node scripts/firestore-club-members.cjs --club <clubId> --ensure-club [--name "Club Name"]',
    '',
    'Examples:',
    '  node scripts/firestore-club-members.cjs --club lic_d7edb60440043bdb',
    '  node scripts/firestore-club-members.cjs --club lic_d7edb60440043bdb --ensure-club --name "Pilot Club"',
    '',
    'For writes blocked by Firestore rules, set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service-account JSON file,',
    'or set FIREBASE_SERVICE_ACCOUNT_JSON to the JSON contents.'
  ].join('\n'));
}

function getDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true });
  } catch {
    return getFirestore(app);
  }
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  return null;
}

async function getServiceAccountToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`
    })
  });
  if (!response.ok) throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ('mapValue' in value) return firestoreFieldsToJs(value.mapValue.fields || {});
  return undefined;
}

function firestoreFieldsToJs(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, firestoreValueToJs(value)]));
}

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: jsToFirestoreFields(value) } };
  return { stringValue: String(value) };
}

function jsToFirestoreFields(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, jsToFirestoreValue(value)]));
}

function restBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function restFetchJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore REST request failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function ensureClubWithRest(projectId, token, clubId, clubName) {
  const now = new Date().toISOString();
  const url = `${restBase(projectId)}/clubs/${encodeURIComponent(clubId)}`;
  await restFetchJson(url, token, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: jsToFirestoreFields({
        id: clubId,
        licenseId: clubId,
        name: clubName || `Club ${clubId}`,
        savedAt: now,
        generatedAt: now,
        updatedAt: now
      })
    })
  });
}

async function readMembershipNamesWithRest(projectId, token, clubId) {
  const listUrl = `${restBase(projectId)}/clubs/${encodeURIComponent(clubId)}/memberships?pageSize=1000`;
  const membershipList = await restFetchJson(listUrl, token);
  const names = (membershipList?.documents || []).map((document) => {
    const membership = firestoreFieldsToJs(document.fields || {});
    return membership.playerName || membership.name || membership.displayName || document.name.split('/').pop();
  });
  if (names.length) return uniqueSorted(names);

  const stateUrl = `${restBase(projectId)}/clubStates/${encodeURIComponent(clubId)}`;
  const stateDocument = await restFetchJson(stateUrl, token);
  if (!stateDocument) return [];

  const stateRecord = firestoreFieldsToJs(stateDocument.fields || {});
  const snapshotMemberships = stateRecord?.snapshot?.memberships || [];
  const stateProfiles = stateRecord?.state?.profiles || [];
  return uniqueSorted([
    ...snapshotMemberships.map((membership) => membership.playerName || membership.name || membership.playerId),
    ...stateProfiles.map((profile) => profile.name || profile.playerName || profile.id)
  ]);
}

async function ensureClub(db, clubId, clubName) {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'clubs', clubId),
    {
      id: clubId,
      licenseId: clubId,
      name: clubName || `Club ${clubId}`,
      savedAt: now,
      generatedAt: now,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

async function readMembershipNames(db, clubId) {
  const membershipSnapshot = await getDocs(collection(db, 'clubs', clubId, 'memberships'));
  const names = membershipSnapshot.docs.map((membershipDoc) => {
    const membership = membershipDoc.data();
    return membership.playerName || membership.name || membership.displayName || membershipDoc.id;
  });

  if (names.length) return uniqueSorted(names);

  const stateSnapshot = await getDoc(doc(db, 'clubStates', clubId));
  if (!stateSnapshot.exists()) return [];

  const stateRecord = stateSnapshot.data();
  const snapshotMemberships = stateRecord?.snapshot?.memberships || [];
  const stateProfiles = stateRecord?.state?.profiles || [];
  return uniqueSorted([
    ...snapshotMemberships.map((membership) => membership.playerName || membership.name || membership.playerId),
    ...stateProfiles.map((profile) => profile.name || profile.playerName || profile.id)
  ]);
}

async function main() {
  const clubId = getArg('--club') || process.argv[2];
  const shouldEnsureClub = hasFlag('--ensure-club');
  const clubName = getArg('--name');

  if (!clubId || clubId.startsWith('--')) {
    usage();
    process.exitCode = 1;
    return;
  }

  const serviceAccount = loadServiceAccount();

  if (serviceAccount) {
    const projectId = serviceAccount.project_id || firebaseConfig.projectId;
    const token = await getServiceAccountToken(serviceAccount);
    if (shouldEnsureClub) {
      await ensureClubWithRest(projectId, token, clubId, clubName);
      console.log(`Ensured club record: clubs/${clubId}`);
    }
    const names = await readMembershipNamesWithRest(projectId, token, clubId);
    if (!names.length) {
      console.log(`No members found for club ${clubId}.`);
      return;
    }

    console.log(`Members for ${clubId}:`);
    names.forEach((name) => console.log(name));
    return;
  }

  const db = getDb();
  if (shouldEnsureClub) {
    await ensureClub(db, clubId, clubName);
    console.log(`Ensured club record: clubs/${clubId}`);
  }

  const names = await readMembershipNames(db, clubId);
  if (!names.length) {
    console.log(`No members found for club ${clubId}.`);
    return;
  }

  console.log(`Members for ${clubId}:`);
  names.forEach((name) => console.log(name));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
