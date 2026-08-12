import { getApps, initializeApp } from 'firebase/app';
import { getAuth, inMemoryPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export const auth = (() => {
  try {
    return initializeAuth(firebaseApp, { persistence: inMemoryPersistence });
  } catch {
    return getAuth(firebaseApp);
  }
})();
