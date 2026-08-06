export type RecoverableAccountLogin = {
  username: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
};

export class AccountRecoveryValidationError extends Error {}

const blockedPasswords = new Set([
  '12345678',
  'password',
  'password1',
  'qwerty123'
]);

export const normalizeAccountUsername = (value: string) => value.trim().toLowerCase();

export async function recoverAccountLogin<TLogin extends RecoverableAccountLogin>({
  accountLogin,
  username,
  password,
  authenticate,
  createSalt,
  hashPassword,
  now
}: {
  accountLogin: TLogin;
  username: string;
  password: string;
  authenticate: (username: string, password: string) => Promise<unknown>;
  createSalt: () => string;
  hashPassword: (password: string, salt: string) => Promise<string>;
  now: () => string;
}): Promise<TLogin> {
  const normalizedUsername = normalizeAccountUsername(username);
  if (!normalizedUsername || normalizedUsername !== normalizeAccountUsername(accountLogin.username)) {
    throw new AccountRecoveryValidationError('Use the login email assigned to this card house.');
  }
  if (password.length < 8 || blockedPasswords.has(password.trim().toLowerCase())) {
    throw new AccountRecoveryValidationError('Choose a stronger password with at least 8 characters.');
  }

  await authenticate(normalizedUsername, password);

  const passwordSalt = createSalt();
  const passwordHash = await hashPassword(password, passwordSalt);
  return {
    ...accountLogin,
    username: normalizedUsername,
    passwordSalt,
    passwordHash,
    lastLoginAt: now()
  };
}
