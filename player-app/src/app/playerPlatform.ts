import { Alert, AppState, Linking, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export type PlayerAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export const playerPlatform = {
  os: Platform.OS,

  completeAuthSession() {
    WebBrowser.maybeCompleteAuthSession();
  },

  getCurrentAppState(): PlayerAppState | null {
    return AppState.currentState;
  },

  subscribeToAppState(listener: (state: PlayerAppState) => void) {
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  },

  openAuthSession(url: string, returnUrl?: string) {
    return WebBrowser.openAuthSessionAsync(url, returnUrl);
  },

  openBrowser(url: string) {
    return WebBrowser.openBrowserAsync(url);
  },

  openDirections(destination: string) {
    const encodedDestination = encodeURIComponent(destination);
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${encodedDestination}`,
      android: `google.navigation:q=${encodedDestination}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}`
    });
    // Navigation is handed off to the operating system with no in-app recovery surface.
    if (url) Linking.openURL(url).catch(() => undefined);
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

  showAccountDeletionResult(retainedCategories: string[]) {
    Alert.alert(
      'Orbit account deleted',
      retainedCategories.length
        ? `Your profile and sign-in were deleted. These categories remain without your direct identity: ${retainedCategories.join(', ')}.`
        : 'Your profile and sign-in were deleted. The configured policy retained no Orbit record categories.'
    );
  }
};

export type PlayerPlatform = typeof playerPlatform;
