import { getApps, initializeApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebaseConfig';
import { initializePlayerAuth } from './initializePlayerAuth';
import { playerAuthPersistence } from './playerAuthPersistence';
import { getPlayerFirebaseOptions, initializePlayerAppCheck } from './playerAppCheck';
import { appCheckHeaders } from './appCheckToken';

export const firebaseApp = getApps().length ? getApps()[0] : initializeApp(getPlayerFirebaseOptions(firebaseConfig));
const appCheck = initializePlayerAppCheck(firebaseApp);
export const getPlayerAppCheckHeaders = () => appCheckHeaders(appCheck);
export const db = getFirestore(firebaseApp);
export const auth = initializePlayerAuth(firebaseApp, playerAuthPersistence, {
  getExisting: getAuth,
  initialize: initializeAuth
});
