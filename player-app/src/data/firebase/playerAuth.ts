import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from 'firebase/auth';
import { readFirebaseErrorCode } from '../../domain/decoders/playerBoundaryDecoders';
import { auth } from './firebaseClient';

export type FirebasePlayerIdentity = {
  uid: string;
  email: string;
  name: string;
  photoUrl?: string;
};

export function getCurrentFirebasePlayer() {
  return auth.currentUser ? toFirebasePlayerIdentity(auth.currentUser) : null;
}

export function onFirebasePlayerChanged(callback: (identity: FirebasePlayerIdentity | null) => void) {
  return onAuthStateChanged(auth, (user) => callback(user ? toFirebasePlayerIdentity(user) : null));
}

export async function signInOrCreatePlayerWithEmail(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error('Enter your email and password.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  try {
    const result = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    return toFirebasePlayerIdentity(result.user);
  } catch (signInError) {
    try {
      const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      return toFirebasePlayerIdentity(result.user);
    } catch (createError) {
      if (readFirebaseErrorCode(createError) === 'auth/email-already-in-use') throw signInError;
      throw createError;
    }
  }
}

export async function signInOrCreatePlayerWithPhone(phone: string, password: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw new Error('Enter a valid phone number.');
  // Firebase email/password is used behind the scenes so this works in Expo Go
  // without a native SMS SDK. The real phone number remains on the player profile.
  return signInOrCreatePlayerWithEmail(`phone-${digits}@players.orbit.local`, password);
}

export function ensureSignedInIdentity() {
  const identity = getCurrentFirebasePlayer();
  if (!identity) {
    throw new Error('Sign in with your email address or phone number before syncing.');
  }
  return identity.uid;
}

export function deleteFirebasePlayer(user: User) {
  return deleteUser(user);
}

export function signOutFirebasePlayer() {
  return signOut(auth);
}

function toFirebasePlayerIdentity(user: User): FirebasePlayerIdentity {
  return {
    uid: user.uid,
    email: user.email ?? '',
    name: user.displayName ?? user.email?.split('@')[0] ?? 'Player',
    photoUrl: user.photoURL ?? undefined
  };
}
