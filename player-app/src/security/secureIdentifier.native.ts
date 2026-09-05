import { randomUUID } from 'expo-crypto';
import { validateSecureUuid } from './secureIdentifierValidation';

export function createSecureUuid() {
  return validateSecureUuid(randomUUID());
}
