import { NextResponse, type NextRequest } from 'next/server';
import { PLAYER_SESSION_COOKIE } from '@/src/auth/session-cookie';

const localApiOrigin = 'http://127.0.0.1:4629';
const verificationTimeoutMs = 8_000;

function signInRedirect(request: NextRequest) {
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('returnTo', returnTo);
  const response = NextResponse.redirect(signInUrl);
  response.cookies.delete(PLAYER_SESSION_COOKIE);
  return response;
}

export async function proxy(request: NextRequest) {
  const token = request.cookies.get(PLAYER_SESSION_COOKIE)?.value;
  if (!token) return signInRedirect(request);

  try {
    const apiOrigin = (process.env.ORBIT_API_URL || localApiOrigin).replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), verificationTimeoutMs);
    let verification: Response;
    try {
      verification = await fetch(`${apiOrigin}/player/discovery?limit=1`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!verification.ok) return signInRedirect(request);
    return NextResponse.next();
  } catch {
    return signInRedirect(request);
  }
}

export const config = {
  matcher: ['/games/:path*', '/clubs/:path*', '/tournaments/:path*', '/me/:path*']
};
