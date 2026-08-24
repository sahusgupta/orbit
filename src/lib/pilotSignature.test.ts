/**
 * @vitest-environment jsdom
 */
import { pbkdf2Sync, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPayload } from './appCore';
import {
  derToRawP256Signature,
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  getAuthStorageKey,
  getStorageKeyForState,
  hasPersistedSignIn,
  isFutureDate,
  isPilotAccessActive,
  persistSignIn,
  restorePersistedSignIn,
  validatePilotKey,
  verifyPilotSignature
} from '../domain/licensing';
import { hashStaffPin, verifyStaffSecret } from '../domain/staffAuth';
import { seedState } from '../domain/state';
import type { AppState, PilotAccess } from '../domain/types';

const harness = vi.hoisted(() => ({
  branding: undefined as unknown,
  publicKeyPem: ''
}));

vi.mock('../../branding.config.json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../branding.config.json')>();
  const branding = {
    ...actual,
    license: {
      ...actual.license,
      publicKeyPem: harness.publicKeyPem
    }
  };
  harness.branding = branding;
  return { default: branding };
});

const payload = {
  authorizationCode: 'TYPE-011-AUTH',
  expiresAt: '2099-12-31',
  issuedAt: '2026-08-07T12:00:00.000Z',
  issuedTo: 'TYPE-011 Fixture Club',
  licenseId: 'TYPE-011-LICENSE'
};

const toPem = (buffer: ArrayBuffer) => {
  const base64 = Buffer.from(buffer).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const trimDerInteger = (bytes: Uint8Array) => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const value = bytes.slice(start);
  if ((value[0] & 0x80) === 0) return value;
  const prefixed = new Uint8Array(value.length + 1);
  prefixed.set(value, 1);
  return prefixed;
};

const rawToDer = (raw: Uint8Array) => {
  if (raw.length !== 64) throw new Error('Expected a raw P-256 signature');
  const r = trimDerInteger(raw.slice(0, 32));
  const s = trimDerInteger(raw.slice(32));
  const der = new Uint8Array(6 + r.length + s.length);
  der.set([0x30, der.length - 2, 0x02, r.length], 0);
  der.set(r, 4);
  const sOffset = 4 + r.length;
  der.set([0x02, s.length], sOffset);
  der.set(s, sOffset + 2);
  return der;
};

const getBrandingLicense = () => {
  const license = Reflect.get(harness.branding as object, 'license');
  if (typeof license !== 'object' || license === null) throw new Error('Expected mocked license branding');
  return license;
};

describe('pilot licensing and staff authentication boundary', () => {
  let validRawSignature: Uint8Array;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
    vi.stubGlobal('crypto', webcrypto);
    const keyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    harness.publicKeyPem = toPem(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
    validRawSignature = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        new TextEncoder().encode(canonicalPayload(payload))
      )
    );
  });

  beforeEach(() => {
    Reflect.set(getBrandingLicense(), 'publicKeyPem', harness.publicKeyPem);
    Object.defineProperty(window, 'tableManagerDesktop', { configurable: true, value: undefined });
  });

  afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('accepts the valid raw signature and converts equivalent DER bytes exactly', async () => {
    const derSignature = rawToDer(validRawSignature);

    await expect(verifyPilotSignature(payload, toBase64(validRawSignature))).resolves.toEqual({ ok: true });
    await expect(verifyPilotSignature(payload, toBase64(derSignature))).resolves.toEqual({ ok: true });
    expect(new Uint8Array(derToRawP256Signature(derSignature))).toEqual(validRawSignature);
  });

  it('rejects a signature produced by a different P-256 key', async () => {
    const wrongKeyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const wrongSignature = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        wrongKeyPair.privateKey,
        new TextEncoder().encode(canonicalPayload(payload))
      )
    );

    await expect(verifyPilotSignature(payload, toBase64(wrongSignature))).resolves.toEqual({
      ok: false,
      error: 'License signature is invalid.'
    });
  });

  it('rejects a modified payload with an otherwise valid signature', async () => {
    await expect(
      verifyPilotSignature({ ...payload, issuedTo: 'Modified Fixture Club' }, toBase64(validRawSignature))
    ).resolves.toEqual({ ok: false, error: 'License signature is invalid.' });
  });

  it('rejects malformed DER and wrong-length raw signatures', async () => {
    await expect(
      verifyPilotSignature(payload, toBase64(Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01])))
    ).resolves.toEqual({ ok: false, error: 'Unable to verify license signature.' });
    await expect(verifyPilotSignature(payload, toBase64(new Uint8Array(63)))).resolves.toEqual({
      ok: false,
      error: 'Unable to verify license signature.'
    });
  });

  it('rejects a public key whose algorithm is unsupported by the P-256 verifier', async () => {
    const unsupportedKeyPair = await webcrypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: Uint8Array.from([1, 0, 1])
      },
      true,
      ['sign', 'verify']
    );
    Reflect.set(
      getBrandingLicense(),
      'publicKeyPem',
      toPem(await webcrypto.subtle.exportKey('spki', unsupportedKeyPair.publicKey))
    );

    await expect(verifyPilotSignature(payload, toBase64(validRawSignature))).resolves.toEqual({
      ok: false,
      error: 'Unable to verify license signature.'
    });
  });

  it('derives versioned staff secrets deterministically and verifies modern and legacy records', async () => {
    const secret = '2468';
    const salt = 'fixture-salt';
    const expectedModern = `pbkdf2-sha256$210000$${pbkdf2Sync(secret, salt, 210_000, 32, 'sha256').toString('hex')}`;
    const legacyDigest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${secret}`));
    const legacyHash = Buffer.from(legacyDigest).toString('hex');

    await expect(hashStaffPin(secret, salt)).resolves.toBe(expectedModern);
    await expect(verifyStaffSecret(secret, salt, expectedModern)).resolves.toBe(true);
    await expect(verifyStaffSecret(secret, salt, legacyHash)).resolves.toBe(true);
    await expect(verifyStaffSecret('wrong', salt, expectedModern)).resolves.toBe(false);
    await expect(verifyStaffSecret('wrong', salt, legacyHash)).resolves.toBe(false);
  });

  it('preserves license date, account-key, and persisted sign-in semantics', async () => {
    const access: PilotAccess = {
      authorized: true,
      authorizationCode: 'AUTHORIZATION-CODE',
      expiresAt: '2099-12-31',
      activatedAt: '2026-08-07T22:00:00.000Z',
      issuedTo: 'Fixture Club',
      licenseId: ' License / Alpha '
    };
    const state: AppState = {
      ...structuredClone(seedState),
      settings: {
        ...structuredClone(seedState.settings),
        pilotAccess: access,
        accountLogin: {
          username: 'owner@example.test',
          passwordSalt: 'salt',
          passwordHash: 'pbkdf2-sha256$210000$hash',
          createdAt: '2026-08-07T22:00:00.000Z'
        }
      }
    };

    expect(isFutureDate('2026-08-07')).toBe(true);
    expect(isFutureDate('2026-08-06')).toBe(false);
    expect(isFutureDate('not-a-date')).toBe(false);
    expect(isPilotAccessActive(access)).toBe(true);
    expect(isPilotAccessActive({ ...access, authorized: false })).toBe(false);
    expect(getAccountKeyFromAccess(access)).toBe('license-alpha');
    expect(getAccountKeyFromState(state)).toBe('license-alpha');
    expect(getStorageKeyForState(state)).toBe('table-manager-state-v1:license-alpha');
    expect(getAuthStorageKey(state)).toBe('table-manager-state-v1:auth:license-alpha');

    await expect(persistSignIn(state, true)).resolves.toBe(true);
    expect(hasPersistedSignIn(state)).toBe(true);
    expect(localStorage.getItem(getAuthStorageKey(state))).toBeNull();
    expect(hasPersistedSignIn({
      ...state,
      settings: { ...state.settings, pilotAccess: { ...access, expiresAt: '2099-12-30' } }
    })).toBe(false);
    await expect(persistSignIn(state, false)).resolves.toBe(true);
    expect(hasPersistedSignIn(state)).toBe(false);
    await expect(persistSignIn({
      ...state,
      settings: { ...state.settings, pilotAccess: { ...access, authorized: false } }
    }, true)).resolves.toBe(false);
  });

  it('restores only an OS-bound session matching the current account credentials and license', async () => {
    const state: AppState = {
      ...structuredClone(seedState),
      settings: {
        ...structuredClone(seedState.settings),
        pilotAccess: {
          authorized: true,
          authorizationCode: 'AUTHORIZATION-CODE',
          expiresAt: '2099-12-31',
          activatedAt: '2026-08-07T22:00:00.000Z',
          licenseId: 'license-alpha'
        },
        accountLogin: {
          username: 'owner@example.test',
          passwordSalt: 'salt',
          passwordHash: 'pbkdf2-sha256$210000$hash',
          createdAt: '2026-08-07T22:00:00.000Z'
        }
      }
    };
    const persistedBindings: unknown[] = [];
    const desktop = {
      persistManagementSession: vi.fn(async (binding: unknown) => {
        persistedBindings.push(binding);
        return { ok: true, active: true };
      }),
      restoreManagementSession: vi.fn(async (binding: unknown) => ({
        ok: true,
        active: JSON.stringify(binding) === JSON.stringify(persistedBindings[0])
      })),
      clearManagementSession: vi.fn(async () => ({ ok: true, active: false }))
    };
    Object.defineProperty(window, 'tableManagerDesktop', { configurable: true, value: desktop });

    await expect(persistSignIn(state, true)).resolves.toBe(true);
    await expect(persistSignIn(state, false)).resolves.toBe(true);
    await expect(restorePersistedSignIn(state)).resolves.toBe(true);
    expect(desktop.restoreManagementSession).toHaveBeenCalledWith(expect.objectContaining({
      accountKey: 'license-alpha',
      credentialFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      licenseExpiresAt: '2099-12-31'
    }));

    await persistSignIn(state, false);
    await expect(restorePersistedSignIn({
      ...state,
      settings: {
        ...state.settings,
        accountLogin: { ...state.settings.accountLogin!, passwordHash: 'changed-hash' }
      }
    })).resolves.toBe(false);
    Object.defineProperty(window, 'tableManagerDesktop', { configurable: true, value: undefined });
  });

  it('validates signed pilot-key aliases and preserves validation error precedence', async () => {
    const signature = toBase64(validRawSignature);

    await expect(validatePilotKey({ payload, signature }, 'fixture.orbit-key')).resolves.toEqual({
      access: {
        authorized: true,
        authorizationCode: payload.authorizationCode,
        expiresAt: payload.expiresAt,
        activatedAt: '2026-08-07T22:00:00.000Z',
        keyFileName: 'fixture.orbit-key',
        issuedTo: payload.issuedTo,
        issuedAt: payload.issuedAt,
        licenseId: payload.licenseId
      }
    });
    await expect(validatePilotKey({ payload })).resolves.toEqual({
      error: 'Key file is not signed. Generate a production pilot key with the license tool.'
    });
    await expect(validatePilotKey({ payload: { ...payload, authorizationCode: 'short' }, signature })).resolves.toEqual({
      error: 'Key file is missing a valid authorization code.'
    });
    await expect(validatePilotKey({ payload: { ...payload, expiresAt: 'invalid' }, signature })).resolves.toEqual({
      error: 'Key file is missing a valid expiration date.'
    });
    await expect(validatePilotKey({ payload: { ...payload, expiresAt: '2026-08-06' }, signature })).resolves.toEqual({
      error: 'This pilot key expired on 2026-08-06.'
    });
  });
});
