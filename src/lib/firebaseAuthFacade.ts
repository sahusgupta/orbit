import type { User } from 'firebase/auth';

const loadFirebaseAuth = () => import('./firebaseClubSync');

export async function signInOrCreateFirebaseEmailAccount(email: string, password: string): Promise<User> {
  const firebase = await loadFirebaseAuth();
  return firebase.signInOrCreateFirebaseEmailAccount(email, password);
}

export async function signInToFirebaseWithEmail(email: string, password: string): Promise<User> {
  const firebase = await loadFirebaseAuth();
  return firebase.signInToFirebaseWithEmail(email, password);
}

export async function sendFirebasePasswordResetEmail(email: string): Promise<void> {
  const firebase = await loadFirebaseAuth();
  await firebase.sendFirebasePasswordResetEmail(email);
}

export async function signOutOfFirebase(): Promise<void> {
  const firebase = await loadFirebaseAuth();
  await firebase.signOutOfFirebase();
}
