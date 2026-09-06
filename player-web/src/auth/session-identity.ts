import type { Auth } from 'firebase/auth';

export const playerSessionChangedMessage = 'The signed-in Orbit account changed. Retry this action for the current account.';

export class PlayerSessionChangedError extends Error {
  readonly code = 'PLAYER_SESSION_CHANGED';

  constructor() {
    super(playerSessionChangedMessage);
    this.name = 'PlayerSessionChangedError';
  }
}

export function assertExpectedFirebaseUser(auth: Pick<Auth, 'currentUser'>, expectedUid: string) {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid) throw new PlayerSessionChangedError();
}

export function isPlayerSessionChangedError(error: unknown) {
  return error instanceof PlayerSessionChangedError
    || (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'PLAYER_SESSION_CHANGED');
}
