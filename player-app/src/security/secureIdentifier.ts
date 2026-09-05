import { validateSecureUuid } from './secureIdentifierValidation';

export function createSecureUuid() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid !== 'function') {
    throw new Error('A cryptographically secure request identifier is unavailable.');
  }
  return validateSecureUuid(randomUuid.call(globalThis.crypto));
}
