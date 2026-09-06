import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import { CustomProvider, initializeAppCheck, type AppCheck } from 'firebase/app-check';
import { readAppCheckTokenExpiry } from './appCheckToken';

export function getPlayerFirebaseOptions(base: FirebaseOptions): FirebaseOptions {
  if (process.env.EXPO_PUBLIC_APP_CHECK_ENABLED !== 'true') return base;
  const nativeApp: typeof import('@react-native-firebase/app') = require('@react-native-firebase/app');
  const options = nativeApp.getApp().options;
  if (options.projectId !== base.projectId || !options.apiKey || !options.appId) {
    throw new Error('Native device verification project is not configured correctly.');
  }
  // Auth/Firestore and the native attestation must identify the same Firebase app.
  return { ...base, appId: options.appId, apiKey: options.apiKey };
}

export function initializePlayerAppCheck(app: FirebaseApp): AppCheck | undefined {
  if (process.env.EXPO_PUBLIC_APP_CHECK_ENABLED !== 'true') return undefined;
  // Defer native modules so isolated development/Expo Go can still use emulators.
  const nativeApp: typeof import('@react-native-firebase/app') = require('@react-native-firebase/app');
  const nativeCheck: typeof import('@react-native-firebase/app-check') = require('@react-native-firebase/app-check');
  const provider = new nativeCheck.ReactNativeFirebaseAppCheckProvider();
  provider.configure({ apple: { provider: 'appAttest' }, android: { provider: 'playIntegrity' } });
  const attestation = nativeCheck.initializeAppCheck(nativeApp.getApp(), {
    provider,
    isTokenAutoRefreshEnabled: true
  });
  return initializeAppCheck(app, {
    isTokenAutoRefreshEnabled: true,
    provider: new CustomProvider({
      async getToken() {
        const { token } = await nativeCheck.getToken(attestation);
        return { token, expireTimeMillis: readAppCheckTokenExpiry(token) };
      }
    })
  });
}
