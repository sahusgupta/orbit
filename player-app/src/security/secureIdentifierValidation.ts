const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSecureUuid(value: unknown) {
  if (typeof value !== 'string' || !uuidV4Pattern.test(value)) {
    throw new Error('A cryptographically secure request identifier is unavailable.');
  }
  return value;
}
