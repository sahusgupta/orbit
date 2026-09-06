export const PLAYER_SESSION_COOKIE = 'orbit-player-session';
export const PLAYER_APP_CHECK_COOKIE = 'orbit-player-app-check';

export function persistPlayerAppCheckToken(token?: string) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAYER_APP_CHECK_COOKIE}=${encodeURIComponent(token || '')}; Path=/; Max-Age=${token ? 3600 : 0}; SameSite=Lax${secure}`;
}

export function persistPlayerSessionToken(token: string, appCheckToken?: string) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAYER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=3600; SameSite=Lax${secure}`;
  persistPlayerAppCheckToken(appCheckToken);
}

export function clearPlayerSessionToken() {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAYER_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  persistPlayerAppCheckToken();
}
