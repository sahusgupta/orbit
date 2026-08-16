import { afterEach, describe, expect, it } from 'vitest';
import { clearPlayerSessionToken, persistPlayerSessionToken, PLAYER_SESSION_COOKIE } from './session-cookie';

afterEach(() => clearPlayerSessionToken());

describe('Player Web session cookie', () => {
  it('persists the Firebase token for the server route guard', () => {
    persistPlayerSessionToken('header.payload.signature');
    expect(document.cookie).toContain(`${PLAYER_SESSION_COOKIE}=header.payload.signature`);
  });

  it('clears the route-guard cookie on sign-out', () => {
    persistPlayerSessionToken('token');
    clearPlayerSessionToken();
    expect(document.cookie).not.toContain(`${PLAYER_SESSION_COOKIE}=`);
  });
});
