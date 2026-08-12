import { afterEach, describe, expect, it, vi } from 'vitest';
import phoneAuth from './playerPhoneAuth.js';

const { createChallenge, normalizeE164, verifyChallenge } = phoneAuth;

afterEach(() => vi.unstubAllEnvs());

describe('player phone verification challenge', () => {
  it('accepts only E.164 input and binds a short-lived challenge to that phone', () => {
    vi.stubEnv('ORBIT_PHONE_CHALLENGE_SECRET', 'local-test-secret-that-is-at-least-thirty-two-characters');
    expect(normalizeE164('+1 (555) 111-2222')).toBe('+15551112222');
    expect(normalizeE164('5551112222')).toBe('');

    const challenge = createChallenge('+15551112222', 1_000);
    expect(verifyChallenge(challenge.token, '+15551112222', 2_000)).toBe(true);
    expect(verifyChallenge(challenge.token, '+15551112223', 2_000)).toBe(false);
    expect(verifyChallenge(`${challenge.token}tampered`, '+15551112222', 2_000)).toBe(false);
    expect(verifyChallenge(challenge.token, '+15551112222', 1_000 + 10 * 60 * 1000)).toBe(false);
  });
});
