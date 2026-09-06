import { describe, expect, it } from 'vitest';
import { readPublicHttpsUrl } from './playerLinks';

describe('public Player links', () => {
  it('accepts only credential-free HTTPS URLs and uses the production-safe fallback otherwise', () => {
    const fallback = 'https://orbitapp-one.vercel.app/support';
    expect(readPublicHttpsUrl('https://support.example.test/help', fallback)).toBe('https://support.example.test/help');
    expect(readPublicHttpsUrl('http://support.example.test/help', fallback)).toBe(fallback);
    expect(readPublicHttpsUrl('javascript:alert(1)', fallback)).toBe(fallback);
    expect(readPublicHttpsUrl('https://user:pass@example.test/help', fallback)).toBe(fallback);
    expect(readPublicHttpsUrl(undefined, fallback)).toBe(fallback);
  });
});
