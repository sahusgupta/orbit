import { getAccountKeyFromAccess, getAccountKeyFromState } from '../../domain/licensing';
import { normalizeState } from '../../domain/state';
import type { AccountLogin, AppState, PersistedAppState, PilotAccess } from '../../domain/types';
import { AccountRecoveryValidationError, normalizeAccountUsername } from '../../lib/accountRecovery';

export type OwnerRecoveryResult = {
  ok: boolean;
  accountKey?: string;
  accountLogin?: Pick<AccountLogin, 'username' | 'passwordSalt' | 'passwordHash' | 'lastLoginAt'>;
  state?: PersistedAppState;
  revision?: number;
  error?: string;
};

type RecoveredOwnerState = AppState & {
  settings: AppState['settings'] & { accountLogin: AccountLogin };
};

export function resolveOwnerRecoveryState(
  currentState: AppState,
  access: PilotAccess,
  result: OwnerRecoveryResult
): RecoveredOwnerState {
  if (!result.ok) {
    throw new AccountRecoveryValidationError(result.error || 'Owner-assisted recovery could not be completed.');
  }
  const accountKey = getAccountKeyFromAccess(access);
  const currentAccess = currentState.settings.pilotAccess;
  const authoritativeState = result.state;
  if (
    !accountKey ||
    !currentAccess ||
    getAccountKeyFromState(currentState) !== accountKey ||
    result.accountKey !== accountKey ||
    getAccountKeyFromAccess(authoritativeState?.settings?.pilotAccess) !== accountKey
  ) {
    throw new AccountRecoveryValidationError('The recovered club data does not match the active account. Reload the account to continue.');
  }
  if (
    !authoritativeState ||
    !Array.isArray(authoritativeState.games) ||
    !Array.isArray(authoritativeState.sessions) ||
    !Array.isArray(authoritativeState.playerSessions)
  ) {
    throw new AccountRecoveryValidationError('The complete club data could not be loaded after recovery. Reconnect and reload the account.');
  }
  const recoveredLogin = result.accountLogin;
  const authoritativeLogin = authoritativeState.settings?.accountLogin;
  const currentUsername = currentState.settings.accountLogin?.username;
  if (
    !recoveredLogin ||
    !authoritativeLogin ||
    typeof recoveredLogin.username !== 'string' ||
    !recoveredLogin.username.trim() ||
    typeof authoritativeLogin.username !== 'string' ||
    !currentUsername ||
    normalizeAccountUsername(recoveredLogin.username) !== normalizeAccountUsername(currentUsername) ||
    normalizeAccountUsername(authoritativeLogin.username) !== normalizeAccountUsername(recoveredLogin.username) ||
    typeof recoveredLogin.passwordHash !== 'string' ||
    !recoveredLogin.passwordHash ||
    typeof recoveredLogin.passwordSalt !== 'string' ||
    !recoveredLogin.passwordSalt ||
    authoritativeLogin.passwordHash !== recoveredLogin.passwordHash ||
    authoritativeLogin.passwordSalt !== recoveredLogin.passwordSalt
  ) {
    throw new AccountRecoveryValidationError('The recovered login does not match the club data. Reload the account to continue.');
  }
  const accountLogin = {
    ...authoritativeLogin,
    username: normalizeAccountUsername(authoritativeLogin.username)
  };
  const next = normalizeState({
    ...authoritativeState,
    settings: {
      ...authoritativeState.settings,
      pilotAccess: {
        ...currentAccess,
        ...authoritativeState.settings?.pilotAccess,
        authorizationCode: currentAccess.authorizationCode
      },
      accountLogin
    }
  });
  return { ...next, settings: { ...next.settings, accountLogin } };
}
