import branding from '../../branding.config.json';
import { canonicalPayload } from '../lib/appCore';
import { nowIso } from './state';
import type { AppState, PilotAccess } from './types';

export const managementStorageKey = 'table-manager-state-v1';

export const isFutureDate = (value?: string) => {
  if (!value) return false;
  const expiration = new Date(value.includes('T') ? value : `${value}T23:59:59`).getTime();
  return Number.isFinite(expiration) && expiration >= Date.now();
};

export const isPilotAccessActive = (access?: PilotAccess) => Boolean(access?.authorized && isFutureDate(access.expiresAt));

export const safeAccountKeyPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

export const getAccountKeyFromAccess = (access?: PilotAccess) =>
  safeAccountKeyPart(access?.licenseId || access?.authorizationCode || access?.issuedTo || '');

export const getAccountKeyFromState = (state?: Partial<AppState>) =>
  getAccountKeyFromAccess(state?.settings?.pilotAccess) ||
  safeAccountKeyPart(state?.settings?.clubAccount?.email || state?.settings?.clubAccount?.clubName || 'unlicensed-local') ||
  'unlicensed-local';

export const getStorageKeyForState = (state?: Partial<AppState>) => `${managementStorageKey}:${getAccountKeyFromState(state)}`;

export const getAuthStorageKey = (state?: Partial<AppState>) => `${managementStorageKey}:auth:${getAccountKeyFromState(state)}`;

export const hasPersistedSignIn = (state: AppState) => {
  if (!isPilotAccessActive(state.settings.pilotAccess)) return false;
  try {
    const stored = localStorage.getItem(getAuthStorageKey(state));
    if (!stored) return false;
    const record = JSON.parse(stored) as { expiresAt?: string };
    return Boolean(record.expiresAt && state.settings.pilotAccess && record.expiresAt === state.settings.pilotAccess.expiresAt && isFutureDate(record.expiresAt));
  } catch {
    return false;
  }
};

export const persistSignIn = (state: AppState, staySignedIn: boolean) => {
  const key = getAuthStorageKey(state);
  if (staySignedIn && state.settings.pilotAccess?.expiresAt) {
    localStorage.setItem(key, JSON.stringify({ expiresAt: state.settings.pilotAccess.expiresAt, savedAt: nowIso() }));
    return;
  }
  localStorage.removeItem(key);
};

const base64ToArrayBuffer = (base64: string) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const leftPadSignatureInteger = (bytes: Uint8Array) => {
  const normalized = bytes[0] === 0 ? bytes.slice(1) : bytes;
  if (normalized.length > 32) throw new Error('Invalid signature integer length.');
  const padded = new Uint8Array(32);
  padded.set(normalized, 32 - normalized.length);
  return padded;
};

export const derToRawP256Signature = (signature: Uint8Array) => {
  if (signature.length === 64) return Uint8Array.from(signature).buffer;
  if (signature[0] !== 0x30) throw new Error('Invalid signature format.');
  let offset = 2;
  if (signature[offset] !== 0x02) throw new Error('Invalid signature format.');
  const rLength = signature[offset + 1];
  const r = signature.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (signature[offset] !== 0x02) throw new Error('Invalid signature format.');
  const sLength = signature[offset + 1];
  const s = signature.slice(offset + 2, offset + 2 + sLength);
  const raw = new Uint8Array(64);
  raw.set(leftPadSignatureInteger(r), 0);
  raw.set(leftPadSignatureInteger(s), 32);
  return raw.buffer;
};

const pemToArrayBuffer = (pem: string) =>
  base64ToArrayBuffer(
    pem
      .replace(/-----BEGIN PUBLIC KEY-----/g, '')
      .replace(/-----END PUBLIC KEY-----/g, '')
      .replace(/\s/g, '')
  );

export const verifyPilotSignature = async (payload: Record<string, unknown>, signature: string) => {
  const publicKeyPem = branding.license?.publicKeyPem?.trim();
  if (!publicKeyPem) return { ok: false, error: 'License verification is not configured for this build.' };
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(publicKeyPem),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derToRawP256Signature(new Uint8Array(base64ToArrayBuffer(signature))),
      new TextEncoder().encode(canonicalPayload(payload))
    );
    return verified ? { ok: true } : { ok: false, error: 'License signature is invalid.' };
  } catch {
    return { ok: false, error: 'Unable to verify license signature.' };
  }
};

export const validatePilotKey = async (licenseFile: unknown, fileName?: string): Promise<{ access?: PilotAccess; error?: string }> => {
  const file = licenseFile as Record<string, unknown>;
  const record = (file.payload ?? file) as Record<string, unknown>;
  const signature = String(file.signature ?? '').trim();
  const authorizationCode = String(record.authorizationCode ?? record.code ?? '').trim();
  const expiresAt = String(record.expiresAt ?? record.expirationDate ?? record.validUntil ?? '').slice(0, 10);

  if (!signature) {
    return { error: 'Key file is not signed. Generate a production pilot key with the license tool.' };
  }

  if (!authorizationCode || authorizationCode.length < 12) {
    return { error: 'Key file is missing a valid authorization code.' };
  }

  if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
    return { error: 'Key file is missing a valid expiration date.' };
  }

  if (!isFutureDate(expiresAt)) {
    return { error: `This pilot key expired on ${expiresAt}.` };
  }

  const signatureResult = await verifyPilotSignature(record, signature);
  if (!signatureResult.ok) {
    return { error: signatureResult.error ?? 'License signature is invalid.' };
  }

  return {
    access: {
      authorized: true,
      authorizationCode,
      expiresAt,
      activatedAt: nowIso(),
      keyFileName: fileName,
      issuedTo: String(record.issuedTo ?? ''),
      issuedAt: String(record.issuedAt ?? ''),
      licenseId: String(record.licenseId ?? '')
    }
  };
};
