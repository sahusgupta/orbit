import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore, getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';
import { buildPlayerClubSnapshot, getClubIdFromState, type PlayerClubSnapshot } from './playerSync';

type FirebaseClubStateRecord<TState> = {
  accountKey: string;
  savedAt: string;
  state: TState;
  snapshot: PlayerClubSnapshot;
};

const firebaseSyncTimeoutMs = 2500;

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
let db: ReturnType<typeof getFirestore>;

try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
} catch {
  db = getFirestore(app);
}

function stripUndefinedForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : stripUndefinedForFirestore(item))) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefinedForFirestore(item)])
    ) as T;
  }
  return value;
}

function withFirebaseTimeout<T>(operation: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((resolve) => {
      globalThis.setTimeout(() => resolve(fallback), firebaseSyncTimeoutMs);
    })
  ]);
}

export function getFirebaseSyncStatus() {
  return {
    enabled: true,
    projectId: firebaseConfig.projectId
  };
}

export async function saveClubStateToFirebase<TState extends object>(state: TState) {
  const accountKey = getClubIdFromState(state as Parameters<typeof getClubIdFromState>[0]);
  const savedAt = new Date().toISOString();
  const snapshot = buildPlayerClubSnapshot(state as Parameters<typeof buildPlayerClubSnapshot>[0]);
  const record = {
    accountKey,
    savedAt,
    state: stripUndefinedForFirestore(state),
    snapshot: stripUndefinedForFirestore(snapshot),
    updatedAt: serverTimestamp()
  };
  return withFirebaseTimeout(
    setDoc(doc(db, 'clubStates', accountKey), record, { merge: true }).then(() => ({ accountKey, savedAt, snapshot, synced: true })),
    { accountKey, savedAt, snapshot, synced: false }
  );
}

export async function loadClubStateFromFirebase<TState = unknown>(accountKey: string) {
  const normalizedKey = accountKey.trim().toLowerCase();
  if (!normalizedKey) return null;
  const snapshot = await withFirebaseTimeout(getDoc(doc(db, 'clubStates', normalizedKey)), null);
  if (!snapshot) return null;
  if (!snapshot.exists()) return null;
  return snapshot.data() as FirebaseClubStateRecord<TState>;
}
