export const PLAYER_SESSION_COOKIE = 'orbit-player-session';

export function persistPlayerSessionToken(token: string) {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAYER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=3600; SameSite=Lax${secure}`;
}

export function clearPlayerSessionToken() {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAYER_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
