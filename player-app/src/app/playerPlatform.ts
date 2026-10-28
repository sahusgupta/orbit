import { Alert, AppState, Linking, Platform } from 'react-native';
import { buildPlayerDirectionsUrl, type PlayerDirectionsResult } from './playerDirections';
import type { PlayerCoordinate } from '../domain/playerSync';

export type PlayerAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export const playerPlatform = {
  os: Platform.OS,

  getCurrentAppState(): PlayerAppState | null {
    const state = AppState.currentState;
    if (state == null) return null;
    switch (state) {
      case 'active':
      case 'background':
      case 'inactive':
      case 'unknown':
      case 'extension':
        return state;
      default:
        return 'unknown';
    }
  },

  subscribeToAppState(listener: (state: PlayerAppState) => void) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },

  async openDirections(destination: string, coordinate?: PlayerCoordinate | null): Promise<PlayerDirectionsResult> {
    const url = buildPlayerDirectionsUrl(Platform.OS, destination, coordinate, Platform.Version);
    const error = url ? 'Orbit could not open your maps app. Try again or use the venue’s published address.' : 'This venue has not published a valid address or coordinate for directions.';
    if (url) {
      try { await Linking.openURL(url); return { ok: true }; } catch { /* Display a recoverable handoff failure below. */ }
    }
    Alert.alert('Directions unavailable', error);
    return { ok: false, error };
  },

  confirmAccountDeletion(onConfirm: () => void) {
    Alert.alert(
      'Delete Orbit Player account?',
      'This permanently deletes your Orbit Player profile and sign-in. Club transaction records may be retained where legally required.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: onConfirm }
      ]
    );
  },

  confirmLocalProfileDeletion(onConfirm: () => void) {
    Alert.alert(
      'Delete local profile and data?',
      'This permanently deletes the Orbit Player profile and preferences stored on this device. It does not delete a signed-in account or venue records.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete local data', style: 'destructive', onPress: onConfirm }
      ]
    );
  },

  openAppSettings() {
    return Linking.openSettings();
  },

  showLocalProfileDeletionResult() {
    Alert.alert('Local profile deleted', 'The Orbit Player profile and preferences stored on this device were deleted.');
  },

  showAccountDeletionResult(result: {
    currentAccountPreserved: boolean;
    localDataCleared: boolean;
    retainedCategories: string[];
    signedOut: boolean;
    status: 'complete' | 'pending';
  }) {
    const retainedCopy = result.retainedCategories.length
      ? ` These categories may be retained under Orbit's privacy and legal policy: ${result.retainedCategories.join(', ')}.`
      : ' The configured policy retained no Orbit record categories.';
    const signOutCopy = result.signedOut
      ? ''
      : ' This device could not confirm secure sign-out. The app will remain blocked until you retry and finish device cleanup.';
    if (result.currentAccountPreserved) {
      Alert.alert(
        result.status === 'pending' ? 'Prior account deletion accepted' : 'Prior Orbit account deleted',
        `${result.status === 'pending'
          ? 'Deletion of the previously signed-in Orbit account was accepted and is still being finalized by the server.'
          : 'The previously signed-in Orbit account was deleted.'} The account now signed in on this device remained signed in, and its local profile and identity were preserved.${retainedCopy}`
      );
      return;
    }
    Alert.alert(
      result.status === 'pending' ? 'Account deletion accepted' : 'Orbit account deleted',
      result.status === 'pending'
        ? `Your account deletion request was accepted and your local profile was deleted. Server account-data cleanup and sign-in deletion are still in progress; no server retry is required.${retainedCopy}${signOutCopy}`
        : `Your profile, sign-in, and local Orbit data were deleted.${retainedCopy}${signOutCopy}`
    );
  }
};

export type PlayerPlatform = typeof playerPlatform;
