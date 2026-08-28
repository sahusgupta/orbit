import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { isValidEmail, isValidPhoneNumber } from '../domain/discovery';
import { isIdentityActionEligible } from '../domain/playerIdentity';
import {
  getOrCreateIdentityCaptureAttempt,
  type ConfirmedPlayerIdentityDetails,
  type PlayerIdentityCaptureAttempt
} from '../domain/playerIdentityCapture';
import type { PlayerAccount } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import {
  completePlayerPhoneSignIn,
  deleteCurrentPlayerAccount,
  fetchPlayerIdentityStatus,
  getCurrentFirebasePlayer,
  isSyncConfigured,
  onFirebasePlayerChanged,
  requestPlayerPasswordReset,
  savePlayerIdentityCapture,
  savePlayerProfile,
  signInOrCreatePlayerWithEmail,
  startPlayerPhoneSignIn,
  signOutCurrentPlayer,
  type FirebasePlayerIdentity,
  type PlayerIdentityStatus
} from '../data/orbitSyncApi';
import type { PlayerPlatform } from '../app/playerPlatform';

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

type UsePlayerIdentityOptions = {
  clearLocalPlayer(): Promise<void>;
  draftPlayer: PlayerAccount;
  platform: PlayerPlatform;
  player: PlayerAccount;
  setDraftPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setHasAccount: Dispatch<SetStateAction<boolean>>;
  setPlayer: Dispatch<SetStateAction<PlayerAccount>>;
  setScreen: Dispatch<SetStateAction<Screen>>;
  setSyncStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerIdentity({
  clearLocalPlayer,
  draftPlayer,
  platform,
  player,
  setDraftPlayer,
  setHasAccount,
  setPlayer,
  setScreen,
  setSyncStatus
}: UsePlayerIdentityOptions) {
  const [firebaseIdentity, setFirebaseIdentity] = useState<FirebasePlayerIdentity | null>(() => getCurrentFirebasePlayer());
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
  const identityCaptureAttempt = useRef<PlayerIdentityCaptureAttempt | null>(null);

  useEffect(() => onFirebasePlayerChanged(setFirebaseIdentity), []);

  useEffect(() => {
    if (!firebaseIdentity) {
      setIdentityStatus(emptyIdentityStatus);
      return undefined;
    }
    let active = true;
    const refresh = (forceTokenRefresh = false) => {
      fetchPlayerIdentityStatus(forceTokenRefresh)
        .then((status) => {
          if (!active) return;
          setIdentityStatus(status);
          setIdentityMessage(status.reviewStatus === 'pending-in-person'
            ? 'Your ID details are saved. Staff will check the physical ID when you arrive.'
            : status.ageVerified ? 'Your age is verified.' : '');
        })
        .catch((error) => {
          if (active) setIdentityMessage(error instanceof Error ? error.message : 'Unable to check age-verification status.');
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

  const finishAccount = (identity?: FirebasePlayerIdentity | null) => {
    const normalizedName = draftPlayer.name.trim() || identity?.name.trim() || '';
    const normalizedEmail = draftPlayer.email.trim() || identity?.email.trim() || '';
    if (!normalizedName || !isValidEmail(normalizedEmail) || !isValidPhoneNumber(draftPlayer.phone ?? '', true)) return;
    const id = identity?.uid || draftPlayer.id || `player_${normalizedEmail.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || Date.now()}`;
    const nextPlayer = {
      ...draftPlayer,
      id,
      name: normalizedName,
      email: normalizedEmail,
      searchRadiusMiles: draftPlayer.searchRadiusMiles ?? 20,
      preferredGameIds: draftPlayer.preferredGameIds.length ? draftPlayer.preferredGameIds : ['nlh-1-2']
    };
    setPlayer(nextPlayer);
    setDraftPlayer(nextPlayer);
    setHasAccount(true);
    setScreen('home');
    setSyncStatus(isSyncConfigured() ? 'Account ready - syncing from Firebase...' : 'Account ready, but live club sync is unavailable.');
    // Account creation is locally complete; remote profile publication is background fan-out.
    if (identity) savePlayerProfile(nextPlayer).catch(() => undefined);
  };

  const completeAccount = async () => {
    const normalizedName = draftPlayer.name.trim();
    const normalizedEmail = draftPlayer.email.trim();
    if (!normalizedName || !isValidEmail(normalizedEmail) || !isValidPhoneNumber(draftPlayer.phone ?? '', true)) return;
    finishAccount(firebaseIdentity);
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
    setIdentityBusy(true);
    try {
      const status = await fetchPlayerIdentityStatus(true);
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
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to refresh age-verification status.');
      return null;
    } finally {
      setIdentityBusy(false);
    }
  };

  const startIdentityVerification = async (details: ConfirmedPlayerIdentityDetails) => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return;
    }
    const attempt = getOrCreateIdentityCaptureAttempt(
      identityCaptureAttempt.current,
      details,
      () => `identity:${firebaseIdentity.uid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
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
      });
      identityCaptureAttempt.current = null;
      setIdentityStatus(status);
      setIdentityMessage(status.reviewStatus === 'pending-in-person'
        ? 'ID details sent. Bring the physical ID so card-house staff can approve it on your first visit.'
        : status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'underage'
            ? `You must be ${status.minimumAge}+ to use player access features.`
            : 'The confirmed ID details were saved.');
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to save the confirmed ID details. Try again.');
    } finally {
      setIdentityBusy(false);
    }
  };

  const finishFirebaseAccountConnection = async (identity: FirebasePlayerIdentity) => {
    const nextPlayer: PlayerAccount = {
      ...player,
      id: identity.uid,
      name: identity.name || player.name,
      email: identity.email || player.email,
      phone: identity.phone || player.phone
    };
    setFirebaseIdentity(identity);
    setDraftPlayer(nextPlayer);
    setPlayer(nextPlayer);
    setHasAccount(true);
    await savePlayerProfile(nextPlayer);
    setAuthStatus(`Connected as ${playerAuthMethod === 'phone' ? nextPlayer.phone : nextPlayer.email}.`);
    setIdentityReturnScreen('settings');
    setIdentityRequiredMinimumAge(18);
    setIdentityMessage('Scan the PDF417 barcode on a government-issued ID to fill your name, date of birth, and address.');
    setScreen('identityVerification');
  };

  const connectPlayerAccount = async () => {
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
      setAuthStatus(error instanceof Error ? error.message : 'Sign-in could not be completed.');
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
    setPlayerAuthPhone(phone);
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
    setFirebaseIdentity(null);
    setScreen('home');
  };

  const deletePlayerAccount = () => {
    platform.confirmAccountDeletion(() => {
      setAuthStatus('Deleting your account...');
      deleteCurrentPlayerAccount()
        .then(async (result) => {
          platform.showAccountDeletionResult(result?.retainedCategories ?? []);
          await resetLocalAccount();
        })
        .catch((error) => {
          const requiresLogin = (error as { code?: string }).code === 'auth/requires-recent-login';
          setAuthStatus(requiresLogin
            ? 'For security, sign out and sign back in before deleting your account.'
            : error instanceof Error ? error.message : 'Unable to delete the account.');
        });
    });
  };

  const signOutPlayer = async () => {
    await signOutCurrentPlayer();
    await resetLocalAccount();
  };

  return {
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
    recoverPlayerAccount,
    refreshIdentityVerification,
    requireVerifiedAge,
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
