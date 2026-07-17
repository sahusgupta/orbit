const crypto = require('crypto');
const fs = require('fs');
const { buildPlayerClubSnapshot, getAccountKeyFromState } = require('./orbitCore');

const firebaseConfig = {
  projectId: 'tabletalk-s'
};

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    return JSON.parse(value);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  return null;
}

function getFirebasePublisherStatus() {
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      return {
        configured: false,
        projectId: firebaseConfig.projectId,
        credentialSource: ''
      };
    }
    return {
      configured: true,
      projectId: serviceAccount.project_id || firebaseConfig.projectId,
      credentialSource: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? 'FIREBASE_SERVICE_ACCOUNT_JSON'
        : process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
          ? 'FIREBASE_SERVICE_ACCOUNT_BASE64'
          : 'GOOGLE_APPLICATION_CREDENTIALS',
      clientEmail: serviceAccount.client_email || ''
    };
  } catch (error) {
    return {
      configured: false,
      projectId: firebaseConfig.projectId,
      credentialSource: 'invalid',
      error: error instanceof Error ? error.message : 'Invalid Firebase credentials.'
    };
  }
}

async function getServiceAccountToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))}`;
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
  if (!response.ok) throw new Error(`Firebase token request failed: ${response.status} ${await response.text()}`);
  return (await response.json()).access_token;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : stripUndefined(item)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
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
  return Object.fromEntries(Object.entries(stripUndefined(record)).map(([key, value]) => [key, jsToFirestoreValue(value)]));
}

function firestoreDocumentId(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .replace(/\//g, '-')
    .slice(0, 128) || fallback;
}

function restBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function patchDocument(projectId, token, path, record) {
  const response = await fetch(`${restBase(projectId)}/${path}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ fields: jsToFirestoreFields(record) })
  });
  if (!response.ok) throw new Error(`Firestore write failed for ${path}: ${response.status} ${await response.text()}`);
}

async function publishStateToFirebase(state) {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return { ok: false, skipped: true, reason: 'missing-service-account' };

  const projectId = serviceAccount.project_id || firebaseConfig.projectId;
  const token = await getServiceAccountToken(serviceAccount);
  const accountKey = getAccountKeyFromState(state);
  const snapshot = buildPlayerClubSnapshot(state);
  const savedAt = new Date().toISOString();
  const clubNameDocId = firestoreDocumentId(snapshot.club.name || accountKey, accountKey);
  const clubName = snapshot.club.name || clubNameDocId;

  await patchDocument(projectId, token, `clubStates/${encodeURIComponent(accountKey)}`, {
    accountKey,
    schemaVersion: 4,
    savedAt,
    state,
    snapshot,
    updatedAt: savedAt
  });
  await patchDocument(projectId, token, `clubs/${encodeURIComponent(accountKey)}`, {
    ...snapshot.club,
    licenseId: accountKey,
    social: snapshot.social,
    generatedAt: snapshot.generatedAt,
    savedAt,
    updatedAt: savedAt
  });
  await patchDocument(projectId, token, `players/${encodeURIComponent(clubNameDocId)}`, {
    clubId: accountKey,
    clubName,
    savedAt,
    updatedAt: savedAt
  });
  await patchDocument(projectId, token, 'games/clubs', {
    description: 'Games grouped by club name.',
    savedAt,
    updatedAt: savedAt
  });

  for (const membership of snapshot.memberships || []) {
    await patchDocument(
      projectId,
      token,
      `players/${encodeURIComponent(clubNameDocId)}/members/${encodeURIComponent(firestoreDocumentId(membership.playerId, membership.id))}`,
      {
        ...membership,
        clubId: accountKey,
        clubName,
        savedAt,
        updatedAt: savedAt
      }
    );
  }

  for (const game of snapshot.games || []) {
    await patchDocument(
      projectId,
      token,
      `games/clubs/${encodeURIComponent(clubNameDocId)}/${encodeURIComponent(firestoreDocumentId(game.id, game.name))}`,
      {
        ...game,
        clubId: accountKey,
        clubName,
        savedAt,
        updatedAt: savedAt
      }
    );
  }

  return { ok: true, accountKey, clubName, savedAt };
}

module.exports = {
  getFirebasePublisherStatus,
  publishStateToFirebase
};
