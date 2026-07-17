const { initializeApp, getApps } = require('firebase/app');
const { getAuth } = require('firebase/auth');
const {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
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

async function ensureFirebaseSession() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  if (auth.currentUser) return auth.currentUser;
  return null;
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
    Promise.all([
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
      ),
      publishClubSnapshot(accountKey, publicSnapshot, savedAt)
    ]).then(() => ({ ok: true, engine: 'firebase', accountKey, savedAt })),
    { ok: false, engine: 'firebase', accountKey, savedAt, timedOut: true }
  );
  return result;
}

async function publishClubSnapshot(accountKey, publicSnapshot, savedAt) {
  if (!publicSnapshot?.club) return;
  const db = getFirebaseDb();
  const [existingGames, existingMemberships, existingWaitlists, existingNotifications] = await Promise.all([
    getDocs(collection(db, 'clubs', accountKey, 'games')),
    getDocs(collection(db, 'clubs', accountKey, 'memberships')),
    getDocs(collection(db, 'clubs', accountKey, 'waitlists')),
    getDocs(collection(db, 'clubs', accountKey, 'notifications'))
  ]);
  const batch = writeBatch(db);
  const gameIds = new Set((publicSnapshot.games || []).map((game) => game.id));
  const membershipIds = new Set((publicSnapshot.memberships || []).map((membership) => membership.playerId));
  const waitlistIds = new Set((publicSnapshot.waitlists || []).map((waitlist) => waitlist.id));
  const notificationIds = new Set((publicSnapshot.notifications || []).map((notification) => notification.id));
  batch.set(
    doc(db, 'clubs', accountKey),
    stripUndefinedForFirestore({
      ...publicSnapshot.club,
      social: publicSnapshot.social,
      generatedAt: publicSnapshot.generatedAt,
      savedAt,
      updatedAt: serverTimestamp()
    }),
    { merge: true }
  );
  for (const game of publicSnapshot.games || []) {
    batch.set(doc(db, 'clubs', accountKey, 'games', game.id), stripUndefinedForFirestore({ ...game, updatedAt: serverTimestamp() }), { merge: true });
  }
  for (const gameDoc of existingGames.docs) {
    if (!gameIds.has(gameDoc.id)) batch.delete(gameDoc.ref);
  }
  for (const membership of publicSnapshot.memberships || []) {
    batch.set(
      doc(db, 'clubs', accountKey, 'memberships', membership.playerId),
      stripUndefinedForFirestore({ ...membership, updatedAt: serverTimestamp() }),
      { merge: true }
    );
  }
  for (const membershipDoc of existingMemberships.docs) {
    if (!membershipIds.has(membershipDoc.id)) batch.delete(membershipDoc.ref);
  }
  for (const waitlist of publicSnapshot.waitlists || []) {
    batch.set(doc(db, 'clubs', accountKey, 'waitlists', waitlist.id), stripUndefinedForFirestore({ ...waitlist, updatedAt: serverTimestamp() }), { merge: true });
  }
  for (const waitlistDoc of existingWaitlists.docs) {
    if (!waitlistIds.has(waitlistDoc.id)) batch.delete(waitlistDoc.ref);
  }
  for (const notification of publicSnapshot.notifications || []) {
    batch.set(doc(db, 'clubs', accountKey, 'notifications', notification.id), stripUndefinedForFirestore({ ...notification, updatedAt: serverTimestamp() }), { merge: true });
  }
  for (const notificationDoc of existingNotifications.docs) {
    if (!notificationIds.has(notificationDoc.id)) batch.delete(notificationDoc.ref);
  }
  await batch.commit();
}

async function fetchPendingPlayerRequests(accountKey) {
  if (!isFirebaseConfigured() || !accountKey) return { membershipRequests: [], waitlistRequests: [] };
  const db = getFirebaseDb();
  const [clubMembershipSnapshot, legacyMembershipSnapshot, clubWaitlistSnapshot, legacyWaitlistSnapshot] = await Promise.all([
    getDocs(collection(db, 'clubs', accountKey, 'membershipRequests')),
    getDocs(collection(db, 'clubStates', accountKey, 'membershipRequests')),
    getDocs(collection(db, 'clubs', accountKey, 'waitlistRequests')),
    getDocs(collection(db, 'clubStates', accountKey, 'waitlistRequests'))
  ]);
  const dedupe = (docs) => Array.from(new Map(docs.map((requestDoc) => [requestDoc.data().id || requestDoc.id, requestDoc.data()])).values());
  return {
    membershipRequests: dedupe([...clubMembershipSnapshot.docs, ...legacyMembershipSnapshot.docs])
      .filter((request) => request.status !== 'applied'),
    waitlistRequests: dedupe([...clubWaitlistSnapshot.docs, ...legacyWaitlistSnapshot.docs])
      .filter((request) => request.status !== 'applied')
  };
}

async function markPlayerRequestApplied(accountKey, kind, requestId) {
  if (!isFirebaseConfigured() || !accountKey || !requestId) return;
  const collectionName = kind === 'membership' ? 'membershipRequests' : 'waitlistRequests';
  const db = getFirebaseDb();
  await Promise.all([
    updateDoc(doc(db, 'clubs', accountKey, collectionName, requestId), {
      status: 'applied',
      appliedAt: serverTimestamp()
    }).catch(() => undefined),
    updateDoc(doc(db, 'clubStates', accountKey, collectionName, requestId), {
      status: 'applied',
      appliedAt: serverTimestamp()
    }).catch(() => undefined)
  ]);
}

module.exports = {
  fetchPendingPlayerRequests,
  isFirebaseConfigured,
  markPlayerRequestApplied,
  readStateFromFirebase,
  writeStateToFirebase
};
