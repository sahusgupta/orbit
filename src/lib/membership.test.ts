import { describe, expect, it } from 'vitest';
import { createMembershipWindow, parseMembershipPrice } from './membership';

describe('membership domain', () => {
  it('creates the existing 24-hour day-pass window', () => {
    const window = createMembershipWindow('day', '2026-05-20T12:00:00.000Z');
    expect(window.startDate).toBe('2026-05-20');
    expect(window.expirationDate).toBe('2026-05-21');
    expect(window.expiresAt.toISOString()).toBe('2026-05-21T12:00:00.000Z');
  });

  it('creates the existing 30-day monthly window', () => {
    const window = createMembershipWindow('monthly', '2026-05-20T12:00:00.000Z');
    expect(window.expirationDate).toBe('2026-06-19');
    expect(window.expiresAt.toISOString()).toBe('2026-06-19T12:00:00.000Z');
  });

  it('normalizes configured membership prices', () => {
    expect(parseMembershipPrice('$49.00/mo')).toBe(49);
    expect(parseMembershipPrice(15)).toBe(15);
    expect(parseMembershipPrice(-5)).toBe(0);
    expect(parseMembershipPrice('')).toBe(0);
  });
});
