'use client';

import type { User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { readFirebaseErrorCode } from '@orbit/player-domain/decoders/playerBoundaryDecoders';
import type { PlayerAccount } from '@/src/domain/types';
import { getFirebaseBrowserClient, isFirebaseBrowserSyncEnabled } from '@/src/data/firebase-client';
import { deleteWebPlayerAccount, type WebPlayerAccountDeletionResult } from '@/src/data/player-api';
import { fetchWebPlayerProfile, saveWebPlayerProfile } from '@/src/data/player-profile';
import { AUTH_ACTION_TIMEOUT_MS, withDeadline } from './deadline';
import { toPlayerAuthError } from './firebase-auth-errors';
import { assertExpectedFirebaseUser, isPlayerSessionChangedError, PlayerSessionChangedError } from './session-identity';
import { clearPlayerSessionToken, persistPlayerSessionToken } from './session-cookie';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  player: PlayerAccount | null;
  error: string;
  signIn(email: string, password: string, adultConfirmed: boolean): Promise<void>;
  signOutPlayer(): Promise<void>;
  resetPassword(email: string): Promise<string>;
  deletePlayerAccount(): Promise<WebPlayerAccountDeletionResult & {
    currentAccountPreserved: boolean;
    signedOut: boolean;
    signOutError?: string;
  }>;
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
  const sessionGeneration = useRef(0);
  const sessionUid = useRef<string | null>(null);
  const activationInFlight = useRef<{
    uid: string;
    generation: number;
    promise: Promise<void>;
  } | null>(null);

  const beginSession = useCallback((uid: string | null) => {
    if (activationInFlight.current?.uid !== uid) activationInFlight.current = null;
    sessionGeneration.current += 1;
    sessionUid.current = uid;
    return sessionGeneration.current;
  }, []);

  const sessionIsCurrent = useCallback((uid: string, generation: number) => (
    sessionUid.current === uid && sessionGeneration.current === generation
  ), []);

  const loadPlayer = useCallback(async (currentUser: User, generation: number) => {
    try {
      const profile = await fetchWebPlayerProfile(currentUser);
      if (!sessionIsCurrent(currentUser.uid, generation)) return;
      setPlayer(profile);
      setError('');
      setStatus('signed-in');
    } catch (loadError) {
      if (isPlayerSessionChangedError(loadError) || !sessionIsCurrent(currentUser.uid, generation)) return;
      setPlayer(null);
      setError(loadError instanceof Error ? loadError.message : 'Your Orbit profile could not be loaded.');
      setStatus('error');
    }
  }, [sessionIsCurrent]);

  const activateVerifiedUser = useCallback((currentUser: User) => {
    const existing = activationInFlight.current;
    if (existing?.uid === currentUser.uid && sessionIsCurrent(currentUser.uid, existing.generation)) {
      return existing.promise;
    }
    const generation = beginSession(currentUser.uid);
    setUser(currentUser);
    setPlayer(null);
    setError('');
    setStatus('loading');

    const activation = {
      uid: currentUser.uid,
      generation,
      promise: Promise.resolve() as Promise<void>
    };
    activation.promise = (async () => {
      try {
        const { auth } = await getFirebaseBrowserClient();
        if (!sessionIsCurrent(currentUser.uid, generation)) throw new PlayerSessionChangedError();
        assertExpectedFirebaseUser(auth, currentUser.uid);
        const token = await withDeadline(
          currentUser.getIdToken(),
          'Orbit sign-in verification took too long. Check your connection and try again.'
        );
        assertExpectedFirebaseUser(auth, currentUser.uid);
        if (!sessionIsCurrent(currentUser.uid, generation)) throw new PlayerSessionChangedError();
        persistPlayerSessionToken(token);
        await loadPlayer(currentUser, generation);
      } catch (activationError) {
        if (isPlayerSessionChangedError(activationError) || !sessionIsCurrent(currentUser.uid, generation)) {
          throw new PlayerSessionChangedError();
        }
        beginSession(null);
        clearPlayerSessionToken();
        setUser(null);
        setPlayer(null);
        setError(activationError instanceof Error ? activationError.message : 'Orbit sign-in is unavailable.');
        setStatus('error');
        throw activationError;
      }
    })();
    activationInFlight.current = activation;
    void activation.promise.then(
      () => { if (activationInFlight.current === activation) activationInFlight.current = null; },
      () => { if (activationInFlight.current === activation) activationInFlight.current = null; }
    );
    return activation.promise;
  }, [beginSession, loadPlayer, sessionIsCurrent]);

  useEffect(() => {
    if (!firebaseEnabled) {
      clearPlayerSessionToken();
      return;
    }
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const authStateTimer = setTimeout(() => {
      if (disposed) return;
      beginSession(null);
      clearPlayerSessionToken();
      setUser(null);
      setPlayer(null);
      setError('Orbit sign-in status took too long to load. You can still retry from the sign-in page.');
      setStatus((current) => current === 'loading' ? 'signed-out' : current);
    }, AUTH_ACTION_TIMEOUT_MS);
    void withDeadline(
      Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]),
      'Orbit sign-in status took too long to load. You can still retry from the sign-in page.'
    ).then(([authModule, client]) => {
      if (disposed) return;
      unsubscribe = authModule.onIdTokenChanged(client.auth, (nextUser) => {
        clearTimeout(authStateTimer);
        const verified = nextUser && Boolean(nextUser.phoneNumber || nextUser.emailVerified);
        if (!verified) {
          beginSession(null);
          clearPlayerSessionToken();
          setUser(null);
          setPlayer(null);
          setError('');
          setStatus('signed-out');
          return;
        }
        void activateVerifiedUser(nextUser).catch(() => {
          // activateVerifiedUser owns current-session errors and ignores retired sessions.
        });
      }, (authError) => {
        clearTimeout(authStateTimer);
        beginSession(null);
        clearPlayerSessionToken();
        setUser(null);
        setPlayer(null);
        setError(authError.message || 'Orbit sign-in is unavailable.');
        setStatus('error');
      });
    }).catch((loadError) => {
      if (disposed) return;
      clearTimeout(authStateTimer);
      beginSession(null);
      clearPlayerSessionToken();
      setUser(null);
      setPlayer(null);
      setError(loadError instanceof Error ? loadError.message : 'Orbit sign-in is unavailable.');
      setStatus('signed-out');
    });
    return () => {
      disposed = true;
      beginSession(null);
      clearTimeout(authStateTimer);
      unsubscribe?.();
    };
  }, [activateVerifiedUser, beginSession, firebaseEnabled]);

  const signIn = useCallback(async (email: string, password: string, adultConfirmed: boolean) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw new Error('Enter a valid email address.');
    if (password.length < 12) throw new Error('Use a password or passphrase with at least 12 characters.');
    if (!adultConfirmed) throw new Error('Confirm that you are 18 or older before signing in or creating an Orbit account.');
    await withDeadline((async () => {
      const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      try {
        const result = await authModule.signInWithEmailAndPassword(auth, normalizedEmail, password);
        if (!result.user.emailVerified) {
          await authModule.sendEmailVerification(result.user);
          await authModule.signOut(auth);
          throw new Error('Verify your email using the new link we sent, then sign in again.');
        }
        await activateVerifiedUser(result.user);
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
    })(), 'Orbit sign-in took too long. Check your connection and try again.');
  }, [activateVerifiedUser]);

  const signOutPlayer = useCallback(async () => {
    const generation = beginSession(null);
    clearPlayerSessionToken();
    setUser(null);
    setPlayer(null);
    setError('');
    setStatus('signed-out');
    const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
    try {
      await withDeadline(authModule.signOut(auth), 'Orbit sign-out took too long. Check your connection and try again.');
    } finally {
      if (sessionUid.current === null && sessionGeneration.current === generation) {
        clearPlayerSessionToken();
        setUser(null);
        setPlayer(null);
        setStatus('signed-out');
      }
    }
  }, [beginSession]);

  const signOutDeletedPlayerIfCurrent = useCallback(async (expectedUid: string) => {
    const [authModule, { auth }] = await Promise.all([import('firebase/auth'), getFirebaseBrowserClient()]);
    const localUid = sessionUid.current;
    const firebaseUid = auth.currentUser?.uid ?? null;
    if (
      (localUid !== null && localUid !== expectedUid)
      || (firebaseUid !== null && firebaseUid !== expectedUid)
    ) {
      return { currentAccountPreserved: true, signedOut: false };
    }
    if (firebaseUid === null) {
      beginSession(null);
      clearPlayerSessionToken();
      setUser(null);
      setPlayer(null);
      setError('');
      setStatus('signed-out');
      return { currentAccountPreserved: false, signedOut: true };
    }

    // Recheck both identities immediately before invoking Firebase sign-out.
    // There is no await between this boundary and signOut, so an account that
    // becomes active while the modules load is never signed out by an older
    // deletion request.
    if (sessionUid.current !== expectedUid || auth.currentUser?.uid !== expectedUid) {
      return { currentAccountPreserved: true, signedOut: false };
    }
    const generation = beginSession(null);
    clearPlayerSessionToken();
    setUser(null);
    setPlayer(null);
    setError('');
    setStatus('signed-out');
    try {
      await withDeadline(authModule.signOut(auth), 'Orbit sign-out took too long. Check your connection and try again.');
      return { currentAccountPreserved: false, signedOut: true };
    } catch (signOutError) {
      return {
        currentAccountPreserved: false,
        signedOut: false,
        signOutError: signOutError instanceof Error ? signOutError.message : 'Browser sign-out could not be confirmed.'
      };
    } finally {
      if (sessionUid.current === null && sessionGeneration.current === generation) {
        clearPlayerSessionToken();
        setUser(null);
        setPlayer(null);
        setStatus('signed-out');
      }
    }
  }, [beginSession]);

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

  const deletePlayerAccount = useCallback(async () => {
    if (!user) throw new Error('Sign in before deleting your Orbit account.');
    const initiatingUid = user.uid;
    if (sessionUid.current !== initiatingUid) throw new PlayerSessionChangedError();
    const result = await deleteWebPlayerAccount(user);
    const currentUid = sessionUid.current;
    if (currentUid && currentUid !== initiatingUid) {
      return { ...result, currentAccountPreserved: true, signedOut: false };
    }
    if (currentUid === null) {
      return { ...result, currentAccountPreserved: false, signedOut: true };
    }
    return { ...result, ...await signOutDeletedPlayerIfCurrent(initiatingUid) };
  }, [signOutDeletedPlayerIfCurrent, user]);

  const updatePlayer = useCallback(async (nextPlayer: PlayerAccount) => {
    if (!user) throw new Error('Sign in before saving your Orbit profile.');
    const generation = sessionGeneration.current;
    if (!sessionIsCurrent(user.uid, generation)) throw new PlayerSessionChangedError();
    const saved = await saveWebPlayerProfile(user, nextPlayer);
    if (!sessionIsCurrent(user.uid, generation)) throw new PlayerSessionChangedError();
    setPlayer(saved);
  }, [sessionIsCurrent, user]);

  const refreshPlayer = useCallback(async () => {
    if (!user) return;
    const generation = sessionGeneration.current;
    if (!sessionIsCurrent(user.uid, generation)) throw new PlayerSessionChangedError();
    await loadPlayer(user, generation);
  }, [loadPlayer, sessionIsCurrent, user]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    player,
    error,
    signIn,
    signOutPlayer,
    resetPassword,
    deletePlayerAccount,
    updatePlayer,
    refreshPlayer
  }), [deletePlayerAccount, error, player, refreshPlayer, resetPassword, signIn, signOutPlayer, status, updatePlayer, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
