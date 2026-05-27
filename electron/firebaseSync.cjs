const { initializeApp, getApps } = require('firebase/app');
const {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  updateDoc
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

const firebaseSyncTimeoutMs = 2500;

function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function getFirebaseDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  try {
    return initializeFirestore(app, { ignoreUndefinedProperties: true });
  } catch {
    return getFirestore(app);
  }
}

function stripUndefinedForFirestore(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : stripUndefinedForFirestore(item)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedForFirestore(item)])
    );
  }
  return value;
}

function withFirebaseTimeout(operation, fallback) {
  return Promise.race([
    operation,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallback), firebaseSyncTimeoutMs);
    })
  ]);
}

async function readStateFromFirebase(accountKey) {
  if (!isFirebaseConfigured() || !accountKey) return null;
  const stateDoc = await withFirebaseTimeout(getDoc(doc(getFirebaseDb(), 'clubStates', accountKey)), null);
  if (!stateDoc) return null;
  if (!stateDoc.exists()) return null;
  const data = stateDoc.data();
  if (!data?.state) return null;
  return {
    schemaVersion: Number(data.schemaVersion || 4),
    savedAt: data.savedAt || new Date().toISOString(),
    state: data.state
  };
}

async function writeStateToFirebase(accountKey, state, publicSnapshot) {
  if (!isFirebaseConfigured() || !accountKey) return { ok: false, skipped: true };
  const savedAt = new Date().toISOString();
  const result = await withFirebaseTimeout(
    setDoc(
      doc(getFirebaseDb(), 'clubStates', accountKey),
      {
        accountKey,
        schemaVersion: 4,
        savedAt,
        state: stripUndefinedForFirestore(state),
        snapshot: stripUndefinedForFirestore(publicSnapshot),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    ).then(() => ({ ok: true, engine: 'firebase', accountKey, savedAt })),
    { ok: false, engine: 'firebase', accountKey, savedAt, timedOut: true }
  );
  return result;
}

async function fetchPendingPlayerRequests(accountKey) {
  if (!isFirebaseConfigured() || !accountKey) return { membershipRequests: [], waitlistRequests: [] };
  const db = getFirebaseDb();
  const membershipSnapshot = await getDocs(collection(db, 'clubStates', accountKey, 'membershipRequests'));
  const waitlistSnapshot = await getDocs(collection(db, 'clubStates', accountKey, 'waitlistRequests'));
  return {
    membershipRequests: membershipSnapshot.docs
      .map((requestDoc) => requestDoc.data())
      .filter((request) => request.status !== 'applied'),
    waitlistRequests: waitlistSnapshot.docs
      .map((requestDoc) => requestDoc.data())
      .filter((request) => request.status !== 'applied')
  };
}

async function markPlayerRequestApplied(accountKey, kind, requestId) {
  if (!isFirebaseConfigured() || !accountKey || !requestId) return;
  const collectionName = kind === 'membership' ? 'membershipRequests' : 'waitlistRequests';
  await updateDoc(doc(getFirebaseDb(), 'clubStates', accountKey, collectionName, requestId), {
    status: 'applied',
    appliedAt: serverTimestamp()
  });
}

module.exports = {
  fetchPendingPlayerRequests,
  isFirebaseConfigured,
  markPlayerRequestApplied,
  readStateFromFirebase,
  writeStateToFirebase
};
