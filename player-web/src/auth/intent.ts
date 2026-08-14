export type PlayerIntent = 'membership' | 'waitlist' | 'tournament';

export function safeReturnPath(value: string | null | undefined, fallback = '/me') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

export function buildSignInHref(returnTo: string, intent?: PlayerIntent) {
  const query = new URLSearchParams({ returnTo: safeReturnPath(returnTo) });
  if (intent) query.set('intent', intent);
  return `/sign-in?${query.toString()}`;
}

export function buildIntentReturnPath(returnTo: string, intent?: PlayerIntent) {
  const safePath = safeReturnPath(returnTo);
  if (!intent) return safePath;
  const [pathname, query = ''] = safePath.split('?');
  const params = new URLSearchParams(query);
  params.set('intent', intent);
  return `${pathname}?${params.toString()}`;
}

export function isPlayerIntent(value: string | null): value is PlayerIntent {
  return value === 'membership' || value === 'waitlist' || value === 'tournament';
}
