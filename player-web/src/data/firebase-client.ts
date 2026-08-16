import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { withDeadline } from '@/src/auth/deadline';

type FirebaseBrowserClient = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
};

let browserClient: FirebaseBrowserClient | undefined;
let browserClientPromise: Promise<FirebaseBrowserClient> | undefined;

export function isFirebaseBrowserSyncEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_FIREBASE_SYNC !== 'false';
}

export async function getFirebaseBrowserClient() {
  if (typeof window === 'undefined') throw new Error('Firebase Player services are available only in the browser.');
  if (browserClient) return browserClient;
  if (!browserClientPromise) {
    browserClientPromise = withDeadline(Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore')
    ]).then(([appModule, authModule, firestoreModule]) => {
      const appName = 'orbit-player-web';
      const app = appModule.getApps().some((candidate) => candidate.name === appName)
        ? appModule.getApp(appName)
        : appModule.initializeApp({
            apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyAdLo3z7aMkCV06uXU53RZOmn3UMxcjgsA',
            authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'tabletalk-s.firebaseapp.com',
            projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'tabletalk-s',
            storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'tabletalk-s.firebasestorage.app',
            messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '133175572500',
            appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:133175572500:web:77d0d79a654f4becfd8f01',
            measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-BKK44RBCYK'
          }, appName);
      const auth = authModule.getAuth(app);
      const db = firestoreModule.getFirestore(app);
      const authEmulatorHost = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
      const firestoreEmulatorHost = process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST;
      if (authEmulatorHost) {
        authModule.connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
      }
      if (firestoreEmulatorHost) {
        const emulatorUrl = new URL(`http://${firestoreEmulatorHost}`);
        firestoreModule.connectFirestoreEmulator(db, emulatorUrl.hostname, Number(emulatorUrl.port));
      }
      browserClient = { app, auth, db };
      return browserClient;
    }), 'Orbit sign-in services took too long to load. Check your connection and try again.').catch((error) => {
      browserClientPromise = undefined;
      throw error;
    });
  }
  return browserClientPromise;
}
