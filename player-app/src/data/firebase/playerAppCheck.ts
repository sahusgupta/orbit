import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

export const getPlayerFirebaseOptions = (base: FirebaseOptions): FirebaseOptions => base;

export function initializePlayerAppCheck(app: FirebaseApp): AppCheck | undefined {
  if (process.env.EXPO_PUBLIC_APP_CHECK_ENABLED !== 'true') return undefined;
  const siteKey = process.env.EXPO_PUBLIC_APP_CHECK_WEB_SITE_KEY;
  if (!siteKey) throw new Error('Web device verification is not configured.');
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
}
