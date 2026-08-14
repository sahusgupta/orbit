import { readFirebaseErrorCode } from '@orbit/player-domain/decoders/playerBoundaryDecoders';

const messagesByCode: Record<string, string> = {
  'auth/email-already-in-use': 'Email or password is incorrect. Try again or send a password reset.',
  'auth/invalid-credential': 'Email or password is incorrect. Try again or send a password reset.',
  'auth/user-not-found': 'Email or password is incorrect. Try again or send a password reset.',
  'auth/wrong-password': 'Email or password is incorrect. Try again or send a password reset.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/network-request-failed': 'Orbit could not reach Firebase. Check your connection and try again.',
  'auth/operation-not-allowed': 'Email sign-in is not enabled for Orbit. Contact Orbit support.',
  'auth/too-many-requests': 'Too many sign-in attempts were made. Wait a moment or send a password reset.',
  'auth/unauthorized-domain': 'Orbit sign-in is not configured for this web address.',
  'auth/weak-password': 'Use a stronger password or passphrase with at least 12 characters.'
};

export function toPlayerAuthError(value: unknown, fallback = 'Orbit sign-in could not be completed.') {
  const code = readFirebaseErrorCode(value);
  const message = code ? messagesByCode[code] : undefined;
  if (message) return new Error(message);
  return value instanceof Error ? value : new Error(fallback);
}
