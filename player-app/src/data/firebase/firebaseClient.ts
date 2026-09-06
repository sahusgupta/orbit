import { getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import { initializePlayerAuth } from './initializePlayerAuth';
import { playerAuthPersistence } from './playerAuthPersistence';

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export const auth = initializePlayerAuth(firebaseApp, playerAuthPersistence, {
  getExisting: getAuth,
  initialize: initializeAuth
});
