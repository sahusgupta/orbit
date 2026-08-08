const arrayBufferToHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const legacyHashStaffPin = async (pin: string, salt: string) =>
  arrayBufferToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));

export const hashStaffPin = async (pin: string, salt: string) => {
  const iterations = 210_000;
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(salt),
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  return `pbkdf2-sha256$${iterations}$${arrayBufferToHex(derived)}`;
};

export const verifyStaffSecret = async (secret: string, salt: string, storedHash: string) => {
  if (storedHash.startsWith('pbkdf2-sha256$')) {
    return (await hashStaffPin(secret, salt)) === storedHash;
  }
  return (await legacyHashStaffPin(secret, salt)) === storedHash;
};
