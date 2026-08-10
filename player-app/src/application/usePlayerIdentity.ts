import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { isValidEmail, isValidPhoneNumber } from '../domain/discovery';
import type { PlayerAccount } from '../domain/playerSync';
import type { Screen } from '../domain/playerTypes';
import {
  createPlayerIdentityVerificationSession,
  deleteCurrentPlayerAccount,
  fetchPlayerIdentityStatus,
  getCurrentFirebasePlayer,
  isSyncConfigured,
  onFirebasePlayerChanged,
  savePlayerProfile,
  signInOrCreatePlayerWithEmail,
  signInOrCreatePlayerWithPhone,
  signOutCurrentPlayer,
  type FirebasePlayerIdentity,
  type PlayerIdentityStatus
} from '../data/orbitSyncApi';
import type { PlayerPlatform } from '../app/playerPlatform';

export const emptyIdentityStatus: PlayerIdentityStatus = {
  status: 'unverified',
  ageVerified: false,
  ageLevel: 0,
  minimumAge: 21,
  verifiedAt: null,
  failureCode: null
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
  const [identityReturnScreen, setIdentityReturnScreen] = useState<Screen>('findGames');
  const [authStatus, setAuthStatus] = useState(accountSignInReadyStatus);
  const [playerAuthMethod, setPlayerAuthMethod] = useState<'email' | 'phone'>('email');
  const [playerAuthEmail, setPlayerAuthEmail] = useState('');
  const [playerAuthPhone, setPlayerAuthPhone] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState('');

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
          setIdentityMessage(status.ageVerified ? 'Your age is verified.' : '');
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
    setScreen('findGames');
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

  const showIdentityVerification = (returnScreen: Screen, message = '') => {
    setIdentityReturnScreen(returnScreen);
    setIdentityMessage(message);
    setScreen('identityVerification');
  };

  const requireVerifiedAge = (returnScreen: Screen, action: string) => {
    if (firebaseIdentity && identityStatus.ageVerified) return true;
    if (!firebaseIdentity) {
      showIdentityVerification(returnScreen, `Sign in, then verify your age before ${action}.`);
    } else if (identityStatus.status === 'underage') {
      showIdentityVerification(returnScreen, `You must be ${identityStatus.minimumAge}+ to ${action}.`);
    } else if (identityStatus.status === 'processing') {
      showIdentityVerification(returnScreen, 'Stripe is still reviewing your verification.');
    } else {
      showIdentityVerification(returnScreen, `Verify that you are ${identityStatus.minimumAge}+ before ${action}.`);
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
        status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'processing'
            ? 'Stripe is still reviewing your verification.'
            : status.status === 'underage'
              ? `You must be ${status.minimumAge}+ to use player access features.`
              : 'Verification is not complete yet.'
      );
      return status;
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to refresh age-verification status.');
      return null;
    } finally {
      setIdentityBusy(false);
    }
  };

  const startIdentityVerification = async () => {
    if (!firebaseIdentity) {
      setIdentityMessage('Sign in to your Orbit Player account before verifying your age.');
      return;
    }
    setIdentityBusy(true);
    setIdentityMessage('Opening Stripe Identity...');
    try {
      const session = await createPlayerIdentityVerificationSession();
      setIdentityStatus(session.identity);
      if (session.alreadyVerified || session.identity.ageVerified) {
        setIdentityMessage('Your age is verified.');
        return;
      }
      if (!session.verificationUrl) {
        setIdentityMessage('Stripe is still reviewing your verification. Check again shortly.');
        return;
      }
      const browserResult = await platform.openAuthSession(session.verificationUrl, session.returnUrl);
      const status = await fetchPlayerIdentityStatus(true);
      setIdentityStatus(status);
      setIdentityMessage(
        status.ageVerified
          ? 'Your age is verified.'
          : status.status === 'processing'
            ? 'Stripe received your information and is reviewing it.'
            : status.status === 'underage'
              ? `You must be ${status.minimumAge}+ to use player access features.`
              : browserResult.type === 'cancel' || browserResult.type === 'dismiss'
                ? 'Verification was not completed. You can continue when ready.'
                : 'Stripe needs more information to finish verification.'
      );
    } catch (error) {
      setIdentityMessage(error instanceof Error ? error.message : 'Unable to start age verification.');
    } finally {
      setIdentityBusy(false);
    }
  };

  const finishFirebaseAccountConnection = async (identity: FirebasePlayerIdentity) => {
    const usesPhoneAlias = identity.email.endsWith('@players.orbit.local');
    const nextPlayer: PlayerAccount = {
      ...player,
      id: identity.uid,
      name: identity.name || player.name,
      email: usesPhoneAlias ? player.email : identity.email || player.email,
      phone: playerAuthMethod === 'phone' ? playerAuthPhone.trim() || player.phone : player.phone
    };
    setFirebaseIdentity(identity);
    setDraftPlayer(nextPlayer);
    setPlayer(nextPlayer);
    setHasAccount(true);
    await savePlayerProfile(nextPlayer);
    setAuthStatus(`Connected as ${playerAuthMethod === 'phone' ? nextPlayer.phone : nextPlayer.email}.`);
  };

  const connectPlayerAccount = async () => {
    setAuthStatus('Signing in to your Orbit Player account...');
    try {
      const identity = playerAuthMethod === 'email'
        ? await signInOrCreatePlayerWithEmail(playerAuthEmail, playerAuthPassword)
        : await signInOrCreatePlayerWithPhone(playerAuthPhone || player.phone || '', playerAuthPassword);
      await finishFirebaseAccountConnection(identity);
      setPlayerAuthPassword('');
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : 'Sign-in could not be completed.');
    }
  };

  const resetLocalAccount = async () => {
    await clearLocalPlayer();
    setFirebaseIdentity(null);
    setScreen('findGames');
  };

  const deletePlayerAccount = () => {
    platform.confirmAccountDeletion(() => {
      setAuthStatus('Deleting your account...');
      deleteCurrentPlayerAccount()
        .then(resetLocalAccount)
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
    identityStatus,
    playerAuthEmail,
    playerAuthMethod,
    playerAuthPassword,
    playerAuthPhone,
    refreshIdentityVerification,
    requireVerifiedAge,
    setPlayerAuthEmail,
    setPlayerAuthMethod,
    setPlayerAuthPassword,
    setPlayerAuthPhone,
    showIdentityVerification,
    signOutPlayer,
    startIdentityVerification
  };
}
