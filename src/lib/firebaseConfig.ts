export const firebaseConfig = {
  apiKey: 'AIzaSyAdLo3z7aMkCV06uXU53RZOmn3UMxcjgsA',
  authDomain: 'tabletalk-s.firebaseapp.com',
  projectId: 'tabletalk-s',
  storageBucket: 'tabletalk-s.firebasestorage.app',
  messagingSenderId: '133175572500',
  appId: '1:133175572500:web:77d0d79a654f4becfd8f01',
  measurementId: 'G-BKK44RBCYK'
};

// Firebase is the production sync path. Set VITE_ENABLE_FIREBASE_SYNC=false only
// for isolated/offline builds that must never contact Firebase.
export const rendererFirebaseSyncEnabled = import.meta.env.VITE_ENABLE_FIREBASE_SYNC !== 'false';
