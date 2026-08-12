import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type User
} from 'firebase/auth';
import { readFirebaseErrorCode } from '../../domain/decoders/playerBoundaryDecoders';
import { exchangePlayerPhoneCode, requestPlayerPhoneCode } from '../api/playerPhoneAuthApi';
import { auth } from './firebaseClient';

export type FirebasePlayerIdentity = {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  photoUrl?: string;
  provider: 'email' | 'phone';
  verified: true;
};

export function getCurrentFirebasePlayer() {
  return auth.currentUser && isVerifiedPlayerUser(auth.currentUser) ? toFirebasePlayerIdentity(auth.currentUser) : null;
}

export function onFirebasePlayerChanged(callback: (identity: FirebasePlayerIdentity | null) => void) {
  return onAuthStateChanged(auth, (user) => callback(user && isVerifiedPlayerUser(user) ? toFirebasePlayerIdentity(user) : null));
}

export async function signInOrCreatePlayerWithEmail(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) throw new Error('Enter your email and password.');
  if (password.length < 12) throw new Error('Use a password or passphrase with at least 12 characters.');
  try {
    const result = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    if (!result.user.emailVerified) {
      await sendEmailVerification(result.user);
      await signOut(auth);
      throw new Error('Verify your email using the new link we sent, then sign in again.');
    }
    return toFirebasePlayerIdentity(result.user);
  } catch (signInError) {
    if (signInError instanceof Error && signInError.message.startsWith('Verify your email')) throw signInError;
    try {
      const result = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      await sendEmailVerification(result.user);
      await signOut(auth);
      throw new Error('Check your email to verify the account before signing in.');
    } catch (createError) {
      if (createError instanceof Error && createError.message.startsWith('Check your email')) throw createError;
      if (readFirebaseErrorCode(createError) === 'auth/email-already-in-use') throw signInError;
      throw createError;
    }
  }
}

export function startPlayerPhoneSignIn(phone: string) {
  if (!/^\+[1-9]\d{9,14}$/.test(phone.replace(/[\s().-]/g, ''))) {
    throw new Error('Enter a valid phone number including country code.');
  }
  return requestPlayerPhoneCode(phone);
}

export async function completePlayerPhoneSignIn(phone: string, code: string, challenge: string) {
  if (!/^\d{4,10}$/.test(code.trim())) throw new Error('Enter the SMS verification code.');
  const customToken = await exchangePlayerPhoneCode(phone, code.trim(), challenge);
  const result = await signInWithCustomToken(auth, customToken);
  if (!result.user.phoneNumber) {
    await signOut(auth);
    throw new Error('Phone ownership could not be verified.');
  }
  return toFirebasePlayerIdentity(result.user);
}

export async function requestPlayerPasswordReset(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
  } catch (error) {
    const code = readFirebaseErrorCode(error);
    if (!['auth/user-not-found', 'auth/invalid-email'].includes(code ?? '')) throw error;
  }
  return 'If that email belongs to an Orbit account, Firebase sent a single-use reset link.';
}

export function ensureSignedInIdentity() {
  const identity = getCurrentFirebasePlayer();
  if (!identity) {
    throw new Error('Sign in with your email address or phone number before syncing.');
  }
  return identity.uid;
}

export function signOutFirebasePlayer() {
  return signOut(auth);
}

function toFirebasePlayerIdentity(user: User): FirebasePlayerIdentity {
  const provider = user.phoneNumber ? 'phone' : 'email';
  return {
    uid: user.uid,
    email: user.email ?? '',
    name: user.displayName ?? user.email?.split('@')[0] ?? 'Player',
    ...(user.phoneNumber ? { phone: user.phoneNumber } : {}),
    photoUrl: user.photoURL ?? undefined,
    provider,
    verified: true
  };
}

function isVerifiedPlayerUser(user: User) {
  return Boolean(user.phoneNumber || (user.email && user.emailVerified));
}
