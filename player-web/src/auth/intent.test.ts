import { describe, expect, it } from 'vitest';
import { buildIntentReturnPath, buildSignInHref, isPlayerIntent, safeReturnPath } from './intent';

describe('auth intent preservation', () => {
  it('keeps a valid internal game return path', () => expect(safeReturnPath('/games/game-key')).toBe('/games/game-key'));
  it('rejects absolute and protocol-relative redirects', () => {
    expect(safeReturnPath('https://malicious.example')).toBe('/me');
    expect(safeReturnPath('//malicious.example')).toBe('/me');
  });
  it('rejects backslash-based redirect confusion', () => expect(safeReturnPath('/\\malicious.example')).toBe('/me'));
  it('encodes the original route and game intent in the sign-in link', () => expect(buildSignInHref('/games/game-key', 'waitlist')).toBe('/sign-in?returnTo=%2Fgames%2Fgame-key&intent=waitlist'));
  it('restores the original query while adding the pre-auth intent', () => expect(buildIntentReturnPath('/clubs/club-key?tab=games', 'membership')).toBe('/clubs/club-key?tab=games&intent=membership'));
  it('recognizes only supported authoritative action intents', () => {
    expect(isPlayerIntent('tournament')).toBe(true);
    expect(isPlayerIntent('admin')).toBe(false);
  });
});
