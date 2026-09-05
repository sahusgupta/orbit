import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { isValidEmail } from '../domain/discovery';
import { isIdentityActionEligible } from '../domain/playerIdentity';
import { hasAdultDeclaration } from '../domain/playerOnboarding';
import { normalizeE164Phone } from '../domain/playerPhone';
import {
  getOrCreateIdentityCaptureAttempt,
  type ConfirmedPlayerIdentityDetails,
  type PlayerIdentityCaptureAttempt
} from '../domain/playerIdentityCapture';
import { createOpaquePlayerId, type PlayerAccount } from '../domain/playerSync';
import type { OnboardingStep, Screen } from '../domain/playerTypes';
import {
  completePlayerPhoneSignIn,
  completePlayerAdultDeclarationIfMissing,
  createPlayerProfileIfMissing,
  deleteCurrentPlayerAccount,
  fetchPlayerIdentityStatus,
  fetchPlayerProfile,
  getCurrentFirebaseAuthUid,
  getCurrentFirebasePlayer,
  isSyncConfigured,
  onFirebasePlayerChanged,
  requestPlayerPasswordReset,
  savePlayerIdentityCapture,
  signInOrCreatePlayerWithEmail,
  startPlayerPhoneSignIn,
  signOutCurrentPlayer,
  type FirebasePlayerIdentity,
  type PlayerIdentityStatus
} from '../data/orbitSyncApi';
import type { PlayerPlatform } from '../app/playerPlatform';
import { playerStorage } from '../data/storage/playerStorage';
import { resolveAuthenticatedPlayerProfile } from './playerProfileHydration';

export const emptyIdentityStatus: PlayerIdentityStatus = {
  status: 'unverified',
  ageVerified: false,
  ageEligible: false,
  ageLevel: 0,
  minimumAge: 18,
  verifiedAt: null,
  capturedAt: null,
  failureCode: null,
  reviewStatus: 'not-started',
  verifiedDetails: null
};

export const accountSignInReadyStatus = 'Use your email address or phone number to sync this player profile.';

export function getAccountDeletionFailureMessage(error: unknown) {
  const errorCode = (error as { code?: string } | null)?.code;
  if (errorCode === 'auth/requires-recent-login' || errorCode === 'RECENT_LOGIN_REQUIRED') {
    return 'For security, sign out and sign back in before deleting your account.';
  }
  if (errorCode === 'DELETION_FINALIZATION_PENDING') {
    return 'The server did not confirm that account deletion was accepted. Your local profile was kept.';
  }
  return error instanceof Error ? error.message : 'Unable to delete the account.';
}

export async function finalizeAcceptedPlayerDeletion(
  result: Awaited<ReturnType<typeof deleteCurrentPlayerAccount>>,
  getCurrentUid: () => string | null,
  clearLocalAccount: () => Promise<void>,
  reportResult: (accepted: Awaited<ReturnType<typeof deleteCurrentPlayerAccount>> & { localDataCleared: boolean }) => void,
  persistPendingAuthCleanup: (uid: string) => Promise<void>
) {
  const currentUid = getCurrentUid();
  if (result.currentAccountPreserved || (currentUid !== null && currentUid !== result.initiatingUid)) {
    reportResult({ ...result, currentAccountPreserved: true, localDataCleared: false });
    return 'complete' as const;
  }
  const authCleanupRequired = !result.signedOut || currentUid === result.initiatingUid;
  try {
    if (authCleanupRequired) await persistPendingAuthCleanup(result.initiatingUid);
    await clearLocalAccount();
  } catch {
    return 'local-cleanup-failed' as const;
  }
  reportResult({ ...result, currentAccountPreserved: false, localDataCleared: true });
  return authCleanupRequired ? 'auth-cleanup-required' as const : 'complete' as const;
}

export async function resolvePendingPlayerAuthCleanup(ports: {
  clearLocalAccount(): Promise<void>;
  clearPendingUid(uid: string): Promise<void>;
  currentUid(): string | null;
  loadPendingUid(): Promise<string | null>;
  signOutRawAuth(): Promise<void>;
}) {
  const pendingUid = await ports.loadPendingUid();
  if (!pendingUid) return 'none' as const;
  const currentUid = ports.currentUid();
  if (currentUid !== null && currentUid !== pendingUid) {
    await ports.clearPendingUid(pendingUid);
    return 'new-account-preserved' as const;
  }
  if (currentUid === pendingUid) await ports.signOutRawAuth();
  const uidAfterSignOut = ports.currentUid();
  if (uidAfterSignOut === pendingUid) {
    throw new Error('The deleted account is still signed in on this device.');
  }
  if (uidAfterSignOut !== null) {
    await ports.clearPendingUid(pendingUid);
    return 'new-account-preserved' as const;
  }
  await ports.clearLocalAccount();
  await ports.clearPendingUid(pendingUid);
  return 'complete' as const;
}

export function observePlayerAuthInitialization(
  subscribe: (callback: (identity: FirebasePlayerIdentity | null) => void) => () => void,
  updateIdentity: (identity: FirebasePlayerIdentity | null) => void,
  markLoaded: () => void,
  rawSession?: {
    clear(): Promise<void>;
    currentUid(): string | null;
    reportFailure(error: unknown): void;
    shouldClear(): boolean;
  }
) {
  let loaded = false;
  const finish = (identity: FirebasePlayerIdentity | null) => {
    updateIdentity(identity);
    if (!loaded) {
      loaded = true;
      markLoaded();
    }
  };
  return subscribe((identity) => {
    if (identity || !rawSession?.currentUid() || !rawSession.shouldClear()) {
      finish(identity);
      return;
    }
    // A durable unverified session can remain after an interrupted account
    // creation. It is never treated as a normal local-only state.
    void rawSession.clear()
      .then(() => {
        if (rawSession.currentUid()) throw new Error('The unverified Firebase session is still active.');
        finish(null);
      })
      .catch((error) => {
        rawSession.reportFailure(error);
        if (!loaded) {
          loaded = true;
          markLoaded();
        }
      });
  });
}

export async function clearConfirmedLocalPlayerProfile(
  expectedAuthUid: string | null,
  currentAuthUid: () => string | null,
  signOutRawAuth: () => Promise<void>,
  clearLocalAccount: () => Promise<void>
) {
  if (currentAuthUid() !== expectedAuthUid) return false;
  if (expectedAuthUid) await signOutRawAuth();
  if (currentAuthUid() !== null) return false;
  await clearLocalAccount();
  return true;
}

export async function clearIncompletePlayerAuthSession(
  currentAuthUid: () => string | null,
  signOutRawAuth: () => Promise<void>,
  reportFailure: () => void
) {
  if (!currentAuthUid()) return true;
  try {
    await signOutRawAuth();
  } catch {
    reportFailure();
    return false;
  }
  return true;
}

type UsePlayerIdentityOptions = {
  accountLoaded: boolean;
  clearLocalPlayer(): Promise<void>;
  draftPlayer: PlayerAccount;
  platform: PlayerPlatform;
  player: PlayerAccount;
  setDraftPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setHasAccount: Dispatch<SetStateAction<boolean>>;
  setOnboardingStep: Dispatch<SetStateAction<OnboardingStep>>;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerIdentity({
  accountLoaded,
  clearLocalPlayer,
  draftPlayer,
  platform,
  player,
  setDraftPlayer,
  setHasAccount,
  setOnboardingStep,
  setPlayer,
  setScreen,
  setSyncStatus
}: UsePlayerIdentityOptions) {
  const [firebaseIdentity, setFirebaseIdentity] = useState<FirebasePlayerIdentity | null>(() => getCurrentFirebasePlayer());
  const [authLoaded, setAuthLoaded] = useState(false);
  const [authInitializationError, setAuthInitializationError] = useState('');
  const [authInitializationRetryVersion, setAuthInitializationRetryVersion] = useState(0);
  const [identityStatus, setIdentityStatus] = useState<PlayerIdentityStatus>(emptyIdentityStatus);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [identityMessage, setIdentityMessage] = useState('');
  const [identityReturnScreen, setIdentityReturnScreen] = useState<Screen>('home');
  const [identityRequiredMinimumAge, setIdentityRequiredMinimumAge] = useState<18 | 21>(18);
  const [authStatus, setAuthStatus] = useState(accountSignInReadyStatus);
  const [playerAuthMethod, setPlayerAuthMethod] = useState<'email' | 'phone'>('email');
  const [playerAuthEmail, setPlayerAuthEmail] = useState('');
  const [playerAuthPhone, setPlayerAuthPhone] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState('');
  const [playerAuthCode, setPlayerAuthCode] = useState('');
  const [playerPhoneChallenge, setPlayerPhoneChallenge] = useState('');
  const [profileConnectionBusy, setProfileConnectionBusy] = useState(false);
  const identityCaptureAttempt = useRef<PlayerIdentityCaptureAttempt | null>(null);
  const authOperationInFlight = useRef(false);
  const identitySession = useRef({
    generation: 0,
    uid: firebaseIdentity?.uid ?? null as string | null
  });

  const updateFirebaseIdentity = useCallback((nextIdentity: FirebasePlayerIdentity | null) => {
    const nextUid = nextIdentity?.uid ?? null;
    if (identitySession.current.uid !== nextUid) {
      identitySession.current = {
        generation: identitySession.current.generation + 1,
        uid: nextUid
      };
      identityCaptureAttempt.current = null;
      setIdentityStatus(emptyIdentityStatus);
      setIdentityBusy(false);
      setIdentityMessage('');
    }
    setFirebaseIdentity(nextIdentity);
  }, []);

  const captureIdentityAction = (uid: string) => ({
    generation: identitySession.current.generation,
    uid
  });
  const isCurrentIdentityAction = (action: { generation: number; uid: string }) => (
    identitySession.current.uid === action.uid &&
    identitySession.current.generation === action.generation &&
    getCurrentFirebasePlayer()?.uid === action.uid
  );

  useEffect(() => {
    if (!accountLoaded) return undefined;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    setAuthLoaded(false);
    void resolvePendingPlayerAuthCleanup({
      clearLocalAccount: clearLocalPlayer,
      clearPendingUid: (uid) => playerStorage.clearPendingPlayerAuthCleanupUid(uid),
      currentUid: getCurrentFirebaseAuthUid,
      loadPendingUid: () => playerStorage.loadPendingPlayerAuthCleanupUid(),
      signOutRawAuth: signOutCurrentPlayer
    })
      .then(() => {
        if (!active) return;
        setAuthInitializationError('');
        unsubscribe = observePlayerAuthInitialization(
          onFirebasePlayerChanged,
          updateFirebaseIdentity,
          () => setAuthLoaded(true),
          {
            clear: signOutCurrentPlayer,
            currentUid: getCurrentFirebaseAuthUid,
            reportFailure: () => setAuthInitializationError('Orbit found an incomplete sign-in session but could not clear it securely. Retry before continuing.'),
            shouldClear: () => !authOperationInFlight.current
          }
        );
      })
      .catch(() => {
        if (!active) return;
        setAuthInitializationError('Orbit could not verify and finish secure sign-in cleanup. Retry before continuing.');
        setAuthLoaded(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountLoaded, authInitializationRetryVersion, updateFirebaseIdentity]);

  useEffect(() => {
    if (!firebaseIdentity) {
      setIdentityStatus(emptyIdentityStatus);
      return undefined;
    }
    let active = true;
    const action = captureIdentityAction(firebaseIdentity.uid);
    const refresh = (forceTokenRefresh = false) => {
      fetchPlayerIdentityStatus(forceTokenRefresh, action.uid)
        .then((status) => {
          if (!active || !isCurrentIdentityAction(action)) return;
          setIdentityStatus(status);
          setIdentityMessage(status.reviewStatus === 'pending-in-person'
            ? 'Your ID details are saved. Staff will check the physical ID when you arrive.'
            : status.ageVerified ? 'Your age is verified.' : '');
        })
        .catch((error) => {
          if (active && isCurrentIdentityAction(action)) {
            setIdentityMessage(error instanceof Error ? error.message : 'Unable to check age-verification status.');
          }
        });
    };
    const unsubscribeFromAppState = platform.subscribeToAppState((nextState) => {
      if (nextState === 'active') refresh(true);
    });
    refresh();
    return () => {
      active = false;
      unsubscribeFromAppState();
    };
  }, [firebaseIdentity?.uid]);

  const finishAccount = async (identity?: FirebasePlayerIdentity | null) => {
    const normalizedName = draftPlayer.name.trim() || identity?.name.trim() || '';
    const normalizedEmail = identity?.provider === 'phone' ? '' : draftPlayer.email.trim() || identity?.email.trim() || '';
    const phoneInput = identity?.provider === 'phone' ? identity.phone ?? '' : draftPlayer.phone ?? '';
    const normalizedPhone = normalizeE164Phone(phoneInput);
    const contactIsValid = identity?.provider === 'phone'
      ? Boolean(normalizedPhone)
      : isValidEmail(normalizedEmail) && (!phoneInput.trim() || Boolean(normalizedPhone));
    if (!normalizedName || !contactIsValid || !hasAdultDeclaration(draftPlayer)) return;
    // Existing local IDs remain readable for migration; new local-only IDs never embed identity data.
    const id = identity?.uid || draftPlayer.id || createOpaquePlayerId('player');
    const localPlayer = {
      ...draftPlayer,
      id,
      name: normalizedName,
      email: normalizedEmail,
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      preferredGameIds: draftPlayer.preferredGameIds
    };
    let nextPlayer = localPlayer;
    if (identity) {
      setProfileConnectionBusy(true);
      setSyncStatus('Checking for your saved Orbit profile before syncing changes...');
      try {
        const resolved = await resolveAuthenticatedPlayerProfile(identity, localPlayer, {
          completeAdultDeclarationIfMissing: completePlayerAdultDeclarationIfMissing,
          createProfileIfMissing: createPlayerProfileIfMissing,
          readProfile: fetchPlayerProfile,
        });
        nextPlayer = resolved.player;
        if (resolved.source === 'remote-needs-adult-declaration') {
          setPlayer(nextPlayer);
          setDraftPlayer(nextPlayer);
          setHasAccount(false);
          setOnboardingStep(3);
          setSyncStatus('Confirm that you are 18 or older for this restored Orbit Player account before continuing.');
          return;
        }
      } catch (error) {
        setSyncStatus(error instanceof Error
          ? `Your saved profile could not be checked, so no profile changes were synced: ${error.message}`
          : 'Your saved profile could not be checked, so no profile changes were synced.');
        return;
      } finally {
        setProfileConnectionBusy(false);
      }
    }
    setPlayer(nextPlayer);
    setDraftPlayer(nextPlayer);
    setHasAccount(true);
    setScreen('home');
    setSyncStatus(isSyncConfigured() ? 'Account ready - loading published venue data...' : 'Account ready, but published venue sync is unavailable.');
  };

  const completeAccount = async () => {
    await finishAccount(firebaseIdentity);
  };

  const showIdentityVerification = (returnScreen: Screen, message = '', minimumAge: 18 | 21 = 18) => {
    setIdentityReturnScreen(returnScreen);
    setIdentityMessage(message);
    setIdentityRequiredMinimumAge(minimumAge);
    setScreen('identityVerification');
  };

  const requireVerifiedAge = (returnScreen: Screen, action: string, minimumAge: 18 | 21 = 21) => {
    if (firebaseIdentity && isIdentityActionEligible(identityStatus, minimumAge)) return true;
    if (!firebaseIdentity) {
      showIdentityVerification(returnScreen, `Sign in, then verify that you are ${minimumAge}+ before ${action}.`, minimumAge);
    } else if (identityStatus.status === 'underage' || identityStatus.ageLevel > 0 && identityStatus.ageLevel < minimumAge) {
      showIdentityVerification(returnScreen, `You must be ${minimumAge}+ to ${action}.`, minimumAge);
    } else {
      showIdentityVerification(returnScreen, `Scan the barcode on your ID to confirm that you are ${minimumAge}+ before ${action}.`, minimumAge);
    }
    return false;
  };

  const refreshIdentityVerification = async () => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return null;
    }
    const action = captureIdentityAction(firebaseIdentity.uid);
    setIdentityBusy(true);
    try {
      const status = await fetchPlayerIdentityStatus(true, action.uid);
      if (!isCurrentIdentityAction(action)) return null;
      setIdentityStatus(status);
      setIdentityMessage(
        status.reviewStatus === 'pending-in-person'
          ? 'Your ID details are saved. Staff will check the physical ID when you arrive.'
          : status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'underage'
              ? `You must be ${status.minimumAge}+ to use player access features.`
              : 'ID capture is not complete yet.'
      );
      return status;
    } catch (error) {
      if (!isCurrentIdentityAction(action)) return null;
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to refresh age-verification status.');
      return null;
    } finally {
      if (isCurrentIdentityAction(action)) setIdentityBusy(false);
    }
  };

  const startIdentityVerification = async (details: ConfirmedPlayerIdentityDetails) => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return;
    }
    const action = captureIdentityAction(firebaseIdentity.uid);
    const attempt = getOrCreateIdentityCaptureAttempt(
      identityCaptureAttempt.current,
      details,
      () => createOpaquePlayerId('identity')
    );
    identityCaptureAttempt.current = attempt;
    setIdentityBusy(true);
    setIdentityMessage('Sending the confirmed ID details securely...');
    try {
      const status = await savePlayerIdentityCapture({
        fullName: details.fullName,
        dateOfBirth: details.dateOfBirth,
        address: details.address,
        mutationId: attempt.mutationId
      }, action.uid);
      if (!isCurrentIdentityAction(action)) return;
      identityCaptureAttempt.current = null;
      setIdentityStatus(status);
      setIdentityMessage(status.reviewStatus === 'pending-in-person'
        ? 'ID details sent. Bring the physical ID so venue staff can review it on your first visit.'
        : status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'underage'
            ? `You must be ${status.minimumAge}+ to use player access features.`
            : 'The confirmed ID details were saved.');
    } catch (error) {
      if (!isCurrentIdentityAction(action)) return;
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to save the confirmed ID details. Try again.');
    } finally {
      if (isCurrentIdentityAction(action)) setIdentityBusy(false);
    }
  };

  const finishFirebaseAccountConnection = async (identity: FirebasePlayerIdentity) => {
    const resolved = await resolveAuthenticatedPlayerProfile(identity, player, {
      completeAdultDeclarationIfMissing: completePlayerAdultDeclarationIfMissing,
      createProfileIfMissing: createPlayerProfileIfMissing,
      readProfile: fetchPlayerProfile,
    });
    const nextPlayer = resolved.player;
    updateFirebaseIdentity(identity);
    setDraftPlayer(nextPlayer);
    setPlayer(nextPlayer);
    if (resolved.source === 'remote-needs-adult-declaration') {
      setHasAccount(false);
      setOnboardingStep(3);
      setAuthStatus('Restored this account. Confirm that you are 18 or older before continuing.');
      return;
    }
    setHasAccount(true);
    setAuthStatus(`${resolved.source === 'remote' ? 'Restored' : 'Created'} the profile connected as ${playerAuthMethod === 'phone' ? nextPlayer.phone : nextPlayer.email}.`);
    setIdentityReturnScreen('settings');
    setIdentityRequiredMinimumAge(18);
    setIdentityMessage('Scan the PDF417 barcode on a government-issued ID to fill your name, date of birth, and address.');
    setScreen('identityVerification');
  };

  const connectPlayerAccount = async () => {
    authOperationInFlight.current = true;
    setProfileConnectionBusy(true);
    try {
      if (playerAuthMethod === 'phone' && !playerPhoneChallenge) {
        setAuthStatus('Sending a one-time SMS code...');
        const result = await startPlayerPhoneSignIn(playerAuthPhone || player.phone || '');
        setPlayerPhoneChallenge(result.challenge);
        setAuthStatus('Enter the one-time code sent to your phone. It expires in 10 minutes.');
        return;
      }
      setAuthStatus('Verifying and signing in...');
      const identity = playerAuthMethod === 'email'
        ? await signInOrCreatePlayerWithEmail(playerAuthEmail, playerAuthPassword)
        : await completePlayerPhoneSignIn(playerAuthPhone || player.phone || '', playerAuthCode, playerPhoneChallenge);
      await finishFirebaseAccountConnection(identity);
      setPlayerAuthPassword('');
      setPlayerAuthCode('');
      setPlayerPhoneChallenge('');
    } catch (error) {
      const clearedIncompleteSession = await clearIncompletePlayerAuthSession(
        getCurrentFirebaseAuthUid,
        signOutCurrentPlayer,
        () => setAuthInitializationError('Orbit could not clear an incomplete sign-in session securely. Retry secure sign-in cleanup before continuing.')
      );
      if (clearedIncompleteSession) updateFirebaseIdentity(null);
      setAuthStatus(error instanceof Error
        ? `Sign-in was not completed and no local profile changes were synced: ${error.message}`
        : 'Sign-in was not completed and no local profile changes were synced.');
    } finally {
      authOperationInFlight.current = false;
      setProfileConnectionBusy(false);
    }
  };

  const recoverPlayerAccount = async () => {
    try {
      setAuthStatus(await requestPlayerPasswordReset(playerAuthEmail));
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : 'Password recovery could not be started.');
    }
  };

  const updatePlayerAuthPhone = (phone: string) => {
    setPlayerAuthPhone(normalizeE164Phone(phone) || phone);
    setPlayerAuthCode('');
    setPlayerPhoneChallenge('');
  };

  const restartPlayerPhoneSignIn = () => {
    setPlayerAuthCode('');
    setPlayerPhoneChallenge('');
    setAuthStatus(accountSignInReadyStatus);
  };

  const resetLocalAccount = async () => {
    await clearLocalPlayer();
    updateFirebaseIdentity(null);
    setIdentityStatus(emptyIdentityStatus);
    setIdentityBusy(false);
    setIdentityMessage('');
    setIdentityReturnScreen('home');
    setIdentityRequiredMinimumAge(18);
    setAuthStatus(accountSignInReadyStatus);
    setPlayerAuthMethod('email');
    setPlayerAuthEmail('');
    setPlayerAuthPhone('');
    setPlayerAuthPassword('');
    setPlayerAuthCode('');
    setPlayerPhoneChallenge('');
    identityCaptureAttempt.current = null;
    setScreen('home');
  };

  const deletePlayerAccount = () => {
    if (!firebaseIdentity) {
      const expectedAuthUid = getCurrentFirebaseAuthUid();
      platform.confirmLocalProfileDeletion(() => {
        setAuthStatus('Deleting the local profile...');
        clearConfirmedLocalPlayerProfile(
          expectedAuthUid,
          getCurrentFirebaseAuthUid,
          signOutCurrentPlayer,
          resetLocalAccount
        )
          .then((cleared) => {
            if (!cleared) {
              setAuthStatus('A different sign-in session is now active, so its local profile was not deleted.');
              return;
            }
            platform.showLocalProfileDeletionResult();
          })
          .catch((error) => setAuthStatus(error instanceof Error ? error.message : 'Unable to delete the local profile.'));
      });
      return;
    }
    const initiatingUid = firebaseIdentity.uid;
    platform.confirmAccountDeletion(() => {
      if (getCurrentFirebasePlayer()?.uid !== initiatingUid) {
        setAuthStatus('The signed-in account changed, so no account deletion request was sent.');
        return;
      }
      setAuthStatus('Deleting your account...');
      deleteCurrentPlayerAccount(initiatingUid)
        .then(async (result) => {
          const deletionOutcome = await finalizeAcceptedPlayerDeletion(
            result,
            getCurrentFirebaseAuthUid,
            resetLocalAccount,
            (accepted) => platform.showAccountDeletionResult(accepted),
            (uid) => playerStorage.savePendingPlayerAuthCleanupUid(uid)
          );
          if (deletionOutcome === 'auth-cleanup-required') {
            setAuthInitializationError('Account deletion was accepted, but this device has not finished secure sign-out and local cleanup. Retry before continuing.');
            setAuthLoaded(true);
          } else if (deletionOutcome === 'local-cleanup-failed') {
            setAuthStatus('Account deletion was accepted by the server, but this device could not securely record or clear its remaining local session and profile. Use Sign out or Delete local profile and data to retry cleanup.');
          }
        })
        .catch((error) => {
          const currentUid = getCurrentFirebasePlayer()?.uid ?? null;
          if (currentUid !== null && currentUid !== initiatingUid) return;
          setAuthStatus(getAccountDeletionFailureMessage(error));
        });
    });
  };

  const signOutPlayer = async () => {
    await signOutCurrentPlayer();
    await resetLocalAccount();
  };

  return {
    authLoaded,
    authInitializationError,
    authStatus,
    completeAccount,
    connectPlayerAccount,
    deletePlayerAccount,
    firebaseIdentity,
    identityBusy,
    identityMessage,
    identityReturnScreen,
    identityRequiredMinimumAge,
    identityStatus,
    playerAuthEmail,
    playerAuthCode,
    playerAuthMethod,
    playerAuthPassword,
    playerAuthPhone,
    playerPhoneChallenge: Boolean(playerPhoneChallenge),
    profileSyncPaused: profileConnectionBusy,
    recoverPlayerAccount,
    refreshIdentityVerification,
    requireVerifiedAge,
    retryAuthInitialization: () => {
      setAuthLoaded(false);
      setAuthInitializationError('');
      setAuthInitializationRetryVersion((current) => current + 1);
    },
    setPlayerAuthEmail,
    setPlayerAuthCode,
    setPlayerAuthMethod,
    setPlayerAuthPassword,
    setPlayerAuthPhone: updatePlayerAuthPhone,
    showIdentityVerification,
    restartPlayerPhoneSignIn,
    signOutPlayer,
    startIdentityVerification
  };
}
