import { afterEach, describe, expect, it, vi } from 'vitest';

const expoCrypto = vi.hoisted(() => ({
  randomUUID: vi.fn(() => '018f47a2-6d2b-4a18-8f0b-70ea7e7d6211')
}));

vi.mock('expo-crypto', () => expoCrypto);

import { createSecureUuid } from './secureIdentifier';
import { createSecureUuid as createNativeSecureUuid } from './secureIdentifier.native';
import { createMembershipQrMutationId } from '../domain/membershipQr';
import { createOpaquePlayerId } from '../domain/playerSync';

afterEach(() => {
  vi.unstubAllGlobals();
  expoCrypto.randomUUID.mockClear();
});

describe('secure Player request identifiers', () => {
  it('fails closed when the web cryptographic UUID provider is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => createSecureUuid()).toThrow('cryptographically secure request identifier is unavailable');
    expect(() => createOpaquePlayerId('wait')).toThrow('cryptographically secure request identifier is unavailable');
    expect(() => createMembershipQrMutationId()).toThrow('cryptographically secure request identifier is unavailable');
  });

  it('uses Expo Crypto for native identifiers instead of a predictable fallback', () => {
    expect(createNativeSecureUuid()).toBe('018f47a2-6d2b-4a18-8f0b-70ea7e7d6211');
    expect(expoCrypto.randomUUID).toHaveBeenCalledOnce();
  });

  it('rejects malformed output from the native secure provider', () => {
    expoCrypto.randomUUID.mockReturnValueOnce('not-a-secure-uuid');
    expect(() => createNativeSecureUuid()).toThrow('cryptographically secure request identifier is unavailable');
  });
});
