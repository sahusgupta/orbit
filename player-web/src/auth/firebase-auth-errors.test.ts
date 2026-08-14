import { describe, expect, it } from 'vitest';
import { toPlayerAuthError } from './firebase-auth-errors';

describe('Player Web Firebase authentication errors', () => {
  it.each(['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/email-already-in-use'])(
    'turns %s into one non-enumerating credential message',
    (code) => {
      expect(toPlayerAuthError(Object.assign(new Error('Firebase raw error'), { code })).message)
        .toBe('Email or password is incorrect. Try again or send a password reset.');
    }
  );

  it('gives actionable messages for provider configuration and throttling errors', () => {
    expect(toPlayerAuthError({ code: 'auth/operation-not-allowed' }).message).toContain('not enabled');
    expect(toPlayerAuthError({ code: 'auth/too-many-requests' }).message).toContain('Wait a moment');
    expect(toPlayerAuthError({ code: 'auth/unauthorized-domain' }).message).toContain('web address');
  });

  it('preserves an unknown Error for diagnostics that have no safe mapping', () => {
    const error = new Error('Unexpected provider failure.');
    expect(toPlayerAuthError(error)).toBe(error);
  });
});
