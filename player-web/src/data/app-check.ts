import type { FirebaseApp } from 'firebase/app';
import { getToken, initializeAppCheck, onTokenChanged, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { withDeadline } from '@/src/auth/deadline';

export function subscribeToWebAppCheck(appCheck: AppCheck | undefined, update: (token?: string) => void) {
  if (!appCheck) return () => {};
  return onTokenChanged(appCheck, ({ token }) => update(token), () => update());
}

export function initializeWebAppCheck(app: FirebaseApp): AppCheck | undefined {
  if (process.env.NEXT_PUBLIC_APP_CHECK_ENABLED !== 'true') return undefined;
  const key = process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY;
  if (!key) throw new Error('Browser verification is not configured.');
  return initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
}

export async function webAppCheckHeaders(appCheck: AppCheck | undefined): Promise<Record<string, string>> {
  if (!appCheck) return {};
  try {
    const { token } = await withDeadline(getToken(appCheck), 'Browser verification timed out.');
    if (!token) throw new Error();
    return { 'X-Firebase-AppCheck': token };
  } catch {
    throw new Error('Browser verification is unavailable. Check your connection and try again.');
  }
}
