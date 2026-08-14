'use client';

import type { User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { readFirebaseErrorCode } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount } from '@/src/domain/types';
import { getFirebaseBrowserClient, isFirebaseBrowserSyncEnabled } from '@/src/data/firebase-client';
import { fetchWebPlayerProfile, saveWebPlayerProfile } from '@/src/data/player-profile';
import { toPlayerAuthError } from './firebase-auth-errors';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  player: PlayerAccount | null;
  error: string;
  signIn(email: string, password: string): Promise<void>;
  signOutPlayer(): Promise<void>;
  resetPassword(email: string): Promise<string>;
  updatePlayer(player: PlayerAccount): Promise<void>;
  refreshPlayer(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const firebaseEnabled = isFirebaseBrowserSyncEnabled();
  const [status, setStatus] = useState<AuthStatus>(firebaseEnabled ? 'loading' : 'signed-out');
  const [user, setUser] = useState<User | null>(null);
  const [player, setPlayer] = useState<PlayerAccount | null>(null);
  const [error, setError] = useState('');

  const loadPlayer = useCallback(async (currentUser: User) => {
    try {
      const profile = await fetchWebPlayerProfile(currentUser);
      setPlayer(profile);
      setError('');
      setStatus('signed-in');
    } catch (loadError) {
      setPlayer(null);
      setError(loadError instanceof Error ? loadError.message : 'Your Orbit profile could not be loaded.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!firebaseEnabled) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]).then(([authModule, client]) => {
      if (disposed) return;
      unsubscribe = authModule.onAuthStateChanged(client.auth, (nextUser) => {
        const verified = nextUser && Boolean(nextUser.phoneNumber || nextUser.emailVerified);
        if (!verified) {
          setUser(null);
          setPlayer(null);
          setError('');
          setStatus('signed-out');
          return;
        }
        setUser(nextUser);
        setStatus('loading');
        void loadPlayer(nextUser);
      }, (authError) => {
        setError(authError.message || 'Orbit sign-in is unavailable.');
        setStatus('error');
      });
    }).catch((loadError) => {
      if (disposed) return;
      setError(loadError instanceof Error ? loadError.message : 'Orbit sign-in is unavailable.');
      setStatus('error');
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [firebaseEnabled, loadPlayer]);

  const signIn = useCallback(async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
    if (password.length < 12) throw new Error('Use a password or passphrase with at least 12 characters.');
    const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
    await authModule.setPersistence(auth, authModule.browserLocalPersistence);
    try {
      const result = await authModule.signInWithEmailAndPassword(auth, normalizedEmail, password);
      if (!result.user.emailVerified) {
        await authModule.sendEmailVerification(result.user);
        await authModule.signOut(auth);
        throw new Error('Verify your email using the new link we sent, then sign in again.');
      }
      setUser(result.user);
      await loadPlayer(result.user);
    } catch (signInError) {
      if (signInError instanceof Error && signInError.message.startsWith('Verify your email')) throw signInError;
      const code = readFirebaseErrorCode(signInError);
      if (!['auth/user-not-found', 'auth/invalid-credential', 'auth/wrong-password'].includes(code ?? '')) {
        throw toPlayerAuthError(signInError);
      }
      try {
        const result = await authModule.createUserWithEmailAndPassword(auth, normalizedEmail, password);
        await authModule.sendEmailVerification(result.user);
        await authModule.signOut(auth);
        throw new Error('Check your email to verify the new account before signing in.');
      } catch (createError) {
        if (createError instanceof Error && createError.message.startsWith('Check your email')) throw createError;
        if (readFirebaseErrorCode(createError) === 'auth/email-already-in-use') {
          throw toPlayerAuthError(signInError);
        }
        throw toPlayerAuthError(createError);
      }
    }
  }, [loadPlayer]);

  const signOutPlayer = useCallback(async () => {
    const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
    await authModule.signOut(auth);
    setUser(null);
    setPlayer(null);
    setStatus('signed-out');
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
    try {
      const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
      await authModule.sendPasswordResetEmail(auth, normalizedEmail);
    } catch (resetError) {
      const code = readFirebaseErrorCode(resetError);
      if (!['auth/user-not-found', 'auth/invalid-email'].includes(code ?? '')) throw toPlayerAuthError(resetError, 'Password reset could not be started.');
    }
    return 'If that email belongs to an Orbit account, Firebase sent a single-use reset link.';
  }, []);

  const updatePlayer = useCallback(async (nextPlayer: PlayerAccount) => {
    if (!user) throw new Error('Sign in before saving your Orbit profile.');
    const saved = await saveWebPlayerProfile(user, nextPlayer);
    setPlayer(saved);
  }, [user]);

  const refreshPlayer = useCallback(async () => {
    if (user) await loadPlayer(user);
  }, [loadPlayer, user]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    player,
    error,
    signIn,
    signOutPlayer,
    resetPassword,
    updatePlayer,
    refreshPlayer
  }), [error, player, refreshPlayer, resetPassword, signIn, signOutPlayer, status, updatePlayer, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
