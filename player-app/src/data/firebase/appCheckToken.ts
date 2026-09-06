import { getToken, type AppCheck } from 'firebase/app-check';

// Expiry is used only for SDK caching. Firebase/API servers verify the signature.
export function readAppCheckTokenExpiry(token: string, now = Date.now()): number {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every(Boolean)) throw new Error();
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(globalThis.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    const expiry = payload && typeof payload === 'object' ? Reflect.get(payload, 'exp') : undefined;
    if (typeof expiry !== 'number' || !Number.isSafeInteger(expiry * 1000) || expiry * 1000 <= now) throw new Error();
    return expiry * 1000;
  } catch {
    throw new Error('Device verification returned an invalid token.');
  }
}

export async function appCheckHeaders(appCheck: AppCheck | undefined): Promise<Record<string, string>> {
  if (!appCheck) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      getToken(appCheck),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error()), 10_000); })
    ]);
    if (!result.token) throw new Error();
    return { 'X-Firebase-AppCheck': result.token };
  } catch {
    // Do not expose provider diagnostics or send an unverified fallback request.
    throw new Error('Device verification is unavailable. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
