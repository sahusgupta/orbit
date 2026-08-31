import branding from '../../branding.config.json';
import { canonicalPayload } from '../lib/appCore';
import { nowIso } from './state';
import type { AppState, PilotAccess } from './types';
import { isLocalE2EFixtureMode } from '../lib/e2eFixtureMode';

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

export type ManagementSessionBinding = {
  accountKey: string;
  credentialFingerprint: string;
  licenseExpiresAt: string;
};

type ManagementSessionBridge = {
  persistManagementSession?: (binding: ManagementSessionBinding) => Promise<{ ok: boolean; active: boolean }>;
  restoreManagementSession?: (binding: ManagementSessionBinding) => Promise<{ ok: boolean; active: boolean }>;
  clearManagementSession?: (accountKey: string) => Promise<{ ok: boolean; active: boolean }>;
};

const managementSessions = new Map<string, { expiresAt: number; licenseExpiresAt: string }>();

const getManagementSessionBridge = () => window.tableManagerDesktop as ManagementSessionBridge | undefined;

const getPilotAccessExpiration = (value?: string) => {
  if (!value) return Number.NaN;
  return new Date(value.includes('T') ? value : `${value}T23:59:59.999`).getTime();
};

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const getManagementSessionBinding = async (state: AppState): Promise<ManagementSessionBinding | null> => {
  const accountLogin = state.settings.accountLogin;
  const licenseExpiresAt = state.settings.pilotAccess?.expiresAt;
  if (!accountLogin?.username || !accountLogin.passwordSalt || !accountLogin.passwordHash || !licenseExpiresAt) return null;
  const credentialMaterial = [
    accountLogin.username.trim().toLowerCase(),
    accountLogin.passwordSalt,
    accountLogin.passwordHash
  ].join('\u0000');
  const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentialMaterial));
  return {
    accountKey: getAccountKeyFromState(state),
    credentialFingerprint: bytesToHex(new Uint8Array(fingerprint)),
    licenseExpiresAt
  };
};

export const hasPersistedSignIn = (state: AppState) => {
  if (!isPilotAccessActive(state.settings.pilotAccess)) return false;
  if ((import.meta.env.MODE === 'test' || isLocalE2EFixtureMode()) && localStorage.getItem(getAuthStorageKey(state))) return true;
  const session = managementSessions.get(getAuthStorageKey(state));
  const now = Date.now();
  return Boolean(
    session &&
    session.expiresAt > now &&
    session.licenseExpiresAt === state.settings.pilotAccess?.expiresAt
  );
};

export const restorePersistedSignIn = async (state: AppState) => {
  if (!isPilotAccessActive(state.settings.pilotAccess)) return false;
  if (hasPersistedSignIn(state)) return true;
  let binding: ManagementSessionBinding | null;
  try {
    binding = await getManagementSessionBinding(state);
  } catch {
    return false;
  }
  const bridge = getManagementSessionBridge();
  if (!binding || !bridge?.restoreManagementSession) return false;
  try {
    const result = await bridge.restoreManagementSession(binding);
    if (!result.ok || !result.active) return false;
    managementSessions.set(getAuthStorageKey(state), {
      expiresAt: getPilotAccessExpiration(binding.licenseExpiresAt),
      licenseExpiresAt: binding.licenseExpiresAt
    });
    return hasPersistedSignIn(state);
  } catch {
    return false;
  }
};

export const persistSignIn = async (state: AppState, staySignedIn: boolean) => {
  const key = getAuthStorageKey(state);
  if (staySignedIn) {
    if (!isPilotAccessActive(state.settings.pilotAccess)) return false;
    let binding: ManagementSessionBinding | null;
    try {
      binding = await getManagementSessionBinding(state);
    } catch {
      return false;
    }
    const expiresAt = getPilotAccessExpiration(binding?.licenseExpiresAt);
    if (!binding || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    const bridge = getManagementSessionBridge();
    if (bridge?.persistManagementSession) {
      try {
        const result = await bridge.persistManagementSession(binding);
        if (!result.ok || !result.active) return false;
      } catch {
        return false;
      }
    }
    managementSessions.set(key, {
      expiresAt,
      licenseExpiresAt: binding.licenseExpiresAt
    });
    localStorage.removeItem(key);
    return true;
  }
  managementSessions.delete(key);
  localStorage.removeItem(key);
  const bridge = getManagementSessionBridge();
  if (bridge?.clearManagementSession) {
    try {
      const result = await bridge.clearManagementSession(getAccountKeyFromState(state));
      return result.ok;
    } catch {
      return false;
    }
  }
  return true;
};

export const touchPersistedSignIn = (state: AppState) => {
  const key = getAuthStorageKey(state);
  const session = managementSessions.get(key);
  if (
    !session ||
    !isPilotAccessActive(state.settings.pilotAccess) ||
    session.expiresAt <= Date.now() ||
    session.licenseExpiresAt !== state.settings.pilotAccess?.expiresAt
  ) {
    managementSessions.delete(key);
    return false;
  }
  return true;
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

export type PilotKeyValidationOptions = {
  allowExpired?: boolean;
};

export type PilotKeyValidationResult = {
  access?: PilotAccess;
  expired?: boolean;
  error?: string;
};

export const validatePilotKey = async (
  licenseFile: unknown,
  fileName?: string,
  options: PilotKeyValidationOptions = {}
): Promise<PilotKeyValidationResult> => {
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

  const expired = !isFutureDate(expiresAt);
  if (expired && !options.allowExpired) {
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
    },
    ...(expired ? { expired: true } : {})
  };
};
