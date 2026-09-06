import type { User } from 'firebase/auth';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@/src/domain/types';

const authHarness = vi.hoisted(() => ({
  auth: { currentUser: null as User | null },
  nextUser: undefined as ((user: User | null) => void) | undefined,
  onIdTokenChanged: vi.fn(),
  signOut: vi.fn(),
  getClient: vi.fn(),
  setPersistence: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  deletionOutcome: null as Record<string, unknown> | null
}));

const profiles = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn()
}));

const deletions = vi.hoisted(() => ({
  request: vi.fn()
}));

vi.mock('firebase/auth', () => ({
  browserLocalPersistence: {},
  onIdTokenChanged: authHarness.onIdTokenChanged,
  setPersistence: authHarness.setPersistence,
  signInWithEmailAndPassword: authHarness.signInWithEmailAndPassword,
  signOut: authHarness.signOut
}));

vi.mock('@/src/data/firebase-client', () => ({
  getFirebaseBrowserClient: authHarness.getClient,
  isFirebaseBrowserSyncEnabled: vi.fn(() => true)
}));

vi.mock('@/src/data/player-profile', () => ({
  fetchWebPlayerProfile: profiles.fetch,
  saveWebPlayerProfile: profiles.save
}));

vi.mock('@/src/data/player-api', () => ({
  deleteWebPlayerAccount: deletions.request
}));

import { AuthProvider, useAuth } from './auth-context';
import { persistPlayerSessionToken, PLAYER_SESSION_COOKIE } from './session-cookie';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => { resolve = next; });
  return { promise, resolve };
}

function makeUser(uid: string, getIdToken: () => Promise<string> = async () => `token-${uid}`) {
  return {
    uid,
    email: `${uid}@example.test`,
    emailVerified: true,
    phoneNumber: null,
    getIdToken: vi.fn(getIdToken)
  } as unknown as User;
}

function makeProfile(uid: string): PlayerAccount {
  return {
    id: uid,
    name: `Player ${uid}`,
    email: `${uid}@example.test`,
    preferredGameIds: [],
    favoriteClubIds: []
  };
}

function AuthStateProbe() {
  const auth = useAuth();
  const { deletePlayerAccount, error, player, signIn, signOutPlayer, status, user } = auth;
  return (
    <div>
      <span>{status}</span>
      <span data-testid="user-id">{user?.uid ?? 'none'}</span>
      <span data-testid="player-id">{player?.id ?? 'none'}</span>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" onClick={() => void signIn('account-a@example.test', 'twelve-character-password', true)}>Sign in</button>
      <button type="button" onClick={() => void signOutPlayer()}>Sign out</button>
      <button type="button" onClick={() => void deletePlayerAccount().then((result) => { authHarness.deletionOutcome = result; })}>Delete account</button>
    </div>
  );
}

beforeEach(() => {
  authHarness.auth.currentUser = null;
  authHarness.nextUser = undefined;
  authHarness.onIdTokenChanged.mockReset().mockImplementation((_auth, nextUser) => {
    authHarness.nextUser = nextUser;
    return vi.fn();
  });
  authHarness.signOut.mockReset().mockImplementation(async () => {
    authHarness.auth.currentUser = null;
    authHarness.nextUser?.(null);
  });
  authHarness.getClient.mockReset().mockImplementation(async () => ({ auth: authHarness.auth }));
  authHarness.setPersistence.mockReset().mockResolvedValue(undefined);
  authHarness.signInWithEmailAndPassword.mockReset();
  profiles.fetch.mockReset();
  profiles.save.mockReset();
  deletions.request.mockReset();
  authHarness.deletionOutcome = null;
  document.cookie = `${PLAYER_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.cookie = `${PLAYER_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
});

describe('Player Web authentication startup and account isolation', () => {
  it('falls back to signed out when Firebase never emits its initial auth state', async () => {
    vi.useFakeTimers();
    persistPlayerSessionToken('stale-token');
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('loading')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });

    expect(screen.getByText('signed-out')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/took too long/i);
    expect(document.cookie).not.toContain(`${PLAYER_SESSION_COOKIE}=`);
  });

  it('does not install an earlier account profile after a newer account becomes active', async () => {
    const profileA = deferred<PlayerAccount>();
    const userA = makeUser('account-a');
    const userB = makeUser('account-b');
    profiles.fetch.mockImplementation((user: User) => (
      user.uid === userA.uid ? profileA.promise : Promise.resolve(makeProfile(user.uid))
    ));
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));

    await act(async () => {
      authHarness.auth.currentUser = userA;
      authHarness.nextUser?.(userA);
    });
    await waitFor(() => expect(profiles.fetch).toHaveBeenCalledWith(userA));

    await act(async () => {
      authHarness.auth.currentUser = userB;
      authHarness.nextUser?.(userB);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-b'));

    await act(async () => {
      profileA.resolve(makeProfile('account-a'));
      await profileA.promise;
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('account-b');
    expect(screen.getByTestId('player-id')).toHaveTextContent('account-b');
  });

  it('does not let a retired token load clear the newer account', async () => {
    const tokenA = deferred<string>();
    const userA = makeUser('account-a', () => tokenA.promise);
    const userB = makeUser('account-b');
    profiles.fetch.mockImplementation(async (user: User) => makeProfile(user.uid));
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));

    await act(async () => {
      authHarness.auth.currentUser = userA;
      authHarness.nextUser?.(userA);
    });
    await waitFor(() => expect(screen.getByTestId('user-id')).toHaveTextContent('account-a'));

    await act(async () => {
      authHarness.auth.currentUser = userB;
      authHarness.nextUser?.(userB);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-b'));

    await act(async () => {
      tokenA.resolve('token-account-a');
      await tokenA.promise;
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('account-b');
    expect(screen.getByTestId('player-id')).toHaveTextContent('account-b');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('coalesces the observer and explicit sign-in activation for the same UID', async () => {
    const user = makeUser('account-a');
    const profile = makeProfile('account-a');
    profiles.fetch.mockResolvedValue(profile);
    authHarness.signInWithEmailAndPassword.mockImplementation(async () => {
      authHarness.auth.currentUser = user;
      authHarness.nextUser?.(user);
      return { user };
    });
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));

    await act(async () => {
      screen.getByRole('button', { name: 'Sign in' }).click();
    });

    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-a'));
    expect(user.getIdToken).toHaveBeenCalledTimes(1);
    expect(profiles.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('user-id')).toHaveTextContent('account-a');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears account state immediately and ignores a profile load that finishes after sign-out', async () => {
    const profileA = deferred<PlayerAccount>();
    const userA = makeUser('account-a');
    profiles.fetch.mockReturnValue(profileA.promise);
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));

    await act(async () => {
      authHarness.auth.currentUser = userA;
      authHarness.nextUser?.(userA);
    });
    await waitFor(() => expect(profiles.fetch).toHaveBeenCalledWith(userA));

    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click();
    });
    expect(screen.getByText('signed-out')).toBeVisible();
    expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    expect(screen.getByTestId('player-id')).toHaveTextContent('none');

    await act(async () => {
      profileA.resolve(makeProfile('account-a'));
      await profileA.promise;
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    expect(screen.getByTestId('player-id')).toHaveTextContent('none');
  });

  it('signs out the initiating account after the server accepts deletion', async () => {
    const user = makeUser('account-a');
    profiles.fetch.mockResolvedValue(makeProfile('account-a'));
    deletions.request.mockResolvedValue({ initiatingUid: 'account-a', status: 'pending', retainedCategories: [] });
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));
    await act(async () => {
      authHarness.auth.currentUser = user;
      authHarness.nextUser?.(user);
    });
    await waitFor(() => expect(screen.getByText('signed-in')).toBeVisible());

    await act(async () => {
      screen.getByRole('button', { name: 'Delete account' }).click();
    });

    await waitFor(() => expect(authHarness.signOut).toHaveBeenCalledOnce());
    expect(screen.getByText('signed-out')).toBeVisible();
    expect(authHarness.deletionOutcome).toMatchObject({
      currentAccountPreserved: false,
      signedOut: true,
      status: 'pending'
    });
  });

  it('does not sign out a newer account when an earlier account deletion finishes', async () => {
    const deletion = deferred<{ initiatingUid: string; status: 'complete'; retainedCategories: string[] }>();
    const userA = makeUser('account-a');
    const userB = makeUser('account-b');
    profiles.fetch.mockImplementation(async (currentUser: User) => makeProfile(currentUser.uid));
    deletions.request.mockReturnValue(deletion.promise);
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));
    await act(async () => {
      authHarness.auth.currentUser = userA;
      authHarness.nextUser?.(userA);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-a'));
    screen.getByRole('button', { name: 'Delete account' }).click();
    await waitFor(() => expect(deletions.request).toHaveBeenCalledWith(userA));

    await act(async () => {
      authHarness.auth.currentUser = userB;
      authHarness.nextUser?.(userB);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-b'));
    await act(async () => {
      deletion.resolve({ initiatingUid: 'account-a', status: 'complete', retainedCategories: [] });
      await deletion.promise;
    });

    await waitFor(() => expect(authHarness.deletionOutcome).toMatchObject({
      currentAccountPreserved: true,
      signedOut: false
    }));
    expect(authHarness.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-id')).toHaveTextContent('account-b');
  });

  it('rechecks Firebase identity at the sign-out call boundary after deletion', async () => {
    const userA = makeUser('account-a');
    const userB = makeUser('account-b');
    profiles.fetch.mockImplementation(async (currentUser: User) => makeProfile(currentUser.uid));
    deletions.request.mockResolvedValue({ initiatingUid: 'account-a', status: 'pending', retainedCategories: [] });
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await waitFor(() => expect(authHarness.nextUser).toBeTypeOf('function'));
    await act(async () => {
      authHarness.auth.currentUser = userA;
      authHarness.nextUser?.(userA);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-a'));

    const clientLoad = deferred<{ auth: typeof authHarness.auth }>();
    authHarness.getClient.mockClear();
    authHarness.getClient.mockImplementationOnce(() => clientLoad.promise);
    screen.getByRole('button', { name: 'Delete account' }).click();
    await waitFor(() => expect(authHarness.getClient).toHaveBeenCalled());
    await act(async () => {
      authHarness.auth.currentUser = userB;
      authHarness.nextUser?.(userB);
    });
    await waitFor(() => expect(screen.getByTestId('player-id')).toHaveTextContent('account-b'));
    await act(async () => {
      clientLoad.resolve({ auth: authHarness.auth });
      await clientLoad.promise;
    });

    await waitFor(() => expect(authHarness.deletionOutcome).toMatchObject({
      currentAccountPreserved: true,
      signedOut: false
    }));
    expect(authHarness.signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-id')).toHaveTextContent('account-b');
  });
});
